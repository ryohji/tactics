// 到達範囲・経路探索。rogue-17 で state/rogue.ts から分離した純関数。
// 発見済み空洞を通る BFS。プレイヤー/敵の占有セルはすべて呼び出し側から渡す。

import { OFFSETS, cellKey, keyToCell, type Cell, type CellKey } from '../fcc';
import type { Dungeon } from '../dungeon';

export interface Reach {
  cells: Cell[];
  parent: Map<CellKey, CellKey>;
}

/** クリック可能な移動先(発見済み空洞・敵なし・BFS≤maxSteps)。 */
export function computeReach(
  dungeon: Dungeon,
  discovered: ReadonlySet<CellKey>,
  occupied: ReadonlySet<CellKey>,
  from: Cell,
  maxSteps: number,
): Reach {
  const cells: Cell[] = [];
  const parent = new Map<CellKey, CellKey>();
  const start = cellKey(from);
  const depth = new Map<CellKey, number>([[start, 0]]);
  const queue: Cell[] = [from];
  while (queue.length > 0) {
    const c = queue.shift()!;
    const k = cellKey(c);
    const d = depth.get(k)!;
    if (d >= maxSteps) continue;
    for (const o of OFFSETS) {
      const n: Cell = [c[0] + o[0], c[1] + o[1], c[2] + o[2]];
      const nk = cellKey(n);
      if (depth.has(nk)) continue;
      if (!dungeon.open.has(nk) || !discovered.has(nk) || occupied.has(nk)) continue;
      depth.set(nk, d + 1);
      parent.set(nk, k);
      cells.push(n);
      queue.push(n);
    }
  }
  return { cells, parent };
}

/**
 * 発見済み空洞を通る任意長の最短経路(occupied セルは避ける)。
 * 目標は述語で与える(多目標 BFS — 最初に条件を満たしたセルで停止)。
 * [現在地, ..., 目的地] を返す。到達不能なら null。
 */
export function findPathWhere(
  dungeon: Dungeon,
  discovered: ReadonlySet<CellKey>,
  occupied: ReadonlySet<CellKey>,
  from: Cell,
  isGoal: (k: CellKey) => boolean,
): Cell[] | null {
  const start = cellKey(from);
  const parent = new Map<CellKey, CellKey>();
  const seen = new Set<CellKey>([start]);
  const queue: Cell[] = [from];
  let guard = 0;
  while (queue.length > 0 && guard++ < 6000) {
    const c = queue.shift()!;
    const ck = cellKey(c);
    for (const o of OFFSETS) {
      const n: Cell = [c[0] + o[0], c[1] + o[1], c[2] + o[2]];
      const nk = cellKey(n);
      if (seen.has(nk)) continue;
      if (!dungeon.open.has(nk) || !discovered.has(nk) || occupied.has(nk)) continue;
      seen.add(nk);
      parent.set(nk, ck);
      if (isGoal(nk)) {
        const path: Cell[] = [n];
        let k = nk;
        while (k !== start) {
          k = parent.get(k)!;
          path.unshift(keyToCell(k));
        }
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

/** 指定セルへの最短経路(occupied セルは避ける)。 */
export function findPath(
  dungeon: Dungeon,
  discovered: ReadonlySet<CellKey>,
  occupied: ReadonlySet<CellKey>,
  from: Cell,
  to: Cell,
): Cell[] | null {
  const goal = cellKey(to);
  if (goal === cellKey(from)) return null;
  if (!dungeon.open.has(goal) || !discovered.has(goal)) return null;
  if (occupied.has(goal)) return null;
  return findPathWhere(dungeon, discovered, occupied, from, (k) => k === goal);
}

/** reach.parent 木から経路を復元([現在地, ..., 目的地])。到達不能なら空配列。 */
export function pathFromReach(reach: Reach, from: Cell, to: Cell): Cell[] {
  const path: Cell[] = [to];
  let k = cellKey(to);
  const start = cellKey(from);
  while (k !== start) {
    const p = reach.parent.get(k);
    if (!p) return [];
    path.unshift(keyToCell(p));
    k = p;
  }
  return path;
}
