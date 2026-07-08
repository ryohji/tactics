// 可視性(たいまつの明かり)。rogue-17 で state/rogue.ts から分離した純関数。

import { OFFSETS, cellKey, type Cell, type CellKey } from '../fcc';
import { distW, type Dungeon } from '../dungeon';

/**
 * プレイヤーから空洞づたいに半径 seeR 以内を発見済みに加える(discovered を
 * in-place で拡張)。呼び出し側(store)が保持する Set を渡す設計 — 大量の
 * セルを毎ターン走査するため、新規 Set を作らず既存集合を育てる。
 * 戻り値は「新しく発見したセルがあったか」(store の再描画キー更新に使う)。
 */
export function discoverInto(
  dungeon: Dungeon,
  from: Cell,
  seeR: number,
  discovered: Set<CellKey>,
): boolean {
  const seen = new Set<CellKey>([cellKey(from)]);
  const queue: Cell[] = [from];
  let grew = false;
  while (queue.length > 0) {
    const c = queue.shift()!;
    const k = cellKey(c);
    if (!discovered.has(k)) {
      discovered.add(k);
      grew = true;
    }
    for (const o of OFFSETS) {
      const n: Cell = [c[0] + o[0], c[1] + o[1], c[2] + o[2]];
      const nk = cellKey(n);
      if (seen.has(nk) || !dungeon.open.has(nk)) continue;
      if (distW(from, n) > seeR) continue;
      seen.add(nk);
      queue.push(n);
    }
  }
  return grew;
}
