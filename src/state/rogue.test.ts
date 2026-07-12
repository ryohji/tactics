// rogue ストアのターン進行テスト。演出の sleep は fake timers で進める(game.test.ts と同型)。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cellKey, keyToCell, layer, neighbors } from '../model/fcc';
import { stepDist } from '../model/dungeon';
import type { ItemStack } from '../model/loot';
import {
  useRogue,
  seedRogueRng,
  parseSeed,
  depthOf,
  playerAtk,
  clearedChambers,
  gazeAngles,
  getActionLogForTest,
  type Beast,
} from './rogue';
import { GAME_VERSION } from '../model/rogue/types';
import * as persist from './persist';
import * as history from './history';
import * as masteryStore from './masteryStore';
import * as codexStore from './codexStore';
import { INITIAL_MASTERY } from '../model/rogue/mastery';
import { view } from './view';
import { BEASTS } from '../model/beasts';

function player() {
  return useRogue.getState().player;
}

/** プレイヤー隣接の空洞セル(敵なし)をひとつ返す。 */
function freeNeighbor(): [number, number, number] {
  const s = useRogue.getState();
  const occupied = new Set(s.beasts.filter((b) => b.alive).map((b) => cellKey(b.pos)));
  const n = neighbors(s.player.pos).find(
    (c) => s.dungeon.open.has(cellKey(c)) && !occupied.has(cellKey(c)),
  );
  if (!n) throw new Error('no free neighbor');
  return n;
}

/** テスト用: プレイヤーの隣に敵を置く。 */
function placeBeastAdjacent(kind: keyof typeof BEASTS, hp?: number): Beast {
  const s = useRogue.getState();
  const pos = freeNeighbor();
  const def = BEASTS[kind];
  const b: Beast = {
    id: 900,
    kind,
    pos,
    hp: hp ?? def.hp,
    home: pos,
    homeChamber: 0,
    layerFloor: -999,
    layerCeil: 999,
    awake: true,
    alive: true,
    status: null,
    carry: null,
  };
  useRogue.setState({ beasts: [...s.beasts, b] });
  return b;
}

async function run(ms = 3000) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  // restart はシードから戦闘乱数も初期化するので、テスト用の固定はその後に。
  useRogue.getState().restart(7);
  seedRogueRng(42);
});

/** localStorage 互換のインメモリ実装(persist の差し替え用)。 */
class MemStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('セーブと再開(persist)', () => {
  it('毎ターン自動保存され、resume で状態が復元される', () => {
    persist.setStorageForTest(new MemStorage() as unknown as Storage);
    try {
      useRogue.getState().restart(7);
      useRogue.getState().wait(); // 1ターン → 自動保存
      expect(persist.hasSave()).toBe(true);
      const before = useRogue.getState();
      const { turn, seed } = before;
      const pos = before.player.pos;
      const openSize = before.dungeon.open.size;
      const packLen = before.player.pack.length;
      // 別の冒険を始めると保存は破棄される。保存を書き戻して「リロード後の再開」を再現。
      const raw = persist.readSave<object>();
      useRogue.getState().restart(99);
      expect(persist.hasSave()).toBe(false);
      persist.writeSave(raw);
      expect(useRogue.getState().resume()).toBe(true);
      const s = useRogue.getState();
      expect(s.seed).toBe(seed);
      expect(s.turn).toBe(turn);
      expect(s.player.pos).toEqual(pos);
      expect(s.player.pack).toHaveLength(packLen);
      expect(s.dungeon.open.size).toBe(openSize);
      expect(s.phase).toBe('play');
      expect(s.reach.cells.length).toBeGreaterThan(0); // 到達範囲も再計算済み
    } finally {
      persist.setStorageForTest(null);
    }
  });

  it('死亡すると保存が破棄され、resume できない', () => {
    persist.setStorageForTest(new MemStorage() as unknown as Storage);
    try {
      useRogue.getState().restart(7);
      useRogue.getState().wait();
      expect(persist.hasSave()).toBe(true);
      placeBeastAdjacent('drake');
      useRogue.setState({ player: { ...player(), hp: 1 } });
      useRogue.getState().wait();
      expect(useRogue.getState().phase).toBe('dead');
      expect(persist.hasSave()).toBe(false);
      expect(useRogue.getState().resume()).toBe(false);
    } finally {
      persist.setStorageForTest(null);
    }
  });
});

describe('parseSeed(シード入力の解釈)', () => {
  it('数字列はそのまま、空欄は undefined、言葉は決定的にハッシュ', () => {
    expect(parseSeed('12345')).toBe(12345);
    expect(parseSeed(' 7 ')).toBe(7);
    expect(parseSeed('')).toBeUndefined();
    expect(parseSeed('   ')).toBeUndefined();
    expect(parseSeed('ありのす')).toBe(parseSeed('ありのす'));
    expect(parseSeed('ありのす')).not.toBe(parseSeed('ありんこ'));
    expect(parseSeed('ありのす')! >= 0 && parseSeed('ありのす')! < 0x80000000).toBe(true);
  });
});

describe('初期状態', () => {
  it('入口が発見済みで、移動先マーカーがある', () => {
    const s = useRogue.getState();
    expect(s.phase).toBe('play');
    expect(s.discovered.size).toBeGreaterThan(10);
    expect(s.reach.cells.length).toBeGreaterThan(5);
    expect(depthOf(s.player.pos)).toBe(0);
    expect(playerAtk(s.player)).toBeGreaterThan(2); // 短剣持ち
  });

  it('同じ seed の restart で同じダンジョンになる', () => {
    const a = useRogue.getState().dungeon.open.size;
    useRogue.getState().restart(7);
    expect(useRogue.getState().dungeon.open.size).toBe(a);
  });
});

describe('移動', () => {
  it('隣接セルへ歩くとターンが進む', async () => {
    const s = useRogue.getState();
    const to = s.reach.cells.find((c) => neighbors(s.player.pos).some((n) => cellKey(n) === cellKey(c)))!;
    s.clickCell(to);
    await run();
    expect(cellKey(player().pos)).toBe(cellKey(to));
    expect(useRogue.getState().turn).toBe(1);
    expect(useRogue.getState().busy).toBe(false);
    expect(useRogue.getState().reach.cells.length).toBeGreaterThan(0);
  });

  it('reach 外のセルは無視される', async () => {
    useRogue.getState().clickCell([99, 99, 0]);
    await run();
    expect(useRogue.getState().turn).toBe(0);
  });

  it('自動歩行の途中で restart しても古い経路を歩き続けない', async () => {
    const s = useRogue.getState();
    const far = s.reach.cells.find((c) => !neighbors(s.player.pos).some((n) => cellKey(n) === cellKey(c)))!;
    s.clickCell(far);
    await vi.advanceTimersByTimeAsync(50); // 1歩目の演出中
    useRogue.getState().restart(11);
    await run(5000);
    expect(cellKey(player().pos)).toBe('0,0,0'); // 新しい回の初期位置のまま
    expect(useRogue.getState().turn).toBe(0);
    expect(useRogue.getState().busy).toBe(false);
  });

  it('複数歩の自動歩行で歩数ぶんターンが進む', async () => {
    const s = useRogue.getState();
    // 2歩以上の目的地(parent があるので必ず経路復元できる)。
    const far = s.reach.cells.find((c) => !neighbors(s.player.pos).some((n) => cellKey(n) === cellKey(c)))!;
    s.clickCell(far);
    await run(5000);
    expect(cellKey(player().pos)).toBe(cellKey(far));
    expect(useRogue.getState().turn).toBeGreaterThanOrEqual(2);
  });
});

describe('戦闘', () => {
  it('隣接する敵をクリックで攻撃し、倒すと討伐数が増える', async () => {
    const b = placeBeastAdjacent('bat', 1);
    useRogue.getState().clickBeast(b.id);
    await run();
    expect(useRogue.getState().beasts.find((x) => x.id === b.id)!.alive).toBe(false);
    expect(useRogue.getState().kills).toBe(1);
    expect(useRogue.getState().turn).toBe(1);
  });

  it('待機すると隣接する敵に攻撃される', () => {
    placeBeastAdjacent('ghoul');
    const hp0 = player().hp;
    useRogue.getState().wait();
    expect(player().hp).toBeLessThan(hp0);
  });

  it('HP が尽きると死亡フェーズになり、死因が記録される', () => {
    placeBeastAdjacent('drake');
    useRogue.setState({ player: { ...player(), hp: 1 } });
    useRogue.getState().wait();
    expect(useRogue.getState().phase).toBe('dead');
    expect(useRogue.getState().reach.cells).toHaveLength(0);
    expect(useRogue.getState().deathCause).toBe(BEASTS.drake.name);
    // 再挑戦で死因はクリアされる。
    useRogue.getState().restart(1);
    expect(useRogue.getState().deathCause).toBeNull();
  });

  it('投げナイフ: モードに入り射程内の敵へ当てて消費する', async () => {
    const b = placeBeastAdjacent('bat');
    const s = useRogue.getState();
    const idx = s.player.pack.findIndex((x) => x.item === 'knife');
    const knives = s.player.pack.filter((x) => x.item === 'knife').length;
    s.useItem(idx);
    expect(useRogue.getState().uiMode).toBe('throw');
    useRogue.getState().clickBeast(b.id);
    await run();
    expect(useRogue.getState().uiMode).toBe('walk');
    expect(player().pack.filter((x) => x.item === 'knife').length).toBe(knives - 1);
    const after = useRogue.getState().beasts.find((x) => x.id === b.id)!;
    expect(after.hp).toBeLessThan(BEASTS.bat.hp);
  });
});

