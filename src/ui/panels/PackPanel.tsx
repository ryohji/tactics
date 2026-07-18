import { useState } from 'react';
import { useRogue, playerAtk, playerDef, playerEvade, SKILL_NODES, rankOf } from '../../state/rogue';
import { ITEMS, itemLabel, statLabel, stackAtk, mergeable, type ItemStack } from '../../model/loot';

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
  const equipOffhand = useRogue((s) => s.equipOffhand);
  const mergeItem = useRogue((s) => s.mergeItem);
  const dropItem = useRogue((s) => s.dropItem);
  const crushRelic = useRogue((s) => s.crushRelic);
  const dedicateRelic = useRogue((s) => s.dedicateRelic);
  const uiMode = useRogue((s) => s.uiMode);
  const phase = useRogue((s) => s.phase);
  const busy = useRogue((s) => s.busy);
  const mapMode = useRogue((s) => s.mapMode);
  const skillEquipped = useRogue((s) => s.skillEquipped);
  const lightLevel = useRogue((s) => s.lightLevel);
  const setThrowMode = useRogue((s) => s.setThrowMode);
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

  // kind 順にグルーピング: weapon → shield → armor → potion → thrown → turret → decoy → relic
  const kindOrder = ['weapon', 'shield', 'armor', 'potion', 'thrown', 'turret', 'decoy', 'relic'];
  groups.sort((a, b) => {
    const kindA = ITEMS[a.stack.item].kind;
    const kindB = ITEMS[b.stack.item].kind;
    return kindOrder.indexOf(kindA) - kindOrder.indexOf(kindB);
  });

  const locked = phase !== 'play' || busy;

  return (
    <div className="hud-pack">
      <h4 onClick={() => setOpen(false)} title="たたむ">
        🎒所持 {pack.length}/10{pack.length === 10 && <span className="full"> 満杯</span>}
        <span className="fold">▾</span>
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
        // 二刀流(rogue-30): 左手に片手武器を持てる。盾スロットの中身が武器なら攻表記に切り替える。
        stat={
          player.shield && ITEMS[player.shield.item].kind === 'weapon'
            ? `攻${stackAtk(player.shield)}`
            : `回避${playerEvade(player, skillEquipped)}%`
        }
        tag={player.shield && ITEMS[player.shield.item].kind === 'weapon' ? '左手' : undefined}
        locked={locked}
        emptyHint={
          player.weapon && ITEMS[player.weapon.item].twoHanded && rankOf(skillEquipped, 'katate') < 1
            ? '(両手がふさがっている)'
            : undefined
        }
      />
      <EquipSlot slot="armor" stack={player.armor} stat={`防${playerDef(player)}`} locked={locked} />
      {skillEquipped.length > 0 && (
        <div className="skill-row">
          {skillEquipped.map((e) => (
            <span key={e.id} className="skill-chip" title={SKILL_NODES[e.id].descs[e.rank - 1]}>
              {SKILL_NODES[e.id].name}
              {e.rank > 1 ? (e.rank === 2 ? 'Ⅱ' : 'Ⅲ') : ''}·{SKILL_NODES[e.id].costs[e.rank - 1]}
            </span>
          ))}
        </div>
      )}
      {groups.length === 0 && <div className="empty">(なし)</div>}
      {groups.map((g) => {
        const def = ITEMS[g.stack.item];
        const throwing = def.kind === 'thrown' && uiMode === 'throw';
        const isThrowItemMode = uiMode === 'throw' && setThrowMode !== undefined;
        // 罠(trapSpike等)は rogue-27 で廃止(罠師「罠編み」のスキル化)。ここに残るのは
        // 砲塔・囮のみで、いずれも即設置(選択モードなし)。
        const verb =
          def.kind === 'potion'
            ? '飲む'
            : def.kind === 'thrown'
              ? throwing
                ? '解除'
                : '投げる'
              : def.kind === 'weapon' || def.kind === 'armor' || def.kind === 'shield'
                ? '装備'
                : def.kind === 'relic'
                  ? '調べる'
                  : '設置';
        // 投げられる種類か(武具・水薬のみ)。装備中スロットは対象外。
        // rogue-30: 武器は左手(盾スロット)にも装備されうる — その一致も見る。
        const isEquipped =
          (def.kind === 'weapon' &&
            ((player.weapon?.item === g.stack.item && player.weapon.q === g.stack.q) ||
              (player.shield?.item === g.stack.item && player.shield.q === g.stack.q))) ||
          (def.kind === 'armor' && player.armor?.item === g.stack.item && player.armor.q === g.stack.q) ||
          (def.kind === 'shield' && player.shield?.item === g.stack.item && player.shield.q === g.stack.q);
        const canThrow = ['weapon', 'armor', 'shield', 'potion'].includes(def.kind) && !isEquipped;
        // 二刀流(rogue-30): nitoryu ランクI以上・片手武器・未装備なら左手にも装備できる。
        const canOffhand =
          def.kind === 'weapon' && !def.twoHanded && !isEquipped && rankOf(skillEquipped, 'nitoryu') >= 1;
        return (
          <div className="pack-row" key={`${g.stack.item}:${g.stack.q}`}>
            <button
              className={throwing || isThrowItemMode ? 'active' : ''}
              disabled={locked}
              onClick={() => useItem(g.index)}
            >
              {itemLabel(g.stack)}
              {g.count > 1 ? ` ×${g.count}` : ''}
              <span className="use">
                {statLabel(g.stack)}·{verb}
              </span>
            </button>
            {canThrow && (
              <button
                className="throw"
                disabled={locked}
                onClick={() => setThrowMode(g.index)}
                title="敵をクリックして投擲"
              >
                投げる
              </button>
            )}
            {canOffhand && (
              <button
                className="offhand"
                disabled={locked}
                onClick={() => equipOffhand(g.index)}
                title="二刀流: 左手(盾スロット)に装備"
              >
                左手に
              </button>
            )}
            {g.count >= 2 && mergeable(g.stack.item) && (
              <button className="merge" disabled={locked} onClick={() => mergeItem(g.index)}>
                合成
              </button>
            )}
            <button
              className="drop"
              disabled={locked}
              onClick={() => dropItem(g.index)}
              title="束ごと足元に置く(ターン消費なし)"
            >
              捨てる
            </button>
          </div>
        );
      })}
      {/* 遺物袋(rogue-29): pack の10枠を使わない別枠。砕くと全回復するが持ち帰れなくなる。 */}
      {player.relics.length > 0 && (
        <>
          <h4 className="relic-head">遺物</h4>
          {player.relics.map((r, i) => (
            <div className="pack-row relic-row" key={`relic:${i}`}>
              <span className="relic-item">
                {itemLabel(r)}
                <span className="use">{statLabel(r)}</span>
              </span>
              <button
                className="crush"
                disabled={locked}
                onClick={() => crushRelic(i)}
                title="砕くと全回復(1ターン)。持ち帰れなくなる"
              >
                砕く
              </button>
              <button
                className="dedicate"
                disabled={locked}
                onClick={() => dedicateRelic(i)}
                title="心得を組み替える"
              >
                捧げる
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
