// 自機の移動アニメ（F1 / it-2）。store.active は離散のまま（クリックで即更新）だが、
// 描画側で「前 active → 新 active」を ~200ms で補間し、自機マーカーと TPカメラの回転中心 T を
// 滑らかにスライドさせる（瞬間ワープを避ける）。
//
// 補間は格子座標で行う（worldPos は線形なのでワールド補間と等価。S 変更が即時反映される）。
// store.active の変化を1度だけ購読し、from/to/開始時刻を更新する。各フレームの読み出しは
// currentActiveGrid(now) が純粋に計算する（中央ティッカ不要。CameraRig / SelfMarker が各自 useFrame で呼ぶ）。

import { useStore } from '../state/store';

const DUR = 200; // 補間時間(ms)
let fromG: [number, number, number];
let toG: [number, number, number];
let startMs = -Infinity; // -Infinity の間は補間せず to を返す（初期表示）

{
  const a = useStore.getState().active;
  fromG = [a[0], a[1], a[2]];
  toG = [a[0], a[1], a[2]];
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** 現在時刻における補間済み active の格子座標。 */
export function currentActiveGrid(now: number = performance.now()): [number, number, number] {
  const t = startMs === -Infinity ? 1 : Math.min(1, Math.max(0, (now - startMs) / DUR));
  const e = easeOutCubic(t);
  return [
    fromG[0] + (toG[0] - fromG[0]) * e,
    fromG[1] + (toG[1] - fromG[1]) * e,
    fromG[2] + (toG[2] - fromG[2]) * e,
  ];
}

// active が変わったら、その瞬間の補間値を新しい起点にして新 active へスライドし直す
// （移動中に再クリックされても折り返しが滑らかになる）。
useStore.subscribe((state, prev) => {
  if (state.active === prev.active) return;
  const a = state.active;
  if (a[0] === toG[0] && a[1] === toG[1] && a[2] === toG[2]) return; // 目標が同じなら無視
  const now = performance.now();
  fromG = currentActiveGrid(now);
  toG = [a[0], a[1], a[2]];
  startMs = now;
});