describe('アイテム', () => {
  it('水薬で回復し1ターン経過する', () => {
    useRogue.setState({ player: { ...player(), hp: 5 } });
    const idx = player().pack.findIndex((x) => x.item === 'potion');
    useRogue.getState().useItem(idx);
    expect(player().hp).toBeGreaterThan(5);
    expect(useRogue.getState().turn).toBe(1);
    expect(player().pack.some((x) => x.item === 'potion')).toBe(false);
  });

  it('武器を拾って構えると攻撃力が上がる(元の武器は所持品へ)', () => {
    useRogue.setState({
      player: { ...player(), pack: [...player().pack, { item: 'waraxe', q: 0 }] },
    });
    const atk0 = playerAtk(player());
    const idx = player().pack.findIndex((x) => x.item === 'waraxe');
    useRogue.getState().useItem(idx);
    expect(playerAtk(player())).toBeGreaterThan(atk0);
    expect(player().weapon?.item).toBe('waraxe');
    expect(player().pack.some((x) => x.item === 'dagger')).toBe(true);
  });

  it('合成: 同一アイテム・同一品質の2つが q+1 になる(+0と+1 は合成不可)', () => {
    const knifeIdx = player().pack.findIndex((x) => x.item === 'knife');
    useRogue.getState().mergeItem(knifeIdx); // knife×2(q0) → knife+1
    const merged = player().pack.filter((x) => x.item === 'knife');
    expect(merged).toHaveLength(1);
    expect(merged[0].q).toBe(1);
    expect(useRogue.getState().turn).toBe(1); // 合成は1ターン
    // q1 のナイフに q0 を足しても合成できない。
    useRogue.setState({
      player: { ...player(), pack: [...player().pack, { item: 'knife', q: 0 }] },
    });
    const idx1 = player().pack.findIndex((x) => x.item === 'knife' && x.q === 1);
    useRogue.getState().mergeItem(idx1);
    expect(player().pack.filter((x) => x.item === 'knife' && x.q === 1)).toHaveLength(1);
    expect(useRogue.getState().log.at(-1)).toContain('同じ品質');
  });

  it('装備を外すと所持品に戻り(ターン消費なし)、合成の材料にできる', () => {
    // 初期武器 dagger(q0)+ 所持品に dagger(q0)を足して、外してから合成する。
    useRogue.setState({
      player: { ...player(), pack: [...player().pack, { item: 'dagger', q: 0 }] },
    });
    const atk0 = playerAtk(player());
    useRogue.getState().unequip('weapon');
    expect(player().weapon).toBeNull();
    expect(playerAtk(player())).toBeLessThan(atk0); // 素手に戻る
    expect(useRogue.getState().turn).toBe(0); // 外すのはターン消費なし
    const idx = player().pack.findIndex((x) => x.item === 'dagger');
    useRogue.getState().mergeItem(idx);
    const merged = player().pack.filter((x) => x.item === 'dagger');
    expect(merged).toHaveLength(1);
    expect(merged[0].q).toBe(1);
    // 何も装備していないときは何も起きない。
    useRogue.getState().unequip('armor');
    expect(player().armor).toBeNull();
  });
});

describe('明かり(rogue-4)', () => {
  it('広げるほど1歩あたりの発見が増える', async () => {
    // 同じ seed で「絞る」と「広げる」を比較。
    useRogue.getState().restart(7);
    useRogue.setState({ lightLevel: 0 });
    const to = freeNeighbor();
    useRogue.getState().clickCell(to);
    await run();
    const narrow = useRogue.getState().discovered.size;

    useRogue.getState().restart(7);
    useRogue.getState().cycleLight(); // 1→2(広げる)
    expect(useRogue.getState().lightLevel).toBe(2);
    useRogue.getState().clickCell(to);
    await run();
    expect(useRogue.getState().discovered.size).toBeGreaterThan(narrow);
  });

  it('明かりが強いほど自然回復が早い(4ターンごと)', () => {
    useRogue.setState({ lightLevel: 2, player: { ...player(), hp: 10 } });
    for (let i = 0; i < 4; i++) useRogue.getState().wait();
    expect(player().hp).toBe(11);
  });
});

describe('設置物(rogue-4)', () => {
  /** テスト用: パックへ入れて足元に設置する。 */
  function placeDevice(item: ItemStack): void {
    useRogue.setState({ player: { ...player(), pack: [...player().pack, item] } });
    const idx = player().pack.findIndex((x) => x.item === item.item && x.q === item.q);
    useRogue.getState().useItem(idx);
    // 罠は設置先の選択モードに入る(rogue-9)ので、足元を選んで確定する。
    if (useRogue.getState().uiMode === 'place') {
      useRogue.getState().clickCell(useRogue.getState().player.pos);
    }
  }

  it('棘の罠: 敵が踏むと大ダメージ(弱敵は即死)して罠は消える', () => {
    // 敵の接近先が必ず罠になるよう、プレイヤーの全隣接セルへ罠を敷き、
    // 敵をプレイヤーから2歩の位置に置く(接近の1歩は隣接セル=罠に入る)。
    placeDevice({ item: 'trapSpike', q: 0 });
    expect(useRogue.getState().traps).toHaveLength(1);
    const trapPos = useRogue.getState().traps[0].pos;
    const s = useRogue.getState();
    const occupied = new Set(s.beasts.filter((x) => x.alive).map((x) => cellKey(x.pos)));
    const frees = neighbors(s.player.pos).filter(
      (c) => s.dungeon.open.has(cellKey(c)) && !occupied.has(cellKey(c)),
    );
    const extraTraps = frees
      .filter((c) => cellKey(c) !== cellKey(trapPos))
      .map((c, i) => ({ id: 900 + i, item: 'trapSpike' as const, kind: 'spike' as const, q: 0, pos: c }));
    useRogue.setState({ traps: [...s.traps, ...extraTraps] });
    // 敵をプレイヤーから2歩の位置に置く(接近の1歩目で必ず隣接セル=罠に入る)。
    const far = useRogue.getState().reach.cells.find(
      (c) => !neighbors(useRogue.getState().player.pos).some((n) => cellKey(n) === cellKey(c)),
    )!;
    const beast: Beast = {
      id: 950,
      kind: 'bat',
      pos: far,
      hp: 5,
      home: far,
      homeChamber: 0,
      layerFloor: -999,
      layerCeil: 999,
      awake: true,
      alive: true,
      status: null,
      carry: null,
    };
    useRogue.setState({ beasts: [...useRogue.getState().beasts, beast] });
    const traps0 = useRogue.getState().traps.length;
    useRogue.getState().wait();
    const after = useRogue.getState();
    // 罠がひとつ消費され、コウモリ(hp5)は棘(威力8)で即死。
    expect(after.traps.length).toBe(traps0 - 1);
    expect(after.beasts.find((x) => x.id === 950)!.alive).toBe(false);
  });

  it('眠りの罠を踏んだ敵は行動不能になる', () => {
    // 直接ステータスを与えて挙動を確認(発動経路は棘のテストで担保)。
    const b = placeBeastAdjacent('ghoul');
    b.status = { kind: 'sleep', turns: 3 };
    const hp0 = player().hp;
    useRogue.getState().wait();
    useRogue.getState().wait();
    expect(player().hp).toBe(hp0); // 眠っている間は攻撃されない
    const after = useRogue.getState().beasts.find((x) => x.id === b.id)!;
    expect(after.status?.kind).toBe('sleep');
  });

  it('魔導砲塔は射程内の敵を毎ターン撃ち、時限で沈黙する', () => {
    placeDevice({ item: 'turret', q: 0 });
    const b = placeBeastAdjacent('drake'); // hp20: 数ターンでは死なない
    const hp0 = b.hp;
    useRogue.getState().wait();
    const after = useRogue.getState().beasts.find((x) => x.id === b.id)!;
    expect(after.hp).toBeLessThan(hp0);
    expect(useRogue.getState().turrets[0].turns).toBeLessThan(8);
  });

  it('囮人形は敵のターゲットを吸い、壊れるまで殴られる', () => {
    // 囮を足元へ設置してからプレイヤーが離れる → 敵は近い囮を殴る。
    placeDevice({ item: 'decoy', q: 0 });
    const decoyPos = useRogue.getState().decoys[0].pos;
    const b = placeBeastAdjacent('ghoul'); // 囮(=プレイヤー足元)にも隣接している
    void b;
    const hp0 = useRogue.getState().decoys[0].hp;
    // プレイヤーを退避(囮の方が敵に厳密に近くなる位置へ: 囮にも敵にも隣接しない)。
    const bPos = useRogue.getState().beasts.find((x) => x.id === 900)!.pos;
    const far = useRogue.getState().reach.cells.find(
      (c) =>
        !neighbors(decoyPos).some((n) => cellKey(n) === cellKey(c)) &&
        !neighbors(bPos).some((n) => cellKey(n) === cellKey(c)) &&
        cellKey(c) !== cellKey(decoyPos) &&
        cellKey(c) !== cellKey(bPos),
    );
    if (far) useRogue.setState({ player: { ...player(), pos: far } });
    const hpP = player().hp;
    useRogue.getState().wait();
    const s = useRogue.getState();
    expect(player().hp).toBe(hpP); // プレイヤーは無傷
    if (s.decoys.length > 0) expect(s.decoys[0].hp).toBeLessThan(hp0);
  });
});

describe('深層拡張(rogue-9)', () => {
  /** id 指定で任意セルに敵を置く。 */
  function putBeast(id: number, kind: keyof typeof BEASTS, pos: [number, number, number]): Beast {
    const b: Beast = {
      id,
      kind,
      pos,
      hp: BEASTS[kind].hp,
      home: pos,
      homeChamber: 0,
      layerFloor: -999,
      layerCeil: 999,
      awake: true,
      alive: true,
      status: null,
      carry: null,
    };
    useRogue.setState({ beasts: [...useRogue.getState().beasts, b] });
    return b;
  }

  it('長槍は2歩先の敵に届く(短剣では届かない)', async () => {
    const s = useRogue.getState();
    const far = s.reach.cells.find((c) => stepDist(s.player.pos, c) === 2)!;
    putBeast(960, 'ghoul', far);
    // 短剣(初期装備・リーチ1)では攻撃にならない。
    useRogue.getState().clickBeast(960);
    expect(useRogue.getState().turn).toBe(0);
    // 長槍(リーチ2)に持ち替えると攻撃できる。
    useRogue.setState({ player: { ...player(), weapon: { item: 'spear', q: 0 } } });
    useRogue.getState().clickBeast(960);
    await run();
    expect(useRogue.getState().turn).toBe(1);
    expect(useRogue.getState().beasts.find((x) => x.id === 960)!.hp).toBeLessThan(BEASTS.ghoul.hp);
  });

  it('大鎚はリーチ内の敵全員に当たる(薙ぎ払い)', async () => {
    placeBeastAdjacent('ghoul'); // id 900
    const pos2 = freeNeighbor(); // 900 を避けた別の隣接セル
    putBeast(901, 'ghoul', pos2);
    useRogue.setState({ player: { ...player(), weapon: { item: 'maul', q: 0 } } });
    useRogue.getState().clickBeast(900);
    await run();
    const after = useRogue.getState().beasts;
    expect(after.find((x) => x.id === 900)!.hp).toBeLessThan(BEASTS.ghoul.hp);
    expect(after.find((x) => x.id === 901)!.hp).toBeLessThan(BEASTS.ghoul.hp);
  });

  it('罠は隣接セルにも設置できる(1ターン)が、2歩先には置けない', () => {
    const idx = player().pack.findIndex((x) => x.item === 'trapSpike');
    useRogue.getState().useItem(idx);
    expect(useRogue.getState().uiMode).toBe('place');
    // 2歩先は設置候補外(クリックしても何も起きない)。
    const s0 = useRogue.getState();
    const far = s0.reach.cells.find((c) => stepDist(s0.player.pos, c) === 2)!;
    useRogue.getState().clickCell(far);
    expect(useRogue.getState().uiMode).toBe('place');
    expect(useRogue.getState().traps).toHaveLength(0);
    // 隣接セルには置ける。
    const target = freeNeighbor();
    useRogue.getState().clickCell(target);
    const s = useRogue.getState();
    expect(s.uiMode).toBe('walk');
    expect(s.traps).toHaveLength(1);
    expect(cellKey(s.traps[0].pos)).toBe(cellKey(target));
    expect(s.turn).toBe(1);
  });
});

