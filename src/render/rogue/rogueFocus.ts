// カメラフォーカスの補間(rogue)。focusAnim.ts と同型だが useRogue を購読する。

import { useRogue } from '../../state/rogue';

const DUR = 350;

let fromG: [number, number, number];
let toG: [number, number, number];
let startMs = -Infinity;

{
  const f = useRogue.getState().focus;
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

useRogue.subscribe((state, prev) => {
  if (state.focus === prev.focus) return;
  const f = state.focus;
  if (f[0] === toG[0] && f[1] === toG[1] && f[2] === toG[2]) return;
  const now = performance.now();
  fromG = currentFocusGrid(now);
  toG = [f[0], f[1], f[2]];
  startMs = now;
});
