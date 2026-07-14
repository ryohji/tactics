import { useState } from 'react';
import { useRogue, playerAtk, playerDef, playerEvade, SKILL_NODES } from '../../state/rogue';
import { ITEMS, itemLabel, statLabel, type ItemStack } from '../../model/loot';

const SLOT_NAME = { weapon: '武器', armor: '防具', shield: '盾' } as const;

/** 装備枠1段(所持品パネル最上段)。総攻撃力/防御力/回避%をここに表示する。 */
function EquipSlot({
  slot,
  stack,
  stat,
  locked,
  tag,
  emptyHint,
}: {
  slot: 'weapon' | 'armor' | 'shield';
  stack: ItemStack | null;
  stat: string;
  locked: boolean;
  /** 名前の横に小さく出す短いタグ(武器の「両手」など)。 */
  tag?: string;
  /** 未装備時の代替表示(盾の「両手がふさがっている」など)。省略時は「(なし)」。 */
  emptyHint?: string;
}) {
  const unequip = useRogue((s) => s.unequip);
  return (
    <div className="equip-slot">
      <span className="slot-name">{SLOT_NAME[slot]}</span>
      <span className={`slot-item${stack ? '' : ' empty'}`} title={stack ? statLabel(stack) : ''}>
        {stack ? itemLabel(stack) : (emptyHint ?? '(なし)')}
        {tag && <span className="slot-tag">{tag}</span>}
      </span>
      <span className="slot-stat">{stat}</span>
      {stack && (
        <button className="unequip" disabled={locked} onClick={() => unequip(slot)}>
          外す
        </button>
      )}
    </div>
  );
}

export function PackPanel() {
  const player = useRogue((s) => s.player);
  const useItem = useRogue((s) => s.useItem);
  const mergeItem = useRogue((s) => s.mergeItem);
  const uiMode = useRogue((s) => s.uiMode);
  const placeIndex = useRogue((s) => s.placeIndex);
  const phase = useRogue((s) => s.phase);
  const busy = useRogue((s) => s.busy);
  const mapMode = useRogue((s) => s.mapMode);
  const skillEquipped = useRogue((s) => s.skillEquipped);
  const lightLevel = useRogue((s) => s.lightLevel);
  const [open, setOpen] = useState(true);
  if (mapMode) return null;
  const pack = player.pack;

  // 閉じているときは小さなボタンだけ(画面を奪わない)。
  if (!open) {
    return (
      <button className="hud-pack-fab" onClick={() => setOpen(true)} title="所持品を開く">
        🎒{pack.length > 0 && <span className="cnt">{pack.length}</span>}
      </button>
    );
  }

  // 同種・同品質をまとめて表示(クリックは最初の1個に対して)。
  const groups: { stack: ItemStack; count: number; index: number }[] = [];
  pack.forEach((stack, index) => {
    const g = groups.find((x) => x.stack.item === stack.item && x.stack.q === stack.q);
    if (g) g.count++;
    else groups.push({ stack, count: 1, index });
  });
  const locked = phase !== 'play' || busy;

  return (
    <div className="hud-pack">
      <h4 onClick={() => setOpen(false)} title="たたむ">
        🎒所持品<span className="fold">▾</span>
      </h4>
      <EquipSlot
        slot="weapon"
        stack={player.weapon}
        stat={`攻${playerAtk(player, skillEquipped, lightLevel)}`}
        locked={locked}
        tag={player.weapon && ITEMS[player.weapon.item].twoHanded ? '両手' : undefined}
      />
      <EquipSlot
        slot="shield"
        stack={player.shield}
        stat={`回避${playerEvade(player, skillEquipped)}%`}
        locked={locked}
        emptyHint={
          player.weapon && ITEMS[player.weapon.item].twoHanded && !skillEquipped.includes('katate')
            ? '(両手がふさがっている)'
            : undefined
        }
      />
      <EquipSlot slot="armor" stack={player.armor} stat={`防${playerDef(player)}`} locked={locked} />
      {skillEquipped.length > 0 && (
        <div className="skill-row">
          {skillEquipped.map((id) => (
            <span key={id} className="skill-chip" title={SKILL_NODES[id].desc}>
              {SKILL_NODES[id].name}·{SKILL_NODES[id].cost}
            </span>
          ))}
        </div>
      )}
      {groups.length === 0 && <div className="empty">(なし)</div>}
      {groups.map((g) => {
        const def = ITEMS[g.stack.item];
        const throwing = def.kind === 'thrown' && uiMode === 'throw';
        const placing = def.kind === 'trap' && uiMode === 'place' && placeIndex === g.index;
        const verb =
          def.kind === 'potion'
            ? '飲む'
            : def.kind === 'thrown'
              ? throwing
                ? '解除'
                : '投げる'
              : def.kind === 'weapon' || def.kind === 'armor' || def.kind === 'shield'
                ? '装備'
                : placing
                  ? '解除'
                  : '設置';
        return (
          <div className="pack-row" key={`${g.stack.item}:${g.stack.q}`}>
            <button
              className={throwing || placing ? 'active' : ''}
              disabled={locked}
              onClick={() => useItem(g.index)}
            >
              {itemLabel(g.stack)}
              {g.count > 1 ? ` ×${g.count}` : ''}
              <span className="use">
                {statLabel(g.stack)}·{verb}
              </span>
            </button>
            {g.count >= 2 && (
              <button className="merge" disabled={locked} onClick={() => mergeItem(g.index)}>
                合成
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