describe('探索支援(訪問/掃討/ファストトラベル)', () => {
  it('初期状態で入口の広間が訪問済み', () => {
    const s = useRogue.getState();
    expect(s.visitedChambers.has(0)).toBe(true);
    expect(s.cellChamber.get('0,0,0')).toBe(0);
  });

  it('広間のセルを踏むと訪問済みになり exploreRev が進む', async () => {
    const s = useRogue.getState();
    const n = freeNeighbor();
    s.cellChamber.set(cellKey(n), 99); // 隣を仮想の広間 99 に見立てる
    const rev0 = s.exploreRev;
    s.clickCell(n);
    await run();
    expect(useRogue.getState().visitedChambers.has(99)).toBe(true);
    expect(useRogue.getState().exploreRev).toBeGreaterThan(rev0);
  });

  it('掃討: ホームの敵を倒すと exploreRev が進み clearedChambers に載る', async () => {
    const b = placeBeastAdjacent('bat', 1);
    const rev0 = useRogue.getState().exploreRev;
    useRogue.getState().clickBeast(b.id);
    await run();
    const s = useRogue.getState();
    expect(s.exploreRev).toBeGreaterThan(rev0);
    expect(clearedChambers(s.visitedChambers, s.beasts).has(0)).toBe(true);
  });

  it('生きた敵が残る広間は clearedChambers に載らない', () => {
    placeBeastAdjacent('bat');
    const s = useRogue.getState();
    expect(clearedChambers(s.visitedChambers, s.beasts).has(0)).toBe(false);
  });

  it('travelTo: 発見済みの遠いセルへ複数ターンかけて自動移動する', async () => {
    const s = useRogue.getState();
    // 発見済みで最も遠いセルへ(入口広間に敵は居ないので中断されない)。
    let far = s.player.pos;
    let bestD = 0;
    for (const k of s.discovered) {
      const c = keyToCell(k);
      const d = stepDist(s.player.pos, c);
      if (d > bestD) {
        bestD = d;
        far = c;
      }
    }
    expect(bestD).toBeGreaterThan(2); // reach(2歩)の外
    s.travelTo(far);
    await run(20000);
    expect(cellKey(useRogue.getState().player.pos)).toBe(cellKey(far));
    expect(useRogue.getState().turn).toBeGreaterThanOrEqual(bestD);
    expect(useRogue.getState().busy).toBe(false);
  });

  it('travelTo: 未発見セルへは移動しない', () => {
    const s = useRogue.getState();
    s.travelTo([99, 99, 0]);
    expect(s.busy).toBe(false);
    expect(useRogue.getState().log.at(-1)).toContain('辿り着けない');
  });
});

describe('マップモードとターゲット巡回', () => {
  it('toggleMap で切り替わり、focus がプレイヤー位置になる', () => {
    const s = useRogue.getState();
    s.toggleMap();
    expect(useRogue.getState().mapMode).toBe(true);
    expect(cellKey(useRogue.getState().focus)).toBe(cellKey(s.player.pos));
    useRogue.getState().toggleMap();
    expect(useRogue.getState().mapMode).toBe(false);
  });

  it('マップの TAB は訪問済み広間の中央→プレイヤーを巡回する(フォーカス広間も更新)', () => {
    const s = useRogue.getState();
    s.toggleMap();
    useRogue.getState().cycleTarget();
    expect(cellKey(useRogue.getState().focus)).toBe(cellKey(s.dungeon.chambers[0].center));
    expect(useRogue.getState().mapFocusChamber).toBe(0);
    useRogue.getState().cycleTarget(); // 一周してプレイヤーへ
    expect(cellKey(useRogue.getState().focus)).toBe(cellKey(s.player.pos));
    expect(useRogue.getState().mapFocusChamber).toBeNull();
  });

  it('Shift+TAB(dir=-1)は逆順に巡回する', () => {
    const s = useRogue.getState();
    // 仮想の広間 99 を訪問済みに足して2部屋にする(center も用意)。
    s.cellChamber.set(cellKey(freeNeighbor()), 99);
    s.visitedChambers.add(99);
    s.dungeon.chambers[99] = { id: 99, center: freeNeighbor(), r: 1, cells: [] };
    s.toggleMap();
    // 初期状態からの逆順は「最後の広間」へ。
    useRogue.getState().cycleTarget(-1);
    expect(useRogue.getState().mapFocusChamber).toBe(99);
    useRogue.getState().cycleTarget(-1);
    expect(useRogue.getState().mapFocusChamber).toBe(0);
    // 正順に戻すと 99 へ(往復が対称)。
    useRogue.getState().cycleTarget(1);
    expect(useRogue.getState().mapFocusChamber).toBe(99);
    useRogue.getState().cycleTarget(1); // プレイヤー位置
    expect(useRogue.getState().mapFocusChamber).toBeNull();
  });

  it('ゲームの Shift+TAB は敵を逆順に巡回する', () => {
    const b1 = placeBeastAdjacent('bat'); // id 900(最近接)
    const s = useRogue.getState();
    const occupied = new Set(s.beasts.filter((x) => x.alive).map((x) => cellKey(x.pos)));
    const far = s.reach.cells.find(
      (c) => stepDist(s.player.pos, c) === 2 && !occupied.has(cellKey(c)),
    )!;
    const b2: Beast = {
      id: 901,
      kind: 'bat',
      pos: far,
      hp: 5,
      home: far,
      homeChamber: 0,
      layerFloor: -999,
      layerCeil: 999,
      awake: true,
      alive: true,
      status: null,
      carry: null,
    };
    useRogue.setState({ beasts: [...s.beasts, b2] });
    // 逆順の最初は「距離順の最後」= 遠い方(901)。
    useRogue.getState().cycleTarget(-1);
    expect(useRogue.getState().hoverBeastId).toBe(901);
    useRogue.getState().cycleTarget(-1);
    expect(useRogue.getState().hoverBeastId).toBe(b1.id);
  });

  it('travelToChamber: マップを閉じて部屋の入り口(最初の広間セル)まで移動する', async () => {
    // 発見済みの遠いセルを仮想の広間 99 に見立てる。
    const s = useRogue.getState();
    let far = s.player.pos;
    let bestD = 0;
    for (const k of s.discovered) {
      const c = keyToCell(k);
      const d = stepDist(s.player.pos, c);
      if (d > bestD) {
        bestD = d;
        far = c;
      }
    }
    expect(bestD).toBeGreaterThan(2);
    s.cellChamber.set(cellKey(far), 99);
    s.visitedChambers.add(99);
    s.toggleMap();
    useRogue.getState().travelToChamber(99);
    expect(useRogue.getState().mapMode).toBe(false); // 先にゲーム画面へ戻る
    await run(20000);
    const after = useRogue.getState();
    expect(after.cellChamber.get(cellKey(after.player.pos))).toBe(99); // 入り口=広間セルで停止
    expect(after.busy).toBe(false);
  });

  it('ゲームの TAB は部屋内の敵へ視線を向け情報パネルを出す', () => {
    const b = placeBeastAdjacent('bat');
    useRogue.getState().cycleTarget();
    expect(useRogue.getState().hoverBeastId).toBe(b.id);
    expect(view.phiGoal).not.toBeNull();
    expect(view.thetaGoal).toBeGreaterThanOrEqual(0.15);
  });

  it('TAB は部屋の外(通路など)でも、気づいて迫る敵を拾う', () => {
    const b = placeBeastAdjacent('bat'); // awake=true
    useRogue.getState().cellChamber.delete(cellKey(b.pos)); // 通路セルに見立てる
    useRogue.getState().cycleTarget();
    expect(useRogue.getState().hoverBeastId).toBe(b.id);
  });

  it('近くに敵がいなければログだけ出す', () => {
    useRogue.getState().cycleTarget();
    expect(useRogue.getState().log.at(-1)).toContain('気配はない');
    expect(view.phiGoal).toBeNull();
  });

  it('gazeAngles: theta は見やすい範囲にクランプされる', () => {
    const g = gazeAngles([0, 0, 0], [4, 4, 0]);
    expect(g.theta).toBeGreaterThanOrEqual(0.15);
    expect(g.theta).toBeLessThanOrEqual(0.9);
    expect(Number.isFinite(g.phi)).toBe(true);
  });
});

describe('敵の縄張り', () => {
  it('階層下限より下のセルへは追ってこない', () => {
    // プレイヤーの真下方向の空洞セルが必要なので、人工的に掘る。
    const s = useRogue.getState();
    const p = s.player.pos;
    const below: [number, number, number] = [p[0] - 1, p[1], p[2] - 1]; // 層 -1 の近傍
    s.dungeon.open.add(cellKey(below));
    const b = placeBeastAdjacent('spider');
    // ホーム層=現在層、vBelow=1 → layerFloor を現在層に固定して「下へ行けない」状況を作る。
    b.layerFloor = 0;
    useRogue.setState({
      beasts: [...s.beasts.filter((x) => x.id !== b.id), b],
      discovered: new Set([...s.discovered, cellKey(below)]),
    });
    useRogue.setState({ player: { ...player(), pos: below } });
    useRogue.getState().wait();
    useRogue.getState().wait();
    const after = useRogue.getState().beasts.find((x) => x.id === b.id)!;
    // 何ターン経っても階層下限(層0)より下へは踏み込まない。
    expect(layer(after.pos)).toBeGreaterThanOrEqual(0);
  });
});

