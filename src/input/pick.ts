// クリック移動のピッキング（W7 の一部 / 仕様10章・DESIGN §7）。
//
// クリック対象の球は1つの InstancedMesh で描く（Markers.tsx）。it-4 以降、その対象は
// active の「到達セル」群（十数個）に絞ってある。R3F のレイキャストが返す instanceId から
// 元の Cell を逆引きするための共有レジストリをここに置く。Markers と本ファイルは
// 同一担当（W5+W7 統合）なので内部結合でよい（DESIGN §8）。
//
// クリックで setActive を呼ぶだけ。到達セル外は store.setActive が自前で弾くので、
// ここでは判定しない（一方向データフロー: 入力→store→導出）。レイキャストは onClick 時のみ。

import { type Cell } from '../model/fcc';
import { useStore } from '../state/store';

// instanceId → Cell（到達セル列）。Markers が到達セルを再計算するたびに上書きする。
let markerCells: Cell[] = [];

// カメラドラッグ直後の「離した瞬間のクリック」を移動と誤認しないための抑制フラグ。
// CameraRig がドラッグ終了時に立て、次のクリックを1回だけ無視する。
let suppressNextClick = false;

/** Markers から描画順の Cell 配列を登録する（instanceId と同じ並び）。 */
export function setMarkerCells(cells: Cell[]): void {
  markerCells = cells;
}

/** 次の1クリックを無視するか設定する（CameraRig のドラッグ判定から呼ぶ）。 */
export function setSuppressNextClick(v: boolean): void {
  suppressNextClick = v;
}

/**
 * レイキャストでヒットしたインスタンスを active 移動に解決する。
 * instanceId から Cell を引き、store.setActive へ渡す（到達外は store が弾く）。
 */
export function pickInstance(instanceId: number | undefined): void {
  if (suppressNextClick) {
    suppressNextClick = false; // ドラッグ直後の1クリックを消費して終わり
    return;
  }
  if (instanceId === undefined) return;
  const cell = markerCells[instanceId];
  if (!cell) return;
  useStore.getState().setActive(cell);
}
