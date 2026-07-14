// 戦闘分散用の乱数(ダンジョン生成は dungeon.rng)。rogue.ts 分割A1 で state/rogue.ts から移設。
// 保存/復元(saveCodec)で内部状態を持ち出せるようアクセサを公開する。

let rngState = (Date.now() ^ 0x2f6e2b1) >>> 0;

/** 戦闘乱数列を固定する(restart がシードから呼ぶ。テストは restart 後に上書き)。 */
export function seedRogueRng(seed: number): void {
  rngState = seed >>> 0;
}

export function rand(): number {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
}

/** 保存用: 乱数の内部状態を読む(autoSave が SaveData.rng へ書き出す)。 */
export function getRngState(): number {
  return rngState;
}

/** 復元用: 乱数の内部状態を書き戻す(resume が SaveData.rng から続ける)。 */
export function setRngState(v: number): void {
  rngState = v >>> 0;
}