describe('層リセット(rogue-19b)', () => {
  // layer=(x+y+z)/2, depthOf=round(-layer/4)。STRATUM_DEPTH=8 なので
  // 警告ライン=8・崩落ライン=10(層0→1のとき cutLayer=-4*(8*1-1)=-28)。
  const deep: [number, number, number] = [0, -88, 0]; // layer=-44 → depth=11(崩落ラインを超える)
  const deepNear: [number, number, number] = [1, -87, 0]; // deep の隣接セル
  const warnPos: [number, number, number] = [0, -72, 0]; // layer=-36 → depth=9(警告ライン以上・崩落ライン未満)

  function bat(id: number, pos: [number, number, number], carry: ItemStack | null = null): Beast {
    return {
      id,
      kind: 'bat',
      pos,
      hp: BEASTS.bat.hp,
      home: pos,
      homeChamber: 0,
      layerFloor: -999,
      layerCeil: 999,
      awake: false,
      alive: true,
      status: null,
      carry,
    };
  }

  it('崩落ラインを跨ぐと open/discovered が縮み、上層の敵が消え、stratum が増える', () => {
    const s0 = useRogue.getState();
    s0.dungeon.open.add(cellKey(deep));
    s0.dungeon.open.add(cellKey(deepNear));
    useRogue.setState({
      discovered: new Set([...s0.discovered, cellKey(deep), cellKey(deepNear)]),
      beasts: [...s0.beasts, bat(970, [0, 0, 0]), bat(971, deepNear)],
      player: { ...s0.player, pos: deep },
    });
    expect(useRogue.getState().dungeon.open.has('0,0,0')).toBe(true); // 崩落前は入口が開いている

    useRogue.getState().wait();

    const s = useRogue.getState();
    expect(s.stratum).toBe(1);
    expect(s.dungeon.cutLayer).toBe(-28);
    expect(s.dungeon.open.has('0,0,0')).toBe(false); // 入口(layer 0)は崩落
    expect(s.dungeon.open.has(cellKey(deep))).toBe(true); // 深い側は残る
    expect(s.discovered.has('0,0,0')).toBe(false);
    expect(s.discovered.has(cellKey(deep))).toBe(true);
    expect(s.beasts.some((b) => b.id === 970)).toBe(false); // 上層の敵は消える
    expect(s.beasts.some((b) => b.id === 971)).toBe(true); // 深い側の敵は残る
    // 崩落ログの後に実績解除ログ(rogue-25)が続くことがあるため at(-1) では見ない。
    expect(s.log.some((m) => m.includes('崩れ落ちた'))).toBe(true);
    expect(s.dungeon.chambers[0].collapsed).toBe(true); // 入口も墓標化(id は残る)
  });

  it('警告ラインでは一度だけログが出て、崩落ラインに届くまでは崩落しない', () => {
    useRogue.setState({ player: { ...player(), pos: warnPos } });
    useRogue.getState().wait();
    const s1 = useRogue.getState();
    expect(s1.stratum).toBe(0);
    expect(s1.log.some((m) => m.includes('きしみ'))).toBe(true);

    useRogue.getState().wait(); // 同じ深度で足踏みしても警告は繰り返さない
    const s2 = useRogue.getState();
    expect(s2.stratum).toBe(0);
    expect(s2.log.filter((m) => m.includes('きしみ')).length).toBe(1);
  });

  it('崩落後のセーブ→resume で cutLayer・stratum・敵の持ち物・行動ログが復元される', () => {
    persist.setStorageForTest(new MemStorage() as unknown as Storage);
    try {
      const s0 = useRogue.getState();
      s0.dungeon.open.add(cellKey(deep));
      useRogue.setState({
        discovered: new Set([...s0.discovered, cellKey(deep)]),
        beasts: [...s0.beasts, bat(972, deep, { item: 'potion', q: 1 })],
        player: { ...s0.player, pos: deep },
      });
      useRogue.getState().clickCell(deep); // 行動ログに1件残す(reach 外なので移動自体は起きない)
      useRogue.getState().wait(); // 崩落発動 + 自動保存
      expect(useRogue.getState().stratum).toBe(1);
      const savedLog = getActionLogForTest();
      expect(savedLog.length).toBeGreaterThan(0);

      const raw = persist.readSave<object>();
      useRogue.getState().restart(99); // 保存は破棄され、actionLog もリセットされる
      expect(useRogue.getState().resume()).toBe(false);
      persist.writeSave(raw); // 「リロード後の再開」を再現
      expect(useRogue.getState().resume()).toBe(true);

      const s = useRogue.getState();
      expect(s.stratum).toBe(1);
      expect(s.dungeon.cutLayer).toBe(-28);
      expect(s.beasts.find((b) => b.id === 972)?.carry).toEqual({ item: 'potion', q: 1 });
      expect(getActionLogForTest()).toEqual(savedLog);
    } finally {
      persist.setStorageForTest(null);
    }
  });
});

describe('ローカルスコアボード(rogue-20)', () => {
  it('死亡すると今回のランが履歴へ記録される', () => {
    history.setHistoryStorageForTest(new MemStorage() as unknown as Storage);
    try {
      placeBeastAdjacent('drake');
      useRogue.setState({ player: { ...player(), hp: 1 } });
      useRogue.getState().wait();
      const s = useRogue.getState();
      expect(s.phase).toBe('dead');
      const h = history.readHistory();
      expect(h).toHaveLength(1);
      expect(h[0].seed).toBe(s.seed);
      expect(h[0].maxDepth).toBe(s.maxDepth);
      expect(h[0].kills).toBe(s.kills);
      expect(h[0].turns).toBe(s.turn);
      expect(h[0].stratum).toBe(s.stratum);
      expect(h[0].deathCause).toBe(s.deathCause);
      expect(h[0].v).toBe(GAME_VERSION);
      expect(h[0].skills).toEqual(s.skillEquipped);
    } finally {
      history.setHistoryStorageForTest(null);
    }
  });

  it('自己ベスト(最深到達)を更新するとログに出る', () => {
    history.setHistoryStorageForTest(new MemStorage() as unknown as Storage);
    try {
      useRogue.setState({ maxDepth: 3 }); // 履歴が空なので必ず自己ベスト
      placeBeastAdjacent('drake');
      useRogue.setState({ player: { ...player(), hp: 1 } });
      useRogue.getState().wait();
      expect(useRogue.getState().log.some((m) => m.includes('自己ベスト'))).toBe(true);
    } finally {
      history.setHistoryStorageForTest(null);
    }
  });

  it('自己ベストに届かなければログに出ない', () => {
    history.setHistoryStorageForTest(new MemStorage() as unknown as Storage);
    try {
      history.appendRun({
        v: 'r19',
        seed: 999,
        date: '2026-01-01',
        turns: 1,
        kills: 0,
        maxDepth: 999, // 到底届かない自己ベスト
        stratum: 0,
        deathCause: 'テスト',
        daily: false,
        skills: [],
        escaped: false,
      });
      placeBeastAdjacent('drake');
      useRogue.setState({ player: { ...player(), hp: 1 } });
      useRogue.getState().wait();
      expect(useRogue.getState().log.some((m) => m.includes('自己ベスト'))).toBe(false);
    } finally {
      history.setHistoryStorageForTest(null);
    }
  });

  it('Node 環境相当(storage 未設定)ではシミュレータ経由でも履歴が汚れない', () => {
    // setHistoryStorageForTest を呼ばない = デフォルトの no-op storage のまま。
    placeBeastAdjacent('drake');
    useRogue.setState({ player: { ...player(), hp: 1 } });
    expect(() => useRogue.getState().wait()).not.toThrow();
    expect(history.readHistory()).toEqual([]);
  });
});

describe('障壁と状態異常(rogue-21)', () => {
  it('障壁の水薬は上書き式(加算せず、下方上書きもされる)', () => {
    const p = player();
    useRogue.setState({ player: { ...p, pack: [{ item: 'barrierPotion', q: 1 }] } });
    useRogue.getState().useItem(0); // 品質1 = 障壁10
    expect(player().barrier).toBe(10);
    useRogue.setState({ player: { ...player(), pack: [{ item: 'barrierPotion', q: 0 }] } });
    useRogue.getState().useItem(0); // 品質0 = 障壁8(10 から下方上書き)
    expect(player().barrier).toBe(8);
  });

  it('被弾はまず障壁が受け、HP は無傷(割れたらログ)', () => {
    placeBeastAdjacent('bat'); // 攻2 → ダメージ 1..3
    useRogue.setState({ player: { ...player(), barrier: 8 } });
    const hp0 = player().hp;
    useRogue.getState().wait();
    expect(player().hp).toBe(hp0);
    expect(player().barrier).toBeGreaterThanOrEqual(5);
    expect(player().barrier).toBeLessThan(8);
  });

  it('毒は障壁を素通りして HP に直撃し、切れるとログが出る', () => {
    useRogue.setState({ player: { ...player(), barrier: 8, status: { kind: 'poison', turns: 2 } } });
    const hp0 = player().hp;
    useRogue.getState().wait();
    expect(player().hp).toBe(hp0 - 1);
    expect(player().barrier).toBe(8); // 障壁は削れない
    useRogue.getState().wait();
    expect(player().hp).toBe(hp0 - 2);
    expect(player().status).toBeNull();
    expect(useRogue.getState().log.some((m) => m.includes('毒が抜けた'))).toBe(true);
  });

  it('毒死は死因「毒」で記録される', () => {
    useRogue.setState({ player: { ...player(), hp: 1, status: { kind: 'poison', turns: 3 } } });
    useRogue.getState().wait();
    const s = useRogue.getState();
    expect(s.phase).toBe('dead');
    expect(s.deathCause).toBe('毒');
  });

  it('解毒の水薬は状態異常を治し、品質ぶんの予防が毎ターン減る', () => {
    useRogue.setState({
      player: { ...player(), status: { kind: 'confuse', turns: 5 }, pack: [{ item: 'antidote', q: 2 }] },
    });
    useRogue.getState().useItem(0);
    expect(player().status).toBeNull();
    expect(player().immune).toBe(1); // 飲むのも1ターンなので直後に1減っている
    useRogue.getState().wait();
    expect(player().immune).toBe(0);
  });

  it('層の崩落で障壁が剥がれる', () => {
    const deep: [number, number, number] = [0, -88, 0]; // depth=11 → 崩落ライン超え
    useRogue.getState().dungeon.open.add('0,-88,0');
    useRogue.setState({ player: { ...player(), pos: deep, barrier: 16 } });
    useRogue.getState().wait();
    expect(useRogue.getState().stratum).toBe(1);
    expect(player().barrier).toBe(0);
    expect(useRogue.getState().log.some((m) => m.includes('障壁が剥がれた'))).toBe(true);
  });

  it('混乱中の歩行は決定的で、1歩ぶんだけ進む(逸れても隣接セル)', async () => {
    const walkOnce = async () => {
      useRogue.getState().restart(12345);
      seedRogueRng(5);
      useRogue.setState({ player: { ...player(), status: { kind: 'confuse', turns: 99 } } });
      const from = player().pos;
      const target = freeNeighbor();
      useRogue.getState().clickCell(target);
      await run(3000);
      return { from, to: player().pos };
    };
    const a = await walkOnce();
    const b = await walkOnce();
    expect(a.to).toEqual(b.to); // 同じシード・同じ乱数 → 同じ結果(決定性)
    expect(stepDist(a.from, a.to)).toBe(1); // どこへ逸れても1歩
  });
});

