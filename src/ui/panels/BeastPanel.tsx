import { useRogue, rankOf } from '../../state/rogue';
import { stepDist } from '../../model/dungeon';
import { BEASTS } from '../../model/beasts';
import { itemLabel, statLabel } from '../../model/loot';

export function BeastPanel() {
  const hoverBeastId = useRogue((s) => s.hoverBeastId);
  const beasts = useRogue((s) => s.beasts);
  const playerPos = useRogue((s) => s.player.pos);
  const skillEquipped = useRogue((s) => s.skillEquipped);
  const b = beasts.find((x) => x.id === hoverBeastId && x.alive);
  if (!b) return null;
  const def = BEASTS[b.kind];
  return (
    <div className="hud-unit">
      <h3>
        <span className="side-enemy">{def.name}</span>
        <span className="tag">
          {def.gatekeeper ? '門番・' : ''}
          {def.senses ? '気配感知・' : ''}
          {b.awake ? '警戒' : 'まどろみ'}
        </span>
      </h3>
      <div className="hud-hpbar">
        <div style={{ width: `${(b.hp / def.hp) * 100}%`, background: '#ef4444' }} />
      </div>
      <div className="hud-stats">
        <span>HP<b>{b.hp}/{Math.max(def.hp, b.hp)}</b></span>
        <span>攻<b>{b.atkOverride ?? def.atk}</b></span>
        <span>防<b>{b.defOverride ?? def.def}</b></span>
        <span>距離<b>{stepDist(playerPos, b.pos)}歩</b></span>
      </div>
      {/* 目利き(rogue-24: shinMekiki): 持ち物は湧き時に事前ロール済みなので表示だけ。 */}
      {rankOf(skillEquipped, 'shinMekiki') >= 1 && (
        <div className="beast-carry">
          持ち物: {b.carry ? `${itemLabel(b.carry)}(${statLabel(b.carry)})` : 'なし'}
        </div>
      )}
    </div>
  );
}
