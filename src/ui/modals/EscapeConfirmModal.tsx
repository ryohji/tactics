import { useRogue } from '../../state/rogue';

/** 脱出の確認モーダル(rogue-25。スキルパネルの流儀)。トップレベルに置き、
    hud-bottomarea の transform に巻き込まれず常に画面中央に出るようにする。 */
export function EscapeConfirmModal({ onClose }: { onClose: () => void }) {
  // 遺物(rogue-25・rogue-34で3種化)は pack ではなく relics に入る(既存バグ修正)。
  const relicCount = useRogue((s) => s.player.relics.length);
  const escape = useRogue((s) => s.escape);
  return (
    <div className="hud-help" onClick={onClose}>
      <div className="hud-help-panel escape-panel" onClick={(e) => e.stopPropagation()}>
        <h2>脱出する?</h2>
        <p>
          地表へ戻って収集を確定する。今回のランはここで終わる。
          <br />
          持ち物の遺物 {relicCount} 個が展示棚に加わる。
        </p>
        <div className="hud-over-buttons">
          <button
            className="primary"
            onClick={() => {
              escape();
              onClose();
            }}
          >
            確定
          </button>
          <button onClick={onClose}>やめる</button>
        </div>
      </div>
    </div>
  );
}
