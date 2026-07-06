// タッチ操作(rogue-10)。
// マウスとタッチの切り替えは「直近の pointerdown の pointerType」で判定する
// (UA 判定ではなくイベント駆動 — タッチ対応ノート PC でもその都度正しく切り替わる)。
//
// 2段階タップ: タッチでは空間上の対象(移動マーカー・敵・バブル・罠の設置先)を
//   1度目のタップ=選択(ホバー相当の情報表示)、2度目の同一対象タップ=実行 とする。
// 選択中の対象キーは rogue ストアの armedKey が持つ(ターン進行やモード切替で解除)。
// HUD のボタン類は誤操作の被害が小さいため従来どおり1タップで実行する。

let touchInput = false;
let installed = false;

/** App から1度呼ぶ。以後、入力種別を自動追跡する。 */
export function installTouchFlag(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener(
    'pointerdown',
    (e) => {
      touchInput = e.pointerType === 'touch';
    },
    { capture: true },
  );
}

/** 直近の入力がタッチか。 */
export function isTouchInput(): boolean {
  return touchInput;
}

/** テスト用。 */
export function setTouchInputForTest(v: boolean): void {
  touchInput = v;
}

/**
 * タップの段階判定(純ロジック)。
 * マウスなら常に実行。タッチなら「選択済みの同一対象」のみ実行、それ以外は選択。
 */
export function tapAction(armedKey: string | null, key: string): 'execute' | 'arm' {
  if (!touchInput) return 'execute';
  return armedKey === key ? 'execute' : 'arm';
}
