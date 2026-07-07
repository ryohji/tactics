// プレイヤーの一時ポーズ通知(rogue-13)。Three 非依存の小さなモジュール。
// rogue.ts(状態機械)が攻撃・投擲の演出開始時に triggerPose を呼び、
// 描画側(PlayerView)が毎フレーム currentPose を読んでアニメクリップを切り替える。
// store を汚さない使い捨ての合図(unitAnim と同じ思想)。

export type PlayerPose = 'attack' | 'throw';

let pose: { name: PlayerPose; until: number } | null = null;

export function triggerPose(name: PlayerPose, ms: number): void {
  pose = { name, until: performance.now() + ms };
}

export function currentPose(now: number = performance.now()): PlayerPose | null {
  if (pose && now < pose.until) return pose.name;
  pose = null;
  return null;
}
