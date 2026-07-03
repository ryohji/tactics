// アイテム定義(rogue-1)。武器(atk)・防具(def)・水薬(回復)・投げナイフ(遠隔消耗品)。

export type ItemId =
  | 'dagger' | 'sword' | 'waraxe'
  | 'leather' | 'chain' | 'plate'
  | 'potion' | 'knife';

export type ItemKind = 'weapon' | 'armor' | 'potion' | 'thrown';

export interface ItemDef {
  name: string;
  kind: ItemKind;
  atk?: number;
  def?: number;
  heal?: number;
  /** 投擲ダメージ。 */
  dmg?: number;
  /** 投擲射程(格子ワールド単位)。 */
  range?: number;
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
};

function weaponFor(depth: number): ItemId {
  return depth < 4 ? 'dagger' : depth < 9 ? 'sword' : 'waraxe';
}

function armorFor(depth: number): ItemId {
  return depth < 4 ? 'leather' : depth < 9 ? 'chain' : 'plate';
}

/** 深度 D の広間に落ちるアイテム列(0〜2個)。 */
export function lootTable(depth: number, rng: () => number): ItemId[] {
  const out: ItemId[] = [];
  const rolls = 1 + (rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < rolls; i++) {
    if (rng() > 0.65) continue;
    const r = rng();
    if (r < 0.35) out.push('potion');
    else if (r < 0.6) out.push('knife');
    else if (r < 0.8) out.push(weaponFor(depth));
    else out.push(armorFor(depth));
  }
  return out;
}
