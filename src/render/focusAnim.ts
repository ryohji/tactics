// カメラフォーカスの補間（it-6）。game.focus（格子座標）の変化を購読し、
// 前フォーカス → 新フォーカスを ~350ms でスライドする。旧 activeAnim の後継。
// CameraRig が毎フレーム currentFocusGrid() を読む。

import { useGame } from '../state/game';

const DUR = 350; // 補間時間(ms)

let fromG: [number, number, number];
let toG: [number, number, number];
let startMs = -Infinity; // -Infinity の間は補間せず to を返す（初期表示）

{
  const f = useGame.getState().focus;
  fromG = [f[0], f[1], f[2]];
  toG = [f[0], f[1], f[2]];
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** 現在時刻における補間済みフォーカスの格子座標。 */
export function currentFocusGrid(now: number = performance.now()): [number, number, number] {
  const t = startMs === -Infinity ? 1 : Math.min(1, Math.max(0, (now - startMs) / DUR));
  const e = easeOutCubic(t);
  return [
    fromG[0] + (toG[0] - fromG[0]) * e,
    fromG[1] + (toG[1] - fromG[1]) * e,
    fromG[2] + (toG[2] - fromG[2]) * e,
  ];
}

useGame.subscribe((state, prev) => {
  if (state.focus === prev.focus) return;
  const f = state.focus;
  if (f[0] === toG[0] && f[1] === toG[1] && f[2] === toG[2]) return;
  const now = performance.now();
  fromG = currentFocusGrid(now);
  toG = [f[0], f[1], f[2]];
  startMs = now;
});
