// アイテム定義(rogue-4)。すべてのアイテムは品質 q を持つスタック {item, q} で扱う。
// 同一アイテム・同一品質の2つを「合成」すると q+1 になる(+1 の強化には別の +1 が要る)。
// 品質は実効値(攻/防/回復量/威力/持続)に効く — stackXxx 系のヘルパを通して読むこと。

export type ItemId =
  | 'dagger' | 'sword' | 'waraxe' | 'spear' | 'maul'
  | 'leather' | 'chain' | 'plate' | 'shield'
  | 'potion' | 'barrierPotion' | 'antidote' | 'knife'
  | 'turret' | 'decoy' | 'amber';

/** relic(rogue-25): 遺物。使用・装備・合成できず、脱出で持ち帰ると展示棚に飾られる。
    rogue-27 で罠アイテム5種を廃止(罠は罠師「罠編み」のスキル化。state/rogue/types.ts の PlacedTrap 参照)。 */
export type ItemKind = 'weapon' | 'armor' | 'shield' | 'potion' | 'thrown' | 'turret' | 'decoy' | 'relic';

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
  /** 武器の攻撃リーチ(FCC 歩数。省略時 1=隣接のみ)。 */
  reach?: number;
  /** 武器の薙ぎ払い(リーチ内の敵全員に当たる)。 */
  sweep?: boolean;
  /** 両手武器か(rogue-22)。装備中は盾を併用できない(装備すると盾は自動で外れる)。 */
  twoHanded?: boolean;
  /** 盾の回避率(基礎値。rogue-22)。品質+1ごとに+2(stackEvade)。 */
  evade?: number;
  /** 障壁の水薬(rogue-21): 飲むと基礎値の障壁を張る(上書き式)。品質+1ごとに+2。 */
  barrier?: number;
  /** 解毒の水薬(rogue-21): 毒・混乱を治し、以後 q ターンの予防を付与する。 */
  cure?: boolean;
}

/** アイテムの実体(品質つき)。 */
export interface ItemStack {
  item: ItemId;
  q: number;
  /** 個数(省略時1)。水薬・投げナイフだけが2以上になる(同一 item+q で束ねる)。 */
  n?: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  dagger: { name: '短剣', kind: 'weapon', atk: 2 },
  sword: { name: '鉄の剣', kind: 'weapon', atk: 4 },
  waraxe: { name: '戦斧', kind: 'weapon', atk: 6 },
  spear: { name: '長槍', kind: 'weapon', atk: 3, reach: 2, twoHanded: true },
  maul: { name: '大鎚', kind: 'weapon', atk: 5, sweep: true, twoHanded: true },
  leather: { name: '革鎧', kind: 'armor', def: 1 },
  chain: { name: '鎖帷子', kind: 'armor', def: 2 },
  plate: { name: '板金鎧', kind: 'armor', def: 4 },
  shield: { name: '盾', kind: 'shield', evade: 10 },
  potion: { name: '癒しの水薬', kind: 'potion', heal: 12 },
  barrierPotion: { name: '障壁の水薬', kind: 'potion', barrier: 8 },
  antidote: { name: '解毒の水薬', kind: 'potion', cure: true },
  knife: { name: '投げナイフ', kind: 'thrown', dmg: 5, range: 8 },
  turret: { name: '魔導砲塔', kind: 'turret', dmg: 3, range: 8 },
  decoy: { name: '囮人形', kind: 'decoy' },
  // 遺物(rogue-25)。q は「拾った層番号(0始まり)」を表す — 品質強化の意味ではない。
  amber: { name: '巣の琥珀', kind: 'relic' },
};

/** 個数(s.n ?? 1)。 */
export function stackCount(s: ItemStack): number {
  return s.n ?? 1;
}

/** 束ねられる種類か(potion / thrown)。武具・装置・遺物は常に n=1。 */
export function stackable(item: ItemId): boolean {
  const kind = ITEMS[item].kind;
  return kind === 'potion' || kind === 'thrown';
}

