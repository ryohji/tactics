import { useRogue } from '../../state/rogue';

/** 脱出の確認モーダル(rogue-25。スキルパネルの流儀)。トップレベルに置き、
    hud-bottomarea の transform に巻き込まれず常に画面中央に出るようにする。 */
export function EscapeConfirmModal({ onClose }: { onClose: () => void }) {
  const pack = useRogue((s) => s.player.pack);
  const escape = useRogue((s) => s.escape);
  const amberCount = pack.filter((it) => it.item === 'amber').length;
  return (
    <div className="hud-help" onClick={onClose}>
      <div className="hud-help-panel escape-panel" onClick={(e) => e.stopPropagation()}>
        <h2>脱出する?</h2>
        <p>
          地表へ戻って収集を確定する。今回のランはここで終わる。
          <br />
          持ち物の琥珀 {amberCount} 個が展示棚に加わる。
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
