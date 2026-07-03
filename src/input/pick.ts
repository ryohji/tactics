// クリックのピッキング（it-6）。TargetField の InstancedMesh がクリックされたとき、
// instanceId から Cell を逆引きして game 層へ渡す。ハイライトの意味（移動先/配置先/対象）は
// game 側が知っているので、ここでは cell を届けるだけ（対象セルはユニットへ解決して clickUnit）。
//
// カメラドラッグ直後の「離した瞬間のクリック」を誤認しないための抑制フラグは it-1 から踏襲。

import { cellKey, type Cell } from '../model/fcc';
import { useGame } from '../state/game';
import { consumeSuppressedClick } from './suppress';

// 抑制フラグの実体は suppress.ts へ分離(rogue と共用)。既存の import 先を保つため再 export。
export { setSuppressNextClick, consumeSuppressedClick } from './suppress';

// instanceId → Cell（TargetField が描画のたびに登録する。並びは instanceId と同じ）。
let fieldCells: Cell[] = [];

/** TargetField から描画順の Cell 配列を登録する。 */
export function setFieldCells(cells: Cell[]): void {
  fieldCells = cells;
}

/** レイキャストでヒットしたインスタンスをゲーム入力に解決する。 */
export function pickInstance(instanceId: number | undefined): void {
  if (consumeSuppressedClick()) return;
  if (instanceId === undefined) return;
  const cell = fieldCells[instanceId];
  if (!cell) return;
  const g = useGame.getState();
  if (g.highlightKind === 'target') {
    // 対象セル: そのセルに立つユニットへ解決して行動確定。
    const k = cellKey(cell);
    const t = g.units.find((u) => u.alive && cellKey(u.pos) === k);
    if (t) g.clickUnit(t.id);
    return;
  }
  g.clickCell(cell);
}