/** 合成可の種類か(weapon / armor / shield のみ)。 */
export function mergeable(item: ItemId): boolean {
  const kind = ITEMS[item].kind;
  return kind === 'weapon' || kind === 'armor' || kind === 'shield';
}

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
/** 投擲・砲塔のダメージ。 */
export function stackDmg(s: ItemStack): number {
  return (ITEMS[s.item].dmg ?? 0) + 2 * s.q;
}
/** 障壁の水薬(rogue-21)が張る障壁量。品質+1ごとに+2。 */
export function stackBarrier(s: ItemStack): number {
  return (ITEMS[s.item].barrier ?? 0) + 2 * s.q;
}
/** 解毒の水薬(rogue-21)の予防ターン数(品質そのもの。品質0=治すだけ)。 */
export function stackImmune(s: ItemStack): number {
  return s.q;
}
/** 盾(rogue-22)の回避%。品質+1ごとに+2。 */
export function stackEvade(s: ItemStack): number {
  return (ITEMS[s.item].evade ?? 0) + 2 * s.q;
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

/** 名前+品質("鉄の剣+1")。n>=2 なら「×n」を追記。遺物の q は層番号なので「+q」を付けない。 */
export function itemLabel(s: ItemStack): string {
  const name = ITEMS[s.item].name;
  if (ITEMS[s.item].kind === 'relic') return name;
  const quality = s.q > 0 ? `+${s.q}` : '';
  const count = stackCount(s) >= 2 ? ` ×${stackCount(s)}` : '';
  return `${name}${quality}${count}`;
}

/** 性能の短い表記("攻5" / "延焼4T" など)。 */
export function statLabel(s: ItemStack): string {
  const def = ITEMS[s.item];
  switch (def.kind) {
    case 'weapon':
      return `攻${stackAtk(s)}${def.reach ? `·射程${def.reach}` : ''}${def.sweep ? '·薙ぎ' : ''}`;
    case 'armor':
      return `防${stackDef(s)}`;
    case 'shield':
      return `回避${stackEvade(s)}%`;
    case 'potion':
      if (def.barrier !== undefined) return `障壁${stackBarrier(s)}`;
      if (def.cure) return stackImmune(s) > 0 ? `解毒+予防${stackImmune(s)}T` : `解毒`;
      return `回復${stackHeal(s)}`;
    case 'thrown':
      return `威力${stackDmg(s)}·射程${def.range}`;
    case 'turret':
      return `威力${stackDmg(s)}·${turretTurns(s)}T`;
    case 'relic':
      return `層${s.q + 1}の遺物`; // q=拾った層番号(0始まり)
    default:
      return `耐久${decoyHp(s)}`;
  }
}

// --- 出土テーブル ------------------------------------------------------------------
// 深度でレア度が上がる2軸: ①解禁プール(深いほど上位の武具が混ざる)
// ②品質ロール(深いほど +1/+2/+3 が出やすい)。広間の初期トレジャーも
// 敵のドロップも lootTable を通るので、両方が同じ規則でスケールする。

/** 深度で解禁される武器プール(浅い側から。深いほど上位に寄せて引く)。 */
function weaponFor(depth: number, rng: () => number): ItemId {
  const pool: ItemId[] = ['dagger'];
  if (depth >= 3) pool.push('sword');
  if (depth >= 5) pool.push('spear');
  if (depth >= 8) pool.push('waraxe');
  if (depth >= 10) pool.push('maul');
  // 2回引いて深い方を採用(深層ほど上位が出やすいバイアス)。
  const i = Math.floor(rng() * pool.length);
  const j = depth >= 6 ? Math.floor(rng() * pool.length) : 0;
  return pool[Math.max(i, j)];
}

/**
 * 深度で解禁される水薬プール(rogue-21)。障壁の水薬=深度3〜、解毒の水薬=深度4〜
 * (毒ヘビ=深度7より先に手に入る「対抗手段が先」の原則)。
 */
function potionFor(depth: number, rng: () => number): ItemId {
  const pool: ItemId[] = ['potion'];
  if (depth >= 3) pool.push('barrierPotion');
  if (depth >= 4) pool.push('antidote');
  return pool[Math.floor(rng() * pool.length)];
}

function armorFor(depth: number, rng: () => number): ItemId {
  const pool: ItemId[] = ['leather'];
  if (depth >= 2) pool.push('shield'); // 盾(rogue-22)は防具枠の抽選に混ざる
  if (depth >= 3) pool.push('chain');
  if (depth >= 9) pool.push('plate');
  const i = Math.floor(rng() * pool.length);
  const j = depth >= 6 ? Math.floor(rng() * pool.length) : 0;
  return pool[Math.max(i, j)];
}

/** 品質ロール。+1 は深度5前後から、+2 は10前後、+3 は15前後から出はじめる。 */
function qualityFor(depth: number, rng: () => number): number {
  let q = 0;
  while (q < 3 && rng() < Math.min(0.55, (depth - 4 - 5 * q) * 0.08)) q++;
  return q;
}

// rogue-27: 罠アイテム5種を廃止(罠は罠師「罠編み」のスキル化。装填制のためガジェット枠から抜ける)。
const GADGETS: ItemId[] = ['turret', 'decoy'];

/** 深度 D の広間に落ちるアイテム列(0〜2個)。深度2+ でガジェットが混ざる。 */
export function lootTable(depth: number, rng: () => number): ItemStack[] {
  const out: ItemStack[] = [];
  const rolls = 1 + (rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < rolls; i++) {
    if (rng() > 0.68) continue;
    const r = rng();
    let stack: ItemStack;
    if (r < 0.3) {
      // potion
      const item = potionFor(depth, rng);
      stack = { item, q: qualityFor(depth, rng) };
    } else if (r < 0.45) {
      // knife 束: q=0、n = 2〜3
      stack = { item: 'knife', q: 0, n: 2 + (rng() < 0.5 ? 1 : 0) };
    } else if (r < 0.65) {
      // weapon
      const item = weaponFor(depth, rng);
      stack = { item, q: qualityFor(depth, rng) };
    } else if (r < 0.85) {
      // armor
      const item = armorFor(depth, rng);
      stack = { item, q: qualityFor(depth, rng) };
    } else if (depth >= 2) {
      // gadget
      const item = GADGETS[Math.floor(rng() * GADGETS.length)];
      stack = { item, q: qualityFor(depth, rng) };
    } else {
      // depth < 2: potion or knife bundle
      if (rng() < 0.5) {
        const item = potionFor(depth, rng);
        stack = { item, q: qualityFor(depth, rng) };
      } else {
        stack = { item: 'knife', q: 0, n: 2 + (rng() < 0.5 ? 1 : 0) };
      }
    }
    out.push(stack);
  }
  return out;
}
