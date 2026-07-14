import { useRogue, LIGHT } from '../../state/rogue';
import { resetView } from '../../state/view';

function LightButton({ busy }: { busy: boolean }) {
  const lightLevel = useRogue((s) => s.lightLevel);
  const cycleLight = useRogue((s) => s.cycleLight);
  return (
    <button
      disabled={busy}
      onClick={cycleLight}
      title="明かり: 広げるほど視界と回復が増すが、敵に気づかれやすくなる"
    >
      🔥{LIGHT[lightLevel].name}
    </button>
  );
}

export function SystemButtons({ onHelp }: { onHelp: () => void }) {
  const mapMode = useRogue((s) => s.mapMode);
  const busy = useRogue((s) => s.busy);
  const muted = useRogue((s) => s.muted);
  const toggleMute = useRogue((s) => s.toggleMute);
  const postFx = useRogue((s) => s.postFx);
  const togglePostFx = useRogue((s) => s.togglePostFx);
  return (
    <>
      <div className="hud-system">
        {!mapMode && <LightButton busy={busy} />}
        <button onClick={() => resetView()} title="視点リセット">
          ⌖<span className="lbl">視点リセット</span>
        </button>
        <button
          className={postFx ? 'active' : ''}
          onClick={togglePostFx}
          title="光の演出(表示が重い・崩れるときはオフに)"
        >
          ✨
        </button>
        <button onClick={toggleMute}>{muted ? '🔇' : '🔊'}</button>
        <button onClick={onHelp} title="操作説明">
          ❓
        </button>
      </div>
      {mapMode && (
        <div className="hud-viewhint">
          ドラッグ=回転 / Space+ドラッグ=移動 / TAB=部屋巡回(Shift で逆順・バブルで移動) / M・ESC=戻る
        </div>
      )}
    </>
  );
}