describe('新敵の性質(rogue-21)', () => {
  it('胞子茸は起きていても動かない', () => {
    const b = placeBeastAdjacent('mushnub');
    // 隣接だと攻撃してしまうので2歩離す: プレイヤー側を動かして距離を作る…の代わりに
    // 敵を遠くの空洞セルへ置き直す(縄張り中心も揃える)。
    const far = useRogue.getState().reach.cells.find((c) => stepDist(c, player().pos) === 2);
    if (far) {
      b.pos = far;
      b.home = far;
    }
    b.awake = true;
    const pos0 = [...b.pos];
    useRogue.getState().wait();
    useRogue.getState().wait();
    expect(useRogue.getState().beasts.find((x) => x.id === b.id)!.pos).toEqual(pos0);
  });

  it('胞子爆発: 隣接して倒すと混乱を受ける(予防中は無効)', async () => {
    const b = placeBeastAdjacent('mushnub', 1); // hp1 = 一撃で死ぬ
    useRogue.getState().clickBeast(b.id);
    await run(3000);
    expect(useRogue.getState().beasts.find((x) => x.id === b.id)!.alive).toBe(false);
    expect(player().status?.kind).toBe('confuse');

    // 予防があれば胞子は効かない。
    useRogue.getState().restart(7);
    seedRogueRng(42);
    const b2 = placeBeastAdjacent('mushnub', 1);
    useRogue.setState({ player: { ...player(), status: null, immune: 5 } });
    useRogue.getState().clickBeast(b2.id);
    await run(3000);
    expect(player().status).toBeNull();
  });

  it('毒ヘビの攻撃はいずれ毒を付与する(確率50%・シード固定で決定的)', () => {
    placeBeastAdjacent('snake', 999);
    useRogue.setState({ player: { ...player(), hp: 24 } });
    for (let i = 0; i < 10 && player().status?.kind !== 'poison'; i++) {
      useRogue.setState({ player: { ...player(), hp: 24 } }); // 毒死しないよう回復しながら
      useRogue.getState().wait();
    }
    expect(player().status?.kind).toBe('poison');
  });

  it('酸粘体の攻撃は障壁への削りだけ2倍', () => {
    placeBeastAdjacent('slime');
    useRogue.setState({ player: { ...player(), barrier: 20, hp: 24 } });
    useRogue.getState().wait();
    // dmg は 4..6(攻5・防0・±1)→ 酸で 2倍削り → 障壁は 20-2*dmg = 8..12。HP は無傷。
    expect(player().hp).toBe(24);
    expect(player().barrier).toBeGreaterThanOrEqual(8);
    expect(player().barrier).toBeLessThanOrEqual(12);
  });
});

describe('両手持ち・盾(rogue-22)', () => {
  it('盾を装備すると装備枠に入り(ターン消費なし)、外すと pack へ戻る', () => {
    useRogue.setState({ player: { ...player(), pack: [...player().pack, { item: 'shield', q: 0 }] } });
    const idx = player().pack.findIndex((x) => x.item === 'shield');
    useRogue.getState().useItem(idx);
    expect(player().shield).toEqual({ item: 'shield', q: 0 });
    expect(useRogue.getState().turn).toBe(0);
    useRogue.getState().unequip('shield');
    expect(player().shield).toBeNull();
    expect(player().pack.some((x) => x.item === 'shield')).toBe(true);
  });

  it('両手武器(長槍)を装備中は盾を装備できない(ログのみ・ターン消費なし)', () => {
    useRogue.setState({
      player: {
        ...player(),
        weapon: { item: 'spear', q: 0 },
        pack: [...player().pack, { item: 'shield', q: 0 }],
      },
    });
    const idx = player().pack.findIndex((x) => x.item === 'shield');
    useRogue.getState().useItem(idx);
    expect(player().shield).toBeNull();
    expect(useRogue.getState().log.at(-1)).toContain('両手がふさがっている');
    expect(useRogue.getState().turn).toBe(0);
  });

  it('盾を装備した状態で両手武器(大鎚)を構えると、盾が自動で外れて pack へ戻る', () => {
    useRogue.setState({
      player: {
        ...player(),
        shield: { item: 'shield', q: 0 },
        pack: [...player().pack, { item: 'maul', q: 0 }],
      },
    });
    const idx = player().pack.findIndex((x) => x.item === 'maul');
    useRogue.getState().useItem(idx);
    expect(player().weapon?.item).toBe('maul');
    expect(player().shield).toBeNull();
    expect(player().pack.some((x) => x.item === 'shield')).toBe(true);
    expect(useRogue.getState().log.some((m) => m.includes('盾を背負い直した'))).toBe(true);
  });

  it('盾装備で敵の攻撃がいずれ回避される(確率10%・シード固定で決定的)', () => {
    placeBeastAdjacent('bat');
    useRogue.setState({ player: { ...player(), shield: { item: 'shield', q: 0 }, hp: 24 } });
    let evaded = false;
    for (let i = 0; i < 200 && !evaded; i++) {
      useRogue.setState({ player: { ...player(), hp: 24 } }); // 被弾で死なないよう回復しながら
      useRogue.getState().wait();
      evaded = useRogue.getState().log.some((m) => m.includes('受け流した'));
    }
    expect(evaded).toBe(true);
  });

  it('セーブ v6: player.shield が保存・復元される', () => {
    persist.setStorageForTest(new MemStorage() as unknown as Storage);
    try {
      useRogue.getState().restart(7);
      useRogue.setState({ player: { ...player(), shield: { item: 'shield', q: 1 } } });
      useRogue.getState().wait(); // 自動保存
      const raw = persist.readSave<{ v: number }>();
      expect(raw?.v).toBe(6);
      useRogue.getState().restart(99);
      persist.writeSave(raw);
      expect(useRogue.getState().resume()).toBe(true);
      expect(player().shield).toEqual({ item: 'shield', q: 1 });
    } finally {
      persist.setStorageForTest(null);
    }
  });
});

