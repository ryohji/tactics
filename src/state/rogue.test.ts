// rogue ストアのターン進行テスト。演出の sleep は fake timers で進める(game.test.ts と同型)。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cellKey, keyToCell, layer, neighbors } from '../model/fcc';
import { stepDist } from '../model/dungeon';
import { useRogue, seedRogueRng, depthOf, playerAtk, clearedChambers, gazeAngles, type Beast } from './rogue';
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
  };
  useRogue.setState({ beasts: [...s.beasts, b] });
  return b;
}

async function run(ms = 3000) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  seedRogueRng(42);
  useRogue.getState().restart(7);
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

  it('HP が尽きると死亡フェーズになる', () => {
    placeBeastAdjacent('drake');
    useRogue.setState({ player: { ...player(), hp: 1 } });
    useRogue.getState().wait();
    expect(useRogue.getState().phase).toBe('dead');
    expect(useRogue.getState().reach.cells).toHaveLength(0);
  });

  it('投げナイフ: モードに入り射程内の敵へ当てて消費する', async () => {
    const b = placeBeastAdjacent('bat');
    const s = useRogue.getState();
    const idx = s.player.pack.indexOf('knife');
    const knives = s.player.pack.filter((i) => i === 'knife').length;
    s.useItem(idx);
    expect(useRogue.getState().uiMode).toBe('throw');
    useRogue.getState().clickBeast(b.id);
    await run();
    expect(useRogue.getState().uiMode).toBe('walk');
    expect(player().pack.filter((i) => i === 'knife').length).toBe(knives - 1);
    const after = useRogue.getState().beasts.find((x) => x.id === b.id)!;
    expect(after.hp).toBeLessThan(BEASTS.bat.hp);
  });
});

describe('アイテム', () => {
  it('水薬で回復し1ターン経過する', () => {
    useRogue.setState({ player: { ...player(), hp: 5 } });
    const idx = player().pack.indexOf('potion');
    useRogue.getState().useItem(idx);
    expect(player().hp).toBeGreaterThan(5);
    expect(useRogue.getState().turn).toBe(1);
    expect(player().pack.includes('potion')).toBe(false);
  });

  it('武器を拾って構えると攻撃力が上がる(元の武器は所持品へ)', () => {
    useRogue.setState({ player: { ...player(), pack: [...player().pack, 'waraxe'] } });
    const atk0 = playerAtk(player());
    const idx = player().pack.indexOf('waraxe');
    useRogue.getState().useItem(idx);
    expect(playerAtk(player())).toBeGreaterThan(atk0);
    expect(player().weapon).toBe('waraxe');
    expect(player().pack.includes('dagger')).toBe(true);
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

  it('マップの TAB は訪問済み広間の中央→プレイヤーを巡回する', () => {
    const s = useRogue.getState();
    s.toggleMap();
    useRogue.getState().cycleTarget();
    expect(cellKey(useRogue.getState().focus)).toBe(cellKey(s.dungeon.chambers[0].center));
    useRogue.getState().cycleTarget(); // 一周してプレイヤーへ
    expect(cellKey(useRogue.getState().focus)).toBe(cellKey(s.player.pos));
  });

  it('ゲームの TAB は部屋内の敵へ視線を向け情報パネルを出す', () => {
    const b = placeBeastAdjacent('bat');
    useRogue.getState().cycleTarget();
    expect(useRogue.getState().hoverBeastId).toBe(b.id);
    expect(view.phiGoal).not.toBeNull();
    expect(view.thetaGoal).toBeGreaterThanOrEqual(0.15);
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
