// ユニット移動アニメ（it-6）。Three 非依存の純ロジック。
// game.ts が経路移動を開始すると登録し、描画側（Units.tsx / CameraRig）が毎フレーム
// currentUnitGrid() で補間位置を読む。store 上の pos は離散のまま即時更新される
// （it-2 の activeAnim と同じ思想を経路（複数ウェイポイント）へ一般化）。

import type { Cell } from '../model/fcc';

interface Anim {
  waypoints: Cell[];
  start: number;
  stepMs: number;
}

const anims = new Map<number, Anim>();

/** 1ステップあたりの既定時間(ms)。 */
export const STEP_MS = 110;

/**
 * unit id の経路アニメを開始し、総所要時間(ms)を返す。
 * path は [現在地, ..., 目的地]。長さ<2 なら何もしない（0 を返す）。
 */
export function animateUnit(id: number, path: Cell[], stepMs: number = STEP_MS): number {
  if (path.length < 2) return 0;
  anims.set(id, { waypoints: path, start: performance.now(), stepMs });
  return (path.length - 1) * stepMs;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * 現在時刻の補間済み格子座標。アニメが無い/終了済みなら fallback（store の離散 pos）。
 * 終了したアニメはここで破棄する。
 */
export function currentUnitGrid(
  id: number,
  fallback: Cell,
  now: number = performance.now(),
): [number, number, number] {
  const a = anims.get(id);
  if (!a) return [fallback[0], fallback[1], fallback[2]];
  const segs = a.waypoints.length - 1;
  const t = (now - a.start) / a.stepMs;
  if (t >= segs) {
    anims.delete(id);
    return [fallback[0], fallback[1], fallback[2]];
  }
  const i = Math.max(0, Math.floor(t));
  const f = easeInOut(Math.min(1, Math.max(0, t - i)));
  const p = a.waypoints[i];
  const q = a.waypoints[Math.min(i + 1, segs)];
  return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
}

/** 経路アニメが進行中か(描画側のポーズ切替用。期限切れの破棄はしない)。 */
export function isUnitMoving(id: number, now: number = performance.now()): boolean {
  const a = anims.get(id);
  if (!a) return false;
  return (now - a.start) / a.stepMs < a.waypoints.length - 1;
}

/** すべてのアニメを破棄（盤面リセット時）。 */
export function clearUnitAnims(): void {
  anims.clear();
}
