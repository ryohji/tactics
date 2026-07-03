// カメラドラッグ直後の「離した瞬間のクリック」を誤認しないための抑制フラグ。
// tactics(pick.ts 経由)と rogue の両方で使うため、ストア非依存のここへ分離。

let suppressNextClick = false;

/** 次の1クリックを無視するか設定する(カメラリグのドラッグ判定から呼ぶ)。 */
export function setSuppressNextClick(v: boolean): void {
  suppressNextClick = v;
}

/** ドラッグ直後クリックなら true を返しつつ消費する。 */
export function consumeSuppressedClick(): boolean {
  if (suppressNextClick) {
    suppressNextClick = false;
    return true;
  }
  return false;
}
