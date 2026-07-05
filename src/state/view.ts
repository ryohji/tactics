// 視点状態（it-6 QAフィードバック対応）。Three 非依存の可変シングルトン。
// CameraRig（毎フレーム読み書き）と GameHud（リセットボタン）が共有する。
//
// - phi/theta/R: 旋回角と距離。R=null は「既定距離を再導出せよ」の意味。
// - base: 視点モード（freeCam）中の旋回中心（格子座標）。null なら次フレームで
//   現在のユニットフォーカスから取り直す。通常モードでは常に null。

export interface ViewState {
  phi: number;
  theta: number;
  /** 旋回半径。null なら CameraRig がアリーナ既定へ再導出。 */
  R: number | null;
  /** 視点モードの旋回中心（格子座標）。null なら現フォーカスから再取得。 */
  base: [number, number, number] | null;
  /** 視線の目標角(TAB ターゲット巡回)。カメラが短弧で補間し、到達かドラッグで解除。 */
  phiGoal: number | null;
  thetaGoal: number | null;
}

const DEFAULT_PHI = 0.6;
const DEFAULT_THETA = 0.42;

export const view: ViewState = {
  phi: DEFAULT_PHI,
  theta: DEFAULT_THETA,
  R: null,
  base: null,
  phiGoal: null,
  thetaGoal: null,
};

/** 視線の目標角を設定する(カメラ側が滑らかに向ける)。 */
export function setGazeGoal(phi: number, theta: number): void {
  view.phiGoal = phi;
  view.thetaGoal = theta;
}

/** 視線の目標角を解除する(ユーザのドラッグ操作が優先)。 */
export function clearGazeGoal(): void {
  view.phiGoal = null;
  view.thetaGoal = null;
}

/** 視点リセット: 角度・距離を既定へ戻し、旋回中心をユニットフォーカスへ再アンカー。 */
export function resetView(): void {
  view.phi = DEFAULT_PHI;
  view.theta = DEFAULT_THETA;
  view.R = null;
  view.base = null;
  view.phiGoal = null;
  view.thetaGoal = null;
}
