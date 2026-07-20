import { useState } from 'react';
import { useRogue, playerAtk, playerDef, playerEvade, SKILL_NODES, rankOf } from '../../state/rogue';
import { ITEMS, itemLabel, statLabel, stackAtk, stackCount, mergeable, type ItemStack } from '../../model/loot';

const SLOT_NAME = { weapon: '武器', armor: '防具', shield: '盾' } as const;

/** 所持品一覧の表示名。名前(+品質)の後ろにスタック数を「(2)」形式で括弧づけする。 */
function packLabel(s: ItemStack): string {
  const name = ITEMS[s.item].name;
  const quality = s.q > 0 ? `+${s.q}` : '';
  const count = stackCount(s) >= 2 ? ` (${stackCount(s)})` : '';
  return `${name}${quality}${count}`;
}

/** 装備枠1段(所持品パネル最上段)。総攻撃力/防御力/回避%をここに表示する。 */
function EquipSlot({
  slot,
  stack,
  stat,
  locked,
  tag,
  emptyHint,
  sharpenTargetRelic,
  onSharpen,
}: {
  slot: 'weapon' | 'armor' | 'shield';
  stack: ItemStack | null;
  stat: string;
  locked: boolean;
  /** 名前の横に小さく出す短いタグ(武器の「両手」など)。 */
  tag?: string;
  /** 未装備時の代替表示(盾の「両手がふさがっている」など)。省略時は「(なし)」。 */
  emptyHint?: string;
  /** 研ぐ対象選択モード中(rogue-34)。選択中の大顎(mandible)遺物。未選択時は undefined。 */
  sharpenTargetRelic?: ItemStack;
  onSharpen?: () => void;
}) {
  const unequip = useRogue((s) => s.unequip);
  const eligible = !!sharpenTargetRelic && !!stack && stack.q <= sharpenTargetRelic.q + 1;
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
      {sharpenTargetRelic && stack && (
        <button
          className="sharpen"
          disabled={locked || !eligible}
          onClick={onSharpen}
          title={eligible ? '研いで+1する' : 'この武具はこれ以上研げない(より深い大顎が要る)'}
        >
          研ぐ対象に
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
  const setSharpenMode = useRogue((s) => s.setSharpenMode);
  const sharpenWithRelic = useRogue((s) => s.sharpenWithRelic);
  const sharpenRelicIndex = useRogue((s) => s.sharpenRelicIndex);
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
  // 研ぐ対象選択モード(rogue-34): 選択中の大顎(mandible)遺物。未選択時は undefined。
  const sharpenTargetRelic =
    uiMode === 'sharpen' && sharpenRelicIndex !== undefined ? player.relics[sharpenRelicIndex] : undefined;
  // 遺物袋の (item, q) グルーピング(表示だけ束ねる。relics 配列自体は平坦のまま)。
  const relicGroups: { item: ItemStack['item']; q: number; count: number; firstIndex: number }[] = [];
  player.relics.forEach((r, i) => {
    const g = relicGroups.find((x) => x.item === r.item && x.q === r.q);
    if (g) g.count++;
    else relicGroups.push({ item: r.item, q: r.q, count: 1, firstIndex: i });
  });

  // 閉じているときは小さなボタンだけ(画面を奪わない)。
  if (!open) {
    return (
      <button className="hud-pack-fab" onClick={() => setOpen(true)} title="所持品を開く">
        🎒{pack.length > 0 && <span className="cnt">{pack.length}</span>}
      </button>
    );
  }

  // 各枠は既に実スタック化されている(rogue-33: 同一 (item,q) は1枠に n で束ねる)ので、
  // ここでの見た目上のグルーピングは不要 — packLabel の「(n)」表示に一本化する。
  // kind 順で並べる: weapon → shield → armor → potion → thrown → turret → decoy → relic
  const kindOrder = ['weapon', 'shield', 'armor', 'potion', 'thrown', 'turret', 'decoy', 'relic'];
  const rows: { stack: ItemStack; index: number }[] = pack.map((stack, index) => ({ stack, index }));
  rows.sort((a, b) => {
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
        sharpenTargetRelic={sharpenTargetRelic}
        onSharpen={() => sharpenRelicIndex !== undefined && sharpenWithRelic(sharpenRelicIndex, { slot: 'weapon' })}
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
        sharpenTargetRelic={sharpenTargetRelic}
        onSharpen={() => sharpenRelicIndex !== undefined && sharpenWithRelic(sharpenRelicIndex, { slot: 'shield' })}
      />
      <EquipSlot
        slot="armor"
        stack={player.armor}
        stat={`防${playerDef(player)}`}
        locked={locked}
        sharpenTargetRelic={sharpenTargetRelic}
        onSharpen={() => sharpenRelicIndex !== undefined && sharpenWithRelic(sharpenRelicIndex, { slot: 'armor' })}
      />
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
      {rows.length === 0 && <div className="empty">(なし)</div>}
      {rows.map((row) => {
        const { stack, index } = row;
        const def = ITEMS[stack.item];
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
        // rogue-30: 武器は左手(盾スロット)にも装備されうる — その一致も見る。
        const isEquipped =
          (def.kind === 'weapon' &&
            ((player.weapon?.item === stack.item && player.weapon.q === stack.q) ||
              (player.shield?.item === stack.item && player.shield.q === stack.q))) ||
          (def.kind === 'armor' && player.armor?.item === stack.item && player.armor.q === stack.q) ||
          (def.kind === 'shield' && player.shield?.item === stack.item && player.shield.q === stack.q);
        // 種類として副動詞が「そもそも適用対象か」(show*) と「今使えるか」(can*) を分ける。
        // 適用対象の副動詞は常に表示し、使えないときは disabled にする(枠位置を安定させる)。
        const isMergeable = mergeable(stack.item); // 武具のみ
        const showThrow = ['weapon', 'armor', 'shield', 'potion'].includes(def.kind);
        const showOffhand = def.kind === 'weapon';
        // 投げられる種類か。装備中スロットは対象外。
        const canThrow = showThrow && !isEquipped;
        // 二刀流(rogue-30): nitoryu ランクI以上・片手武器・未装備なら左手にも装備できる。
        const canOffhand = showOffhand && !def.twoHanded && !isEquipped && rankOf(skillEquipped, 'nitoryu') >= 1;
        // 合成できるか(rogue-34: 武具は束ねないので2枠方式のみ)。別枠に同 (item,q) がある行にだけ有効。
        const canMerge =
          isMergeable && pack.some((x, i) => i !== index && x.item === stack.item && x.q === stack.q);
        // 研ぐ対象選択中(rogue-34)。対象は武具のみ、遺物の層数(q+1)以下の品質まで。
        const canSharpen =
          !!sharpenTargetRelic && isMergeable && stack.q <= sharpenTargetRelic.q + 1;
        return (
          <div className="pack-row" key={`${stack.item}:${stack.q}:${index}`}>
            <button
              className={`pack-main${throwing || isThrowItemMode ? ' active' : ''}`}
              disabled={locked}
              onClick={() => useItem(index)}
            >
              <span className="name">{packLabel(stack)}</span>
              <span className="use">
                {statLabel(stack)}·{verb}
              </span>
            </button>
            <div className="pack-verbs">
              {showThrow && (
                <button
                  className="throw"
                  disabled={locked || !canThrow}
                  onClick={() => setThrowMode(index)}
                  title="敵をクリックして投擲"
                >
                  投げる
                </button>
              )}
              {showOffhand && (
                <button
                  className="offhand"
                  disabled={locked || !canOffhand}
                  onClick={() => equipOffhand(index)}
                  title="二刀流: 左手(盾スロット)に装備"
                >
                  左手
                </button>
              )}
              {isMergeable && (
                <button className="merge" disabled={locked || !canMerge} onClick={() => mergeItem(index)}>
                  合成
                </button>
              )}
              {isMergeable && (
                <button
                  className="sharpen"
                  disabled={locked || !canSharpen}
                  onClick={() => sharpenRelicIndex !== undefined && sharpenWithRelic(sharpenRelicIndex, { index })}
                  title={
                    !sharpenTargetRelic
                      ? '遺物「王蟻の大顎」の研ぐを選ぶと使える'
                      : canSharpen
                        ? '研いで+1する'
                        : 'この武具はこれ以上研げない(より深い大顎が要る)'
                  }
                >
                  研ぐ
                </button>
              )}
              <button
                className="drop"
                disabled={locked}
                onClick={() => dropItem(index)}
                title="束ごと足元に置く(ターン消費なし)"
              >
                🗑️
              </button>
            </div>
          </div>
        );
      })}
      {/* 遺物袋(rogue-29・rogue-34で3種化): pack の10枠を使わない別枠。(item,q) でグルーピングして
          ×n 表示するが、relics 配列自体は平坦のまま — ボタンは1回の操作で1個消費する。 */}
      {relicGroups.length > 0 && (
        <>
          <h4 className="relic-head">遺物</h4>
          {relicGroups.map((g) => {
            const label = `${ITEMS[g.item].name}${g.count > 1 ? ` (${g.count})` : ''}`;
            return (
              <div className="pack-row relic-row" key={`relic:${g.item}:${g.q}`}>
                <span className="relic-item">
                  {label}
                  <span className="use">{statLabel({ item: g.item, q: g.q })}</span>
                </span>
                {g.item === 'amber' && (
                  <button
                    className="crush"
                    disabled={locked}
                    onClick={() => crushRelic(g.firstIndex)}
                    title="砕いて全回復(毒・混乱も治す)。展示棚には飾れなくなる"
                  >
                    砕く
                  </button>
                )}
                {g.item === 'royalJelly' && (
                  <button
                    className="dedicate"
                    disabled={locked}
                    onClick={() => dedicateRelic(g.firstIndex)}
                    title="捧げて心得を組み替える(支度をやり直す)"
                  >
                    捧げる
                  </button>
                )}
                {g.item === 'mandible' && (
                  <button
                    className={`sharpen${uiMode === 'sharpen' && sharpenRelicIndex === g.firstIndex ? ' active' : ''}`}
                    disabled={locked}
                    onClick={() => setSharpenMode(g.firstIndex)}
                    title="武具ひとつを+1する(この遺物の層数以下の品質まで)"
                  >
                    研ぐ
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
