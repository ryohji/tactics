// キーボード入力(rogue)。ストア非依存のグローバルリスナー。
//   TAB   : ターゲット巡回(ゲーム=部屋内の敵へ視線 / マップ=訪問済み広間を巡回)
//   M     : マップモード切替
//   Space : 押している間、マップのドラッグを回転→移動(パン)に変える
// ブラウザ既定(TAB のフォーカス移動・Space のスクロール)は抑止する。

let spaceHeld = false;
let installed = false;

type Handlers = {
  onCycle: () => void;
  onToggleMap: () => void;
};

let handlers: Handlers | null = null;

export function isSpaceHeld(): boolean {
  return spaceHeld;
}

/** App から1度呼ぶ。後勝ちでハンドラを差し替える(HMR 対応)。 */
export function installKeys(h: Handlers): void {
  handlers = h;
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      handlers?.onCycle();
    } else if (e.key === 'm' || e.key === 'M') {
      handlers?.onToggleMap();
    } else if (e.code === 'Space') {
      e.preventDefault(); // ページスクロール抑止
      spaceHeld = true;
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') spaceHeld = false;
  });
  window.addEventListener('blur', () => {
    spaceHeld = false;
  });
}
