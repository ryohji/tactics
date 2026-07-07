// ゲーム用 BGM の窓口(rogue-5 / rogue-12 / rogue-16)。
// 生成エンジン本体は bgmEngine.ts、スタイル定義は bgmStyles.ts に切り出した。
// ゲーム本編は常に「洞窟」スタイル。他スタイルは bgm.html の試聴ページから
// エンジンを直接使う。ここは既存 API(startBgm/setBgmMuted/setBgmScene/
// setBgmDepth/stopBgm)を保つ薄いラッパ。
// Node/テスト環境では createBgmEngine が null を返すので全 API が no-op。

import { createBgmEngine, type BgmEngine, type BgmScene } from './bgmEngine';
import { CAVE } from './bgmStyles';

export type { BgmScene };

let engine: BgmEngine | null = null;
// エンジン未起動の間に届いた状態を覚えておき、起動時に引き渡す。
let muted = false;
let scene: BgmScene = 'game';
let depth = 0;

/** 初回ユーザ操作の後に呼ぶ(何度呼んでもよい)。 */
export function startBgm(): void {
  if (engine) return;
  engine = createBgmEngine(CAVE, { depth, scene, muted });
}

export function setBgmMuted(v: boolean): void {
  muted = v;
  engine?.setMuted(v);
}

export function setBgmScene(s: BgmScene): void {
  scene = s;
  engine?.setScene(s);
}

/** 現在深度の通知(ゲームがターンごとに呼ぶ)。層のバランスがなめらかに追従する。 */
export function setBgmDepth(d: number): void {
  depth = d;
  engine?.setDepth(d);
}

/** テスト・HMR 用の停止。 */
export function stopBgm(): void {
  engine?.dispose();
  engine = null;
}
