// アイテム定義(rogue-4)。すべてのアイテムは品質 q を持つスタック {item, q} で扱う。
// 同一アイテム・同一品質の2つを「合成」すると q+1 になる(+1 の強化には別の +1 が要る)。
// 品質は実効値(攻/防/回復量/威力/持続)に効く — stackXxx 系のヘルパを通して読むこと。

export type ItemId =
  | 'dagger' | 'sword' | 'waraxe'
  | 'leather' | 'chain' | 'plate'
  | 'potion' | 'knife'
  | 'trapSpike' | 'trapFire' | 'trapConfuse' | 'trapFear' | 'trapSleep'
  | 'turret' | 'decoy';

export type ItemKind = 'weapon' | 'armor' | 'potion' | 'thrown' | 'trap' | 'turret' | 'decoy';

/** 罠の効果種別。 */
export type TrapKind = 'spike' | 'fire' | 'confuse' | 'fear' | 'sleep';

export interface ItemDef {
  name: string;
  kind: ItemKind;
  atk?: number;
  def?: number;
  heal?: number;
  /** 投擲/罠/砲塔の基礎ダメージ。 */
  dmg?: number;
  /** 投擲/砲塔の射程(格子ワールド単位)。 */
  range?: number;
  trap?: TrapKind;
}

/** アイテムの実体(品質つき)。 */
export interface ItemStack {
  item: ItemId;
  q: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  dagger: { name: '短剣', kind: 'weapon', atk: 2 },
  sword: { name: '鉄の剣', kind: 'weapon', atk: 4 },
  waraxe: { name: '戦斧', kind: 'weapon', atk: 6 },
  leather: { name: '革鎧', kind: 'armor', def: 1 },
  chain: { name: '鎖帷子', kind: 'armor', def: 2 },
  plate: { name: '板金鎧', kind: 'armor', def: 4 },
  potion: { name: '癒しの水薬', kind: 'potion', heal: 12 },
  knife: { name: '投げナイフ', kind: 'thrown', dmg: 5, range: 8 },
  trapSpike: { name: '棘の罠', kind: 'trap', trap: 'spike', dmg: 8 },
  trapFire: { name: '火炎の罠', kind: 'trap', trap: 'fire', dmg: 2 },
  trapConfuse: { name: '幻惑の罠', kind: 'trap', trap: 'confuse' },
  trapFear: { name: '恐慌の罠', kind: 'trap', trap: 'fear' },
  trapSleep: { name: '眠りの罠', kind: 'trap', trap: 'sleep' },
  turret: { name: '魔導砲塔', kind: 'turret', dmg: 3, range: 8 },
  decoy: { name: '囮人形', kind: 'decoy' },
};

// --- 品質込みの実効値 -----------------------------------------------------------

export function stackAtk(s: ItemStack): number {
  return (ITEMS[s.item].atk ?? 0) + s.q;
}
export function stackDef(s: ItemStack): number {
  return (ITEMS[s.item].def ?? 0) + s.q;
}
export function stackHeal(s: ItemStack): number {
  return (ITEMS[s.item].heal ?? 0) + 4 * s.q;
}
/** 投擲・棘罠・砲塔のダメージ。 */
export function stackDmg(s: ItemStack): number {
  return (ITEMS[s.item].dmg ?? 0) + 2 * s.q;
}
/** 状態異常系の持続ターン(混乱/恐慌/昏睡/延焼)。 */
export function stackTurns(s: ItemStack): number {
  return 4 + s.q;
}
/** 砲塔の稼働ターン。 */
export function turretTurns(s: ItemStack): number {
  return 8 + 2 * s.q;
}
/** 囮の耐久。 */
export function decoyHp(s: ItemStack): number {
  return 10 + 4 * s.q;
}

// --- 表示 -----------------------------------------------------------------------

/** 名前+品質("鉄の剣+1")。 */
export function itemLabel(s: ItemStack): string {
  return `${ITEMS[s.item].name}${s.q > 0 ? `+${s.q}` : ''}`;
}

/** 性能の短い表記("攻5" / "延焼4T" など)。 */
export function statLabel(s: ItemStack): string {
  const def = ITEMS[s.item];
  switch (def.kind) {
    case 'weapon':
      return `攻${stackAtk(s)}`;
    case 'armor':
      return `防${stackDef(s)}`;
    case 'potion':
      return `回復${stackHeal(s)}`;
    case 'thrown':
      return `威力${stackDmg(s)}·射程${def.range}`;
    case 'trap':
      switch (def.trap) {
        case 'spike':
          return `威力${stackDmg(s)}`;
        case 'fire':
          return `延焼${stackTurns(s)}T`;
        case 'confuse':
          return `混乱${stackTurns(s)}T`;
        case 'fear':
          return `恐慌${stackTurns(s)}T`;
        default:
          return `昏睡${stackTurns(s)}T`;
      }
    case 'turret':
      return `威力${stackDmg(s)}·${turretTurns(s)}T`;
    default:
      return `耐久${decoyHp(s)}`;
  }
}

// --- 出土テーブル ------------------------------------------------------------------

function weaponFor(depth: number): ItemId {
  return depth < 4 ? 'dagger' : depth < 9 ? 'sword' : 'waraxe';
}

function armorFor(depth: number): ItemId {
  return depth < 4 ? 'leather' : depth < 9 ? 'chain' : 'plate';
}

const GADGETS: ItemId[] = [
  'trapSpike', 'trapFire', 'trapConfuse', 'trapFear', 'trapSleep', 'turret', 'decoy',
];

/** 深度 D の広間に落ちるアイテム列(0〜2個・品質0)。深度2+ でガジェットが混ざる。 */
export function lootTable(depth: number, rng: () => number): ItemStack[] {
  const out: ItemStack[] = [];
  const rolls = 1 + (rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < rolls; i++) {
    if (rng() > 0.68) continue;
    const r = rng();
    let item: ItemId;
    if (r < 0.3) item = 'potion';
    else if (r < 0.5) item = 'knife';
    else if (r < 0.65) item = weaponFor(depth);
    else if (r < 0.8) item = armorFor(depth);
    else if (depth >= 2) item = GADGETS[Math.floor(rng() * GADGETS.length)];
    else item = rng() < 0.5 ? 'potion' : 'knife';
    out.push({ item, q: 0 });
  }
  return out;
}
