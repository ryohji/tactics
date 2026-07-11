// rogue ストアのターン進行テスト。演出の sleep は fake timers で進める(game.test.ts と同型)。

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
import * as persist from './persist';
import * as history from './history';
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
    expect(s.log.at(-1)).toContain('崩れ落ちた');
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
      expect(h[0].v).toBe('r19');
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