describe('スキル: マスタリー×スロット(rogue-23)', () => {
  afterEach(() => {
    masteryStore.setMasteryStorageForTest(null);
  });

  describe('支度(ラン開始直後の自由装着)', () => {
    it('解禁済みノードがなければ支度パネルは開かない(既定=マスタリー0)', () => {
      const s = useRogue.getState();
      expect(s.skillOutfitting).toBe(false);
      expect(s.busy).toBe(false);
      expect(s.skillSlots).toBe(2);
      expect(s.skillEquipped).toEqual([]);
    });

    it('解禁済みノードが1つ以上あれば restart 直後に開き、ゲーム操作をブロックする', () => {
      masteryStore.setMasteryStorageForTest(new MemStorage() as unknown as Storage);
      masteryStore.writeMastery({ ...INITIAL_MASTERY, weaponKills: 10, evades: 0, absorbed: 0 }); // arms lv1 → kensan 解禁
      useRogue.getState().restart(7);
      const s = useRogue.getState();
      expect(s.skillOutfitting).toBe(true);
      expect(s.busy).toBe(true);
      expect(s.reach.cells).toEqual([]); // モーダル中は移動マーカーが出ない
      useRogue.getState().wait(); // busy 中は通常操作がブロックされる
      expect(useRogue.getState().turn).toBe(0);
    });

    it('装着でき、コスト超過は拒否される。閉じると通常操作に戻る', () => {
      masteryStore.setMasteryStorageForTest(new MemStorage() as unknown as Storage);
      masteryStore.writeMastery({ ...INITIAL_MASTERY, weaponKills: 30, evades: 0, absorbed: 0 }); // arms lv2 → kensan(1)+ryote(2) 解禁
      useRogue.getState().restart(7);
      useRogue.getState().equipSkill('kensan'); // コスト1・スロット2
      expect(useRogue.getState().skillEquipped).toEqual(['kensan']);
      useRogue.getState().equipSkill('ryote'); // コスト2、残り1では足りない → 拒否
      expect(useRogue.getState().skillEquipped).toEqual(['kensan']);
      expect(useRogue.getState().log.at(-1)).toContain('足りない');
      useRogue.getState().unequipSkill('kensan');
      useRogue.getState().equipSkill('ryote');
      expect(useRogue.getState().skillEquipped).toEqual(['ryote']);
      useRogue.getState().finishOutfitting();
      const s = useRogue.getState();
      expect(s.skillOutfitting).toBe(false);
      expect(s.busy).toBe(false);
      expect(s.reach.cells.length).toBeGreaterThan(0);
    });
  });

  describe('関門ドラフト', () => {
    // layer=(x+y+z)/2, depthOf=round(-layer/4)。STRATUM_DEPTH=8 の崩落ラインを超える位置
    // (層リセット(rogue-19b)のテストと同じ座標)。
    const deep: [number, number, number] = [0, -88, 0];

    it('候補ゼロ(マスタリー0)ならスロットだけ+1され、ドラフトは出ない', () => {
      useRogue.setState({ player: { ...player(), pos: deep } });
      useRogue.getState().wait();
      const s = useRogue.getState();
      expect(s.skillSlots).toBe(3);
      expect(s.skillDraft).toBeNull();
      expect(s.busy).toBe(false);
    });

    it('マスタリーがあれば3択が出て操作をブロックし、同じマスタリー・同じ乱数列なら同じ候補になる(決定性)', () => {
      masteryStore.setMasteryStorageForTest(new MemStorage() as unknown as Storage);
      masteryStore.writeMastery({ ...INITIAL_MASTERY, weaponKills: 80, evades: 40, absorbed: 300 }); // 全系統レベル3(7ノード全解禁)

      useRogue.getState().restart(7);
      useRogue.getState().finishOutfitting(); // 支度が開いていれば閉じる(マスタリーが乗っているため)
      seedRogueRng(42);
      useRogue.setState({ player: { ...player(), pos: deep } });
      useRogue.getState().wait();
      const s = useRogue.getState();
      expect(s.skillSlots).toBe(3);
      expect(s.skillDraft).not.toBeNull();
      expect(s.skillDraft).toHaveLength(3);
      expect(s.busy).toBe(true);
      expect(s.reach.cells).toEqual([]);
      const firstDraft = s.skillDraft;

      useRogue.getState().restart(7);
      useRogue.getState().finishOutfitting();
      seedRogueRng(42);
      useRogue.setState({ player: { ...player(), pos: deep } });
      useRogue.getState().wait();
      expect(useRogue.getState().skillDraft).toEqual(firstDraft);
    });

    it('ドラフトを見送ると何も装着されずに閉じる', () => {
      masteryStore.setMasteryStorageForTest(new MemStorage() as unknown as Storage);
      masteryStore.writeMastery({ ...INITIAL_MASTERY, weaponKills: 10, evades: 0, absorbed: 0 });
      useRogue.getState().restart(7);
      useRogue.getState().finishOutfitting();
      seedRogueRng(42);
      useRogue.setState({ player: { ...player(), pos: deep } });
      useRogue.getState().wait();
      expect(useRogue.getState().skillDraft).not.toBeNull();
      useRogue.getState().skipDraft();
      const s = useRogue.getState();
      expect(s.skillDraft).toBeNull();
      expect(s.skillEquipped).toEqual([]);
      expect(s.busy).toBe(false);
    });

    it('ドラフト中は既存装着を外して組み替えられる(コスト不足の候補も、外せば選べる)', () => {
      useRogue.setState({
        skillSlots: 3,
        skillEquipped: ['kensan', 'jutsu'], // コスト計1+1=2、残り1
        skillDraft: ['ryote'], // コスト2、残り1では足りない
      });
      useRogue.getState().equipSkill('ryote');
      expect(useRogue.getState().skillEquipped).toEqual(['kensan', 'jutsu']); // 拒否
      expect(useRogue.getState().skillDraft).toEqual(['ryote']); // ドラフトは閉じない

      useRogue.getState().unequipSkill('jutsu');
      expect(useRogue.getState().skillEquipped).toEqual(['kensan']);

      useRogue.getState().equipSkill('ryote');
      expect(useRogue.getState().skillEquipped).toEqual(['kensan', 'ryote']);
      expect(useRogue.getState().skillDraft).toBeNull(); // 選んだのでドラフトは閉じる
    });
  });

  describe('ノード効果の配線', () => {
    it('kouka(硬化): 障壁がある間、被ダメージ−1(最低1)を、同じ乱数列で比較して確認する', () => {
      let sawReduction = false;
      // LCG は下位ビットの初期値に偏りが出やすいので大きく散らしたシードを使う。
      for (let i = 1; i <= 40; i++) {
        const seed = i * 123457;
        useRogue.getState().restart(7);
        seedRogueRng(seed);
        placeBeastAdjacent('bat');
        useRogue.setState({ player: { ...player(), hp: 24, barrier: 10 }, skillEquipped: [] });
        useRogue.getState().wait();
        const rawDmg = 10 - useRogue.getState().player.barrier;

        useRogue.getState().restart(7);
        seedRogueRng(seed);
        placeBeastAdjacent('bat');
        useRogue.setState({ player: { ...player(), hp: 24, barrier: 10 }, skillEquipped: ['kouka'] });
        useRogue.getState().wait();
        const reducedDmg = 10 - useRogue.getState().player.barrier;

        expect(reducedDmg).toBeLessThanOrEqual(rawDmg);
        expect(reducedDmg).toBeGreaterThanOrEqual(Math.max(1, rawDmg - 1));
        if (reducedDmg < rawDmg) sawReduction = true;
      }
      expect(sawReduction).toBe(true);
    });

    it('ukekaeshi(受け反撃): 回避成功時、攻撃者へ floor(攻撃力/2) の固定反撃', () => {
      const b = placeBeastAdjacent('bat'); // hp=5
      const hp0 = b.hp; // b は store の beasts 配列と同一参照(damageBeast が直接書き換える)ので先に控える
      useRogue.setState({
        player: {
          ...player(),
          hp: 24,
          shield: { item: 'shield', q: 45 }, // 回避100%(10+2*45)で判定を決定的にする
          weapon: { item: 'dagger', q: 0 },
        },
        skillEquipped: ['ukekaeshi'],
      });
      const atk = playerAtk(useRogue.getState().player, ['ukekaeshi']);
      useRogue.getState().wait();
      expect(useRogue.getState().log.some((m) => m.includes('反撃'))).toBe(true);
      const beast = useRogue.getState().beasts.find((x) => x.id === b.id)!;
      expect(beast.hp).toBe(hp0 - Math.floor(atk / 2));
    });

    it('tenka(転化): HP満タン時の自然回復ティックが障壁+1に変わる(上限24)', () => {
      useRogue.setState({
        player: { ...player(), hp: player().maxHp, barrier: 0 },
        skillEquipped: ['tenka'],
        lightLevel: 1, // regenEvery=6
      });
      for (let i = 0; i < 6; i++) useRogue.getState().wait();
      expect(useRogue.getState().turn).toBe(6);
      expect(useRogue.getState().player.barrier).toBe(1);
    });

    it('tenka: 障壁は上限24を超えない', () => {
      useRogue.setState({
        player: { ...player(), hp: player().maxHp, barrier: 24 },
        skillEquipped: ['tenka'],
        lightLevel: 1,
      });
      for (let i = 0; i < 6; i++) useRogue.getState().wait();
      expect(useRogue.getState().player.barrier).toBe(24);
    });

    it('katate(片手扱い): 装着中は両手武器+盾を両立でき、外すと盾が自動でpackへ戻る', () => {
      useRogue.setState({
        player: {
          ...player(),
          weapon: { item: 'spear', q: 0 },
          pack: [...player().pack, { item: 'shield', q: 0 }],
        },
        skillEquipped: ['katate'],
        skillOutfitting: true, // unequipSkill は支度/ドラフト中のみ動く
      });
      const idx = player().pack.findIndex((x) => x.item === 'shield');
      useRogue.getState().useItem(idx);
      expect(player().shield).toEqual({ item: 'shield', q: 0 });
      expect(useRogue.getState().log.at(-1)).not.toContain('ふさがっている');

      useRogue.getState().unequipSkill('katate');
      expect(useRogue.getState().skillEquipped).toEqual([]);
      expect(player().shield).toBeNull();
      expect(player().pack.some((x) => x.item === 'shield')).toBe(true);
      expect(useRogue.getState().log.some((m) => m.includes('盾を背負い直した'))).toBe(true);
    });

    it('katate 装着中は両手武器を構えても盾が自動で外れない', () => {
      useRogue.setState({
        player: {
          ...player(),
          shield: { item: 'shield', q: 0 },
          pack: [...player().pack, { item: 'maul', q: 0 }],
        },
        skillEquipped: ['katate'],
      });
      const idx = player().pack.findIndex((x) => x.item === 'maul');
      useRogue.getState().useItem(idx);
      expect(player().weapon?.item).toBe('maul');
      expect(player().shield).toEqual({ item: 'shield', q: 0 }); // 外れない
    });
  });

  describe('マスタリー(永続カウンタ)の加算', () => {
    it('近接討伐で武技マスタリーが加算され、閾値到達でログが出る', async () => {
      masteryStore.setMasteryStorageForTest(new MemStorage() as unknown as Storage);
      masteryStore.writeMastery({ ...INITIAL_MASTERY, weaponKills: 9, evades: 0, absorbed: 0 });
      const b = placeBeastAdjacent('bat', 1); // hp=1で確実に一撃で倒す
      useRogue.getState().clickBeast(b.id);
      await run();
      expect(masteryStore.readMastery().weaponKills).toBe(10);
      expect(useRogue.getState().log.some((m) => m.includes('武技の心得が深まった(Lv1)'))).toBe(true);
    });

    it('投げナイフの討伐でも武技マスタリーが加算される', async () => {
      masteryStore.setMasteryStorageForTest(new MemStorage() as unknown as Storage);
      masteryStore.writeMastery({ ...INITIAL_MASTERY, weaponKills: 0, evades: 0, absorbed: 0 });
      const b = placeBeastAdjacent('bat', 1);
      const idx = player().pack.findIndex((x) => x.item === 'knife');
      useRogue.getState().useItem(idx);
      useRogue.getState().clickBeast(b.id);
      await run();
      expect(masteryStore.readMastery().weaponKills).toBe(1);
    });

    it('盾の回避成功で盾マスタリーが加算される(回避100%で決定的)', () => {
      masteryStore.setMasteryStorageForTest(new MemStorage() as unknown as Storage);
      masteryStore.writeMastery({ ...INITIAL_MASTERY, weaponKills: 0, evades: 0, absorbed: 0 });
      placeBeastAdjacent('bat');
      useRogue.setState({ player: { ...player(), hp: 24, shield: { item: 'shield', q: 45 } } });
      useRogue.getState().wait();
      expect(masteryStore.readMastery().evades).toBe(1);
    });

    it('障壁が実際に削れた量だけ甲殻マスタリーが加算される', () => {
      masteryStore.setMasteryStorageForTest(new MemStorage() as unknown as Storage);
      masteryStore.writeMastery({ ...INITIAL_MASTERY, weaponKills: 0, evades: 0, absorbed: 0 });
      placeBeastAdjacent('bat');
      useRogue.setState({ player: { ...player(), hp: 24, barrier: 10 } });
      useRogue.getState().wait();
      const absorbedAmt = 10 - useRogue.getState().player.barrier;
      expect(masteryStore.readMastery().absorbed).toBe(absorbedAmt);
      expect(absorbedAmt).toBeGreaterThan(0);
    });
  });

  it('RunRecord.skills: 死亡時点の装着スキルが履歴に残る', () => {
    history.setHistoryStorageForTest(new MemStorage() as unknown as Storage);
    try {
      useRogue.setState({ skillSlots: 3, skillEquipped: ['kensan', 'jutsu'] });
      placeBeastAdjacent('drake');
      useRogue.setState({ player: { ...player(), hp: 1 } });
      useRogue.getState().wait();
      expect(useRogue.getState().phase).toBe('dead');
      const h = history.readHistory();
      expect(h[0].skills).toEqual(['kensan', 'jutsu']);
    } finally {
      history.setHistoryStorageForTest(null);
    }
  });

  it('セーブ v6: skillSlots/skillEquipped/skillDraft が保存・復元される', () => {
    persist.setStorageForTest(new MemStorage() as unknown as Storage);
    try {
      useRogue.getState().restart(7);
      useRogue.setState({ skillSlots: 4, skillEquipped: ['kensan'], skillDraft: ['jutsu', 'kouka'] });
      useRogue.getState().wait();
      const raw = persist.readSave<{ v: number }>();
      expect(raw?.v).toBe(6);
      useRogue.getState().restart(99);
      persist.writeSave(raw);
      expect(useRogue.getState().resume()).toBe(true);
      const s = useRogue.getState();
      expect(s.skillSlots).toBe(4);
      expect(s.skillEquipped).toEqual(['kensan']);
      expect(s.skillDraft).toEqual(['jutsu', 'kouka']);
      expect(s.busy).toBe(true); // ドラフトが残っているのでブロックされたまま
    } finally {
      persist.setStorageForTest(null);
    }
  });
});

