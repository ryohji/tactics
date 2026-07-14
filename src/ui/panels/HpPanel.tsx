import { useRogue } from '../../state/rogue';

/** 左上: HP バー(数字重ね)+障壁セグメント+状態異常アイコン(rogue-21)。 */
export function HpPanel() {
  const player = useRogue((s) => s.player);
  const hpPct = (player.hp / player.maxHp) * 100;
  const hpColor = hpPct > 50 ? '#4ade80' : hpPct > 25 ? '#facc15' : '#ef4444';
  const barrierPct = (Math.min(player.barrier, 24) / 24) * 100;
  return (
    <div className="hud-hp">
      <div className="hud-hpbar big">
        <div style={{ width: `${hpPct}%`, background: hpColor }} />
        {player.barrier > 0 && (
          <div className="barrier" style={{ width: `${barrierPct}%` }} title={`障壁 ${player.barrier}`} />
        )}
        <span className="num">
          {player.hp}/{player.maxHp}
          {player.barrier > 0 && <b className="barrier-num">+{player.barrier}</b>}
        </span>
      </div>
      {(player.status || player.immune > 0) && (
        <div className="hud-status">
          {player.status?.kind === 'poison' && <span title="毒: 毎ターンHP−1(障壁を素通り)">🟣毒{player.status.turns}</span>}
          {player.status?.kind === 'confuse' && <span title="混乱: 移動先がずれることがある">💫混乱{player.status.turns}</span>}
          {player.immune > 0 && <span title="予防: 毒・混乱を受けない">🛡{player.immune}</span>}
        </div>
      )}
    </div>
  );
}
