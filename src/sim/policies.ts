// バランスシミュレータ(rogue-19a)の方策。ストアを golden.test.ts の playTurn と
// 同じ形(useRogue.getState() を直接叩く)でヘッドレス駆動する。Three/React 非依存。

import { useRogue } from '../state/rogue';
import { cellKey, layer, type Cell } from '../model/fcc';
import { distW, stepDist, type Stub } from '../model/dungeon';

/** 1手ぶんの意思決定。i は手番インデックス(0始まり)。ストアは直接叩く。 */
export type Policy = (i: number) => Promise<void>;

/** busy(演出中)が下りるまで待つ。setTimeScaleForTest(0) 前提で高速に収束する。 */
async function waitIdle(): Promise<void> {
  while (useRogue.getState().busy) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

/** 隣接して生きている敵のうち最小 id(いなければ null)。golden.test.ts の pickTarget と同じ。 */
function pickTarget(): number | null {
  const s = useRogue.getState();
  const c = s.beasts
    .filter((b) => b.alive && stepDist(s.player.pos, b.pos) <= 1)
    .sort((a, b) => a.id - b.id);
  return c[0]?.id ?? null;
}

/** 最も深い(未使用の)スタブの出口。未踏の探索目標として使う。 */
function nearestStubGoal(stubs: readonly Stub[], fallback: Cell): Cell {
  const stub = stubs.filter((st) => !st.used).sort((a, b) => layer(a.exit) - layer(b.exit) || a.id - b.id)[0];
  return stub ? stub.exit : fallback;
}

/** goal に「最も近づく」reach セル(距離昇順・キーでタイブレーク)。 */
function pickApproachCell(cells: readonly Cell[], goal: Cell): Cell | undefined {
  return [...cells].sort(
    (a, b) => distW(a, goal) - distW(b, goal) || cellKey(a).localeCompare(cellKey(b)),
  )[0];
}

/**
 * greedy: golden.test.ts の固定方針(下手だが決定的)をそのまま移植した方策。
 * 1. 隣接する敵がいれば最小 id を殴る
 * 2. HP が半分未満で水薬があれば飲む
 * 3. 15 手ごとに、罠を持っていれば足元へ設置
 * 4. こちらに気づいた敵がいれば待って迎え撃つ
 * 5. それ以外は最小 id の未踏スタブへ自動歩行(拡張・湧き・発見を回す)
 */
export const greedy: Policy = async (i) => {
  const s = useRogue.getState();
  const target = pickTarget();
  if (target !== null) {
    s.clickBeast(target);
    return waitIdle();
  }
  const potion = s.player.pack.findIndex((it) => it.item === 'potion');
  if (s.player.hp < s.player.maxHp / 2 && potion >= 0) {
    s.useItem(potion);
    return waitIdle();
  }
  const trap = s.player.pack.findIndex((it) => it.item.startsWith('trap'));
  if (i % 15 === 14 && trap >= 0) {
    s.useItem(trap); // place モードへ
    useRogue.getState().clickCell(s.player.pos); // 足元に設置
    return waitIdle();
  }
  if (s.beasts.some((b) => b.alive && b.awake && stepDist(s.player.pos, b.pos) <= 6)) {
    s.wait(); // 近づく敵を迎え撃つ
    return waitIdle();
  }
  const goal = nearestStubGoal(s.dungeon.stubs, s.player.pos);
  const cell = pickApproachCell(s.reach.cells, goal);
  if (cell) {
    s.clickCell(cell);
    return waitIdle();
  }
  s.wait();
  return waitIdle();
};

/**
 * cautious: greedy との差分。
 * - HP が 2/3 未満で水薬を飲む(greedy は半分未満)
 * - 敵に気づかれたら、待たずに1歩「スタブと逆方向」の reach セルへ退いてから迎撃する
 * - 明かりは開始時に「絞る」へ切り替える(視界より安全側に倒す)
 */
export const cautious: Policy = async (i) => {
  if (i === 0) {
    while (useRogue.getState().lightLevel !== 0) {
      useRogue.getState().cycleLight(); // ターン消費なし
    }
  }
  const s = useRogue.getState();
  const target = pickTarget();
  if (target !== null) {
    s.clickBeast(target);
    return waitIdle();
  }
  const potion = s.player.pack.findIndex((it) => it.item === 'potion');
  if (s.player.hp < (s.player.maxHp * 2) / 3 && potion >= 0) {
    s.useItem(potion);
    return waitIdle();
  }
  const trap = s.player.pack.findIndex((it) => it.item.startsWith('trap'));
  if (i % 15 === 14 && trap >= 0) {
    s.useItem(trap);
    useRogue.getState().clickCell(s.player.pos);
    return waitIdle();
  }
  if (s.beasts.some((b) => b.alive && b.awake && stepDist(s.player.pos, b.pos) <= 6)) {
    const goal = nearestStubGoal(s.dungeon.stubs, s.player.pos);
    // 1歩ぶんの reach セルのうち、goal から最も遠ざかるもの(=スタブと逆方向)。
    const retreat = s.reach.cells
      .filter((c) => stepDist(s.player.pos, c) === 1)
      .sort((a, b) => distW(b, goal) - distW(a, goal) || cellKey(a).localeCompare(cellKey(b)))[0];
    if (retreat) {
      s.clickCell(retreat);
      return waitIdle();
    }
    s.wait(); // 退く先がない(行き止まり)ので迎え撃つ
    return waitIdle();
  }
  const goal = nearestStubGoal(s.dungeon.stubs, s.player.pos);
  const cell = pickApproachCell(s.reach.cells, goal);
  if (cell) {
    s.clickCell(cell);
    return waitIdle();
  }
  s.wait();
  return waitIdle();
};