describe('rogue-24: スキル配線と新カウンタ', () => {
  it('背討ち: 未覚醒の敵へ×2ダメージ+隠密マスタリー加算(同じ事前awakeを共有)', async () => {
    masteryStore.setMasteryStorageForTest(new MemStorage() as unknown as Storage);
    try {
      const b = placeBeastAdjacent('bat', 999);
      b.awake = false;
      useRogue.setState({ skillEquipped: ['shinSegiri'], skillSlots: 6 });
      const hp0 = b.hp;
      useRogue.getState().clickBeast(b.id);
      await run(3000);
      const dealt = hp0 - useRogue.getState().beasts.find((x) => x.id === b.id)!.hp;
      // 攻4(短剣)±1 の2倍 = 6..10。倍化されていれば 6 以上。
      expect(dealt).toBeGreaterThanOrEqual(6);
      expect(useRogue.getState().log.some((m) => m.includes('背後から急所'))).toBe(true);
    } finally {
      masteryStore.setMasteryStorageForTest(null);
    }
  });

  it('素手で未覚醒の敵を倒すと拳闘・隠密の両マスタリーに加算される', async () => {
    masteryStore.setMasteryStorageForTest(new MemStorage() as unknown as Storage);
    try {
      const b = placeBeastAdjacent('rat', 1);
      b.awake = false;
      useRogue.setState({ player: { ...player(), weapon: null } });
      useRogue.getState().clickBeast(b.id);
      await run(3000);
      const m = masteryStore.readMastery();
      expect(m.fistKills).toBe(1);
      expect(m.stealthKills).toBe(1);
      expect(m.weaponKills).toBe(0); // 素手討伐は武技に入らない(rogue-24 で分離)
    } finally {
      masteryStore.setMasteryStorageForTest(null);
    }
  });

  it('罠で倒すと罠師マスタリーに加算され、連鎖装着なら隣の罠も誘爆する', () => {
    masteryStore.setMasteryStorageForTest(new MemStorage() as unknown as Storage);
    try {
      // 恐慌状態の敵は必ずプレイヤーから遠ざかる1歩を選ぶ。移動先を確実に罠にするため、
      // 敵の隣接セル(空洞・空き)すべてに棘の罠を敷く。hp1 なので踏んだ瞬間に死ぬ。
      const b = placeBeastAdjacent('rat', 1);
      b.awake = true;
      b.status = { kind: 'fear', turns: 3 };
      const s0 = useRogue.getState();
      const cands = neighbors(b.pos).filter((c) => {
        const k = cellKey(c);
        return (
          s0.dungeon.open.has(k) &&
          !s0.beasts.some((x) => x.alive && cellKey(x.pos) === k) &&
          cellKey(c) !== cellKey(s0.player.pos)
        );
      });
      expect(cands.length).toBeGreaterThan(0);
      useRogue.setState({
        skillEquipped: ['wanaRensa'],
        skillSlots: 6,
        traps: cands.map((pos, i) => ({ id: 910 + i, item: 'trapSpike' as const, kind: 'spike' as const, q: 0, pos })),
      });
      const total = cands.length;
      useRogue.getState().wait(); // 敵ターン: 恐慌で1歩逃げる → 罠発動(+隣接罠の誘爆)
      const m = masteryStore.readMastery();
      expect(m.trapKills).toBe(1); // 罠死は罠師マスタリーへ
      const consumed = total - useRogue.getState().traps.length;
      expect(consumed).toBeGreaterThanOrEqual(1); // 少なくとも踏んだ罠は消費
      // 誘爆(隣接する罠がある場合)は複数消費になる。全候補が孤立配置になる幾何は
      // 12近傍では起きない(隣接セル同士は必ずどれか互いに隣接する)ため、2個以上を期待。
      if (total >= 2) expect(consumed).toBeGreaterThanOrEqual(2);
    } finally {
      masteryStore.setMasteryStorageForTest(null);
    }
  });

  it('消灯: hiShobo 装着中のみ4段階循環し、外すと「絞る」へ戻る', () => {
    useRogue.setState({ skillEquipped: ['hiShobo'], skillSlots: 6, lightLevel: 2 });
    useRogue.getState().cycleLight();
    expect(useRogue.getState().lightLevel).toBe(3); // 広げる→消す
    useRogue.getState().cycleLight();
    expect(useRogue.getState().lightLevel).toBe(0); // 消す→絞る
    // 外すとき消灯状態なら絞るへ戻す(unequip はモーダル中のみ動くので支度状態にする)。
    useRogue.setState({ lightLevel: 3, skillOutfitting: true });
    useRogue.getState().unequipSkill('hiShobo');
    expect(useRogue.getState().lightLevel).toBe(0);
    expect(useRogue.getState().skillEquipped).not.toContain('hiShobo');
  });

  it('未装着では明かりは3段階のまま', () => {
    useRogue.setState({ lightLevel: 2 });
    useRogue.getState().cycleLight();
    expect(useRogue.getState().lightLevel).toBe(0);
  });

  it('反撃系(受け反撃・見切り)は同時装着できない', () => {
    useRogue.setState({ skillOutfitting: true, skillSlots: 6, skillEquipped: ['ukekaeshi'] });
    masteryStore.setMasteryStorageForTest(new MemStorage() as unknown as Storage);
    try {
      masteryStore.writeMastery({ ...INITIAL_MASTERY, evades: 40, fistKills: 40 });
      useRogue.getState().equipSkill('kenMikiri');
      expect(useRogue.getState().skillEquipped).not.toContain('kenMikiri');
      expect(useRogue.getState().log.some((m) => m.includes('反撃の技はひとつ'))).toBe(true);
    } finally {
      masteryStore.setMasteryStorageForTest(null);
    }
  });

  it('遠隔回収: wanaKaishu 装着中は設置済みの罠を回収できて1ターン進む', () => {
    const pos = freeNeighbor();
    useRogue.setState({
      skillEquipped: ['wanaKaishu'],
      skillSlots: 6,
      traps: [{ id: 901, item: 'trapSpike', kind: 'spike', q: 1, pos }],
    });
    const turn0 = useRogue.getState().turn;
    const packLen = player().pack.length;
    useRogue.getState().recoverTrap(901);
    expect(useRogue.getState().traps).toHaveLength(0);
    expect(player().pack).toHaveLength(packLen + 1);
    expect(player().pack.at(-1)).toEqual({ item: 'trapSpike', q: 1 });
    expect(useRogue.getState().turn).toBe(turn0 + 1);
    // 未装着では動かない。
    useRogue.setState({ skillEquipped: [], traps: [{ id: 902, item: 'trapSpike', kind: 'spike', q: 0, pos }] });
    useRogue.getState().recoverTrap(902);
    expect(useRogue.getState().traps).toHaveLength(1);
  });
});

describe('rogue-24: 遠隔攻撃・気配感知・門番', () => {
  it('術師は離れていても射線が通れば撃ってくる(遠隔攻撃)', () => {
    const far = useRogue.getState().reach.cells.find((c) => stepDist(c, player().pos) === 2);
    expect(far).toBeTruthy();
    const b: Beast = { id: 950, kind: 'mage', pos: far!, hp: BEASTS.mage.hp, home: far!, homeChamber: 0, layerFloor: -999, layerCeil: 999, awake: true, alive: true, status: null, carry: null };
    useRogue.setState({ beasts: [...useRogue.getState().beasts, b] });
    const hp0 = player().hp;
    useRogue.getState().wait();
    expect(player().hp).toBeLessThan(hp0);
  });

  it('気配感知(鬼火)には背討ちの倍化が乗らない', async () => {
    const b = placeBeastAdjacent('wisp', 999);
    b.awake = false;
    useRogue.setState({ skillEquipped: ['shinSegiri'], skillSlots: 6 });
    const hp0 = b.hp;
    useRogue.getState().clickBeast(b.id);
    await run(3000);
    const dealt = hp0 - useRogue.getState().beasts.find((x) => x.id === b.id)!.hp;
    expect(dealt).toBeLessThanOrEqual(5);
    expect(useRogue.getState().log.some((m) => m.includes('背後から急所'))).toBe(false);
  });

  it('門番を倒すとスキルスロットが+1される(上限6)', async () => {
    const b = placeBeastAdjacent('giant', 1);
    b.awake = true;
    useRogue.setState({ skillSlots: 3 });
    useRogue.getState().clickBeast(b.id);
    await run(3000);
    expect(useRogue.getState().skillSlots).toBe(4);
    expect(useRogue.getState().log.some((m) => m.includes('心得の器が広がる'))).toBe(true);
  });

  it('個体の atk/def 上書き(深度係数・門番)が戦闘に反映される', async () => {
    const b = placeBeastAdjacent('bat', 999);
    b.awake = true;
    b.defOverride = 3;
    useRogue.setState({ beasts: [...useRogue.getState().beasts] });
    const hp0 = b.hp;
    useRogue.getState().clickBeast(b.id);
    await run(3000);
    const dealt = hp0 - useRogue.getState().beasts.find((x) => x.id === b.id)!.hp;
    expect(dealt).toBeLessThanOrEqual(2);
  });
});

describe('図鑑と実績(rogue-25)', () => {
  afterEach(() => {
    codexStore.setCodexStorageForTest(null);
  });

  it('討伐すると討伐図鑑に討伐数と初討伐深度が記録される', async () => {
    codexStore.setCodexStorageForTest(new MemStorage() as unknown as Storage);
    const b = placeBeastAdjacent('bat', 1);
    useRogue.getState().clickBeast(b.id);
    await run(3000);
    const c = codexStore.readCodex();
    expect(c.beasts.bat?.kills).toBe(1);
    expect(c.beasts.bat?.firstDepth).toBe(0); // 入口(深度0)での討伐
  });

  it('地面のアイテムを拾うとアイテム図鑑に記録される', async () => {
    codexStore.setCodexStorageForTest(new MemStorage() as unknown as Storage);
    // 隣接セルに品質2の剣を置いて踏む(水薬は入口の初期配置と紛れるので使わない)。
    const pos = freeNeighbor();
    useRogue.setState({
      items: [...useRogue.getState().items, { id: 990, stack: { item: 'sword', q: 2 }, pos }],
    });
    useRogue.getState().clickCell(pos);
    await run(3000);
    const c = codexStore.readCodex();
    expect(c.items.sword?.found).toBe(1);
    expect(c.items.sword?.bestQ).toBe(2);
  });

  it('門番を撃破すると実績「門番討ち」が解除される(二度目はログが出ない)', async () => {
    codexStore.setCodexStorageForTest(new MemStorage() as unknown as Storage);
    const b = placeBeastAdjacent('giant', 1);
    b.awake = true;
    useRogue.getState().clickBeast(b.id);
    await run(3000);
    expect(codexStore.readCodex().feats).toContain('gatekeeper');
    expect(useRogue.getState().log.some((m) => m.includes('実績解除: 門番討ち'))).toBe(true);
    // 2体目では既達成なのでログは増えない。
    const before = useRogue.getState().log.filter((m) => m.includes('実績解除: 門番討ち')).length;
    const b2 = placeBeastAdjacent('giant', 1);
    b2.awake = true;
    useRogue.getState().clickBeast(b2.id);
    await run(3000);
    const after = useRogue.getState().log.filter((m) => m.includes('実績解除: 門番討ち')).length;
    expect(after).toBe(before);
    expect(codexStore.readCodex().feats.filter((f) => f === 'gatekeeper')).toHaveLength(1);
  });

  it('関門通過で「最初の関門」、HP満タンなら「無傷の関門」、暗ければ「暗闇行」も解除される', () => {
    codexStore.setCodexStorageForTest(new MemStorage() as unknown as Storage);
    const deep: [number, number, number] = [0, -88, 0]; // depth=11 → 崩落ライン超え
    useRogue.getState().dungeon.open.add(cellKey(deep));
    useRogue.setState({
      lightLevel: 0, // 絞る(isDimLight)
      player: { ...player(), pos: deep, hp: 24 },
    });
    useRogue.getState().wait(); // 崩落発動
    expect(useRogue.getState().stratum).toBe(1);
    const feats = codexStore.readCodex().feats;
    expect(feats).toContain('firstGate');
    expect(feats).toContain('pureGate');
    expect(feats).toContain('darkGate');
  });

  it('HP が満タンでなければ「無傷の関門」は解除されない', () => {
    codexStore.setCodexStorageForTest(new MemStorage() as unknown as Storage);
    const deep: [number, number, number] = [0, -88, 0];
    useRogue.getState().dungeon.open.add(cellKey(deep));
    useRogue.setState({
      lightLevel: 1, // 普通(暗くない)
      player: { ...player(), pos: deep, hp: 10 },
    });
    useRogue.getState().wait();
    const feats = codexStore.readCodex().feats;
    expect(feats).toContain('firstGate');
    expect(feats).not.toContain('pureGate');
    expect(feats).not.toContain('darkGate');
  });

  it('深度16へ到達すると実績「深淵の一瞥」が解除される', async () => {
    codexStore.setCodexStorageForTest(new MemStorage() as unknown as Storage);
    // 深度16相当のセル(layer=-64)を人工的に掘って1歩踏む。
    const at: [number, number, number] = [0, -126, 0]; // layer=-63 → depth=16(切り上げ丸め)
    expect(depthOf(at)).toBeGreaterThanOrEqual(16);
    const from: [number, number, number] = [1, -127, 0]; // at の隣接セル
    useRogue.getState().dungeon.open.add(cellKey(at));
    useRogue.getState().dungeon.open.add(cellKey(from));
    useRogue.setState({
      discovered: new Set([...useRogue.getState().discovered, cellKey(at), cellKey(from)]),
      player: { ...player(), pos: from },
      stratum: 2, // 崩落ライン(8*(stratum+1)+2=26)に触れない層まで進んでいる想定
    });
    useRogue.getState().travelTo(at);
    await run(3000);
    expect(useRogue.getState().maxDepth).toBeGreaterThanOrEqual(16);
    expect(codexStore.readCodex().feats).toContain('deep16');
  });

  it('罠での討伐が累計5に達すると実績「罠師の誇り」が解除される', () => {
    codexStore.setCodexStorageForTest(new MemStorage() as unknown as Storage);
    masteryStore.setMasteryStorageForTest(new MemStorage() as unknown as Storage);
    try {
      masteryStore.writeMastery({ ...INITIAL_MASTERY, trapKills: 4 }); // あと1体
      // 敵の接近先に棘の罠を敷いて踏ませる(rogue-4 の罠テストと同じ構図)。
      const trapPos = freeNeighbor();
      useRogue.setState({
        traps: [{ id: 900, item: 'trapSpike', kind: 'spike', q: 0, pos: trapPos }],
      });
      const far = useRogue.getState().reach.cells.find(
        (c) => stepDist(useRogue.getState().player.pos, c) === 2 && neighbors(trapPos).some((n) => cellKey(n) === cellKey(c)),
      );
      expect(far).toBeTruthy();
      const beast: Beast = {
        id: 951,
        kind: 'bat',
        pos: far!,
        hp: 1,
        home: far!,
        homeChamber: 0,
        layerFloor: -999,
        layerCeil: 999,
        awake: true,
        alive: true,
        status: null,
        carry: null,
      };
      // プレイヤーの全隣接セルに罠を敷き詰めて、どこから来ても罠を踏むようにする。
      const s = useRogue.getState();
      const occupied = new Set(s.beasts.filter((x) => x.alive).map((x) => cellKey(x.pos)));
      const extraTraps = neighbors(s.player.pos)
        .filter((c) => s.dungeon.open.has(cellKey(c)) && !occupied.has(cellKey(c)) && cellKey(c) !== cellKey(trapPos))
        .map((c, i) => ({ id: 901 + i, item: 'trapSpike' as const, kind: 'spike' as const, q: 0, pos: c }));
      useRogue.setState({
        traps: [...useRogue.getState().traps, ...extraTraps],
        beasts: [...s.beasts, beast],
      });
      useRogue.getState().wait(); // 敵が接近 → 罠発動 → 討伐5体目
      expect(useRogue.getState().beasts.find((x) => x.id === 951)!.alive).toBe(false);
      expect(codexStore.readCodex().feats).toContain('trapper5');
      expect(masteryStore.readMastery().trapKills).toBe(5);
    } finally {
      masteryStore.setMasteryStorageForTest(null);
    }
  });
});

describe('遺物と脱出(rogue-25 後半)', () => {
  afterEach(() => {
    codexStore.setCodexStorageForTest(null);
    history.setHistoryStorageForTest(null);
    persist.setStorageForTest(null);
  });

  it('巣の琥珀を拾うと実績「初めての琥珀」が解除され、専用ログが出る', async () => {
    codexStore.setCodexStorageForTest(new MemStorage() as unknown as Storage);
    const pos = freeNeighbor();
    useRogue.setState({
      items: [...useRogue.getState().items, { id: 995, stack: { item: 'amber', q: 0 }, pos }],
    });
    useRogue.getState().clickCell(pos);
    await run(3000);
    expect(player().pack.some((x) => x.item === 'amber')).toBe(true);
    expect(codexStore.readCodex().feats).toContain('relic');
    expect(useRogue.getState().log.some((m) => m.includes('巣の琥珀を見つけた'))).toBe(true);
  });

  it('琥珀は使ってもターンを消費せず、専用ログが出るだけ(消費されない)', () => {
    useRogue.setState({ player: { ...player(), pack: [...player().pack, { item: 'amber', q: 1 }] } });
    const idx = player().pack.findIndex((x) => x.item === 'amber');
    const turn0 = useRogue.getState().turn;
    useRogue.getState().useItem(idx);
    expect(useRogue.getState().turn).toBe(turn0);
    expect(player().pack.some((x) => x.item === 'amber')).toBe(true);
    expect(useRogue.getState().log.at(-1)).toContain('大切なものだ');
  });

  it('琥珀は合成できない(ターン消費なし・所持は変わらない)', () => {
    useRogue.setState({
      player: { ...player(), pack: [...player().pack, { item: 'amber', q: 1 }, { item: 'amber', q: 1 }] },
    });
    const idx = player().pack.findIndex((x) => x.item === 'amber');
    const turn0 = useRogue.getState().turn;
    useRogue.getState().mergeItem(idx);
    expect(useRogue.getState().turn).toBe(turn0);
    expect(player().pack.filter((x) => x.item === 'amber')).toHaveLength(2);
    expect(useRogue.getState().log.at(-1)).toContain('合成できない');
  });

  it('警告帯の外では脱出できない(phase は play のまま)', () => {
    expect(depthOf(player().pos)).toBe(0); // 入口(警告帯=深度8〜9より浅い)
    useRogue.getState().escape();
    expect(useRogue.getState().phase).toBe('play');
  });

  it('警告帯で脱出すると phase が escaped になり、琥珀が展示棚へ確定・履歴に生還が記録される', () => {
    codexStore.setCodexStorageForTest(new MemStorage() as unknown as Storage);
    history.setHistoryStorageForTest(new MemStorage() as unknown as Storage);
    persist.setStorageForTest(new MemStorage() as unknown as Storage);
    useRogue.getState().wait(); // 自動保存を1回発生させておく(脱出で破棄されることの確認用)
    expect(persist.hasSave()).toBe(true);
    useRogue.setState({
      player: {
        ...player(),
        pos: [0, -64, 0], // depthOf=8(stratum0 の警告帯 8〜9)
        pack: [...player().pack, { item: 'amber', q: 0 }, { item: 'amber', q: 1 }],
      },
      stratum: 0,
    });
    useRogue.getState().escape();
    const s = useRogue.getState();
    expect(s.phase).toBe('escaped');
    expect(persist.hasSave()).toBe(false);
    const c = codexStore.readCodex();
    expect(c.ambers).toBe(2);
    expect(c.bestStratumEscape).toBe(1);
    const h = history.readHistory();
    expect(h).toHaveLength(1);
    expect(h[0].escaped).toBe(true);
    expect(h[0].deathCause).toBe('生還');
    expect(h[0].maxDepth).toBe(s.maxDepth);
    expect(h[0].v).toBe(GAME_VERSION);
  });

  it('死亡時は pack の琥珀が失われる(展示棚には加算されない)', () => {
    codexStore.setCodexStorageForTest(new MemStorage() as unknown as Storage);
    useRogue.setState({
      player: { ...player(), pack: [...player().pack, { item: 'amber', q: 0 }], hp: 1 },
    });
    placeBeastAdjacent('drake');
    useRogue.getState().wait();
    expect(useRogue.getState().phase).toBe('dead');
    expect(codexStore.readCodex().ambers).toBe(0);
  });
});
