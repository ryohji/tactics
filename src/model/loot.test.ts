// 出土テーブルと湧きテーブルの深度スケーリング(rogue-9)。
// 乱数は seed 固定の LCG で統計的な性質(解禁・品質の伸び)を確認する。

import { describe, it, expect } from 'vitest';
import { lcg } from './dungeon';
import {
  lootTable,
  stackEvade,
  statLabel,
  stackCount,
  stackable,
  STACK_MAX,
  mergeable,
  mergeIntoPack,
  takeOneFromPack,
  itemLabel,
  type ItemStack,
} from './loot';
import { spawnTable } from './beasts';

describe('lootTable(深度スケーリング)', () => {
  it('浅層(深度1)は品質0のみで、上位装備は出ない', () => {
    const rng = lcg(1);
    const items = Array.from({ length: 300 }, () => lootTable(1, rng)).flat();
    expect(items.length).toBeGreaterThan(50);
    expect(items.every((s) => s.q === 0)).toBe(true);
    const ids = new Set(items.map((s) => s.item));
    for (const late of ['spear', 'maul', 'waraxe', 'plate'] as const) {
      expect(ids.has(late)).toBe(false);
    }
  });

  it('深層(深度14)は高品質(+1/+2)と上位装備が混ざる', () => {
    const rng = lcg(2);
    const items = Array.from({ length: 400 }, () => lootTable(14, rng)).flat();
    expect(items.some((s) => s.q >= 1)).toBe(true);
    expect(items.some((s) => s.q >= 2)).toBe(true);
    const ids = new Set(items.map((s) => s.item));
    expect(ids.has('spear')).toBe(true);
    expect(ids.has('maul')).toBe(true);
    expect(ids.has('plate')).toBe(true);
  });

  it('深いほど平均品質が上がる', () => {
    const avg = (depth: number) => {
      const rng = lcg(3);
      const xs = Array.from({ length: 400 }, () => lootTable(depth, rng)).flat();
      return xs.reduce((a, s) => a + s.q, 0) / xs.length;
    };
    expect(avg(16)).toBeGreaterThan(avg(6));
  });

  it('盾(rogue-22)は深度1では出ず、深度2〜で防具枠に混ざる', () => {
    const rngShallow = lcg(7);
    const shallow = Array.from({ length: 300 }, () => lootTable(1, rngShallow)).flat();
    expect(shallow.some((s) => s.item === 'shield')).toBe(false);
    const rngDeep = lcg(8);
    const deep = Array.from({ length: 300 }, () => lootTable(2, rngDeep)).flat();
    expect(deep.some((s) => s.item === 'shield')).toBe(true);
  });
});

describe('stackEvade(盾の回避%。rogue-22)', () => {
  it('基礎10%・品質+1ごとに+2%', () => {
    expect(stackEvade({ item: 'shield', q: 0 })).toBe(10);
    expect(stackEvade({ item: 'shield', q: 2 })).toBe(14);
  });

  it('statLabel は「回避X%」と表示する', () => {
    expect(statLabel({ item: 'shield', q: 1 })).toBe('回避12%');
  });
});

describe('spawnTable(深層の種族)', () => {
  it('浅層(深度3)に深層種は湧かない', () => {
    const rng = lcg(4);
    const kinds = new Set(Array.from({ length: 200 }, () => spawnTable(3, rng)).flat());
    for (const k of ['soldier', 'shade', 'drake', 'colossus'] as const) {
      expect(kinds.has(k)).toBe(false);
    }
  });

  it('深度18は直近解禁の4種(酸粘体・胞子茸・影・地竜)から湧き、弱種と未解禁種は混ざらない', () => {
    // rogue-21 の出現帯: slime11 / mushnub12 / shade13 / drake17。colossus は21〜。
    const rng = lcg(5);
    const kinds = new Set(Array.from({ length: 300 }, () => spawnTable(18, rng)).flat());
    expect(kinds.has('shade')).toBe(true);
    expect(kinds.has('drake')).toBe(true);
    expect(kinds.has('colossus')).toBe(false); // 深度21で解禁
    expect(kinds.has('bat')).toBe(false);
  });

  it('深度22で巨人が解禁される', () => {
    const rng = lcg(6);
    const kinds = new Set(Array.from({ length: 300 }, () => spawnTable(22, rng)).flat());
    expect(kinds.has('colossus')).toBe(true);
  });
});

describe('stackable・mergeable(rogue-28)', () => {
  it('stackCount は n ?? 1', () => {
    expect(stackCount({ item: 'potion', q: 0 })).toBe(1);
    expect(stackCount({ item: 'potion', q: 0, n: 3 })).toBe(3);
    expect(stackCount({ item: 'knife', q: 0, n: 2 })).toBe(2);
  });

  it('stackable は potion/thrown/turret/decoy のみ(rogue-34: 武具は束ねない)', () => {
    expect(stackable('potion')).toBe(true);
    expect(stackable('barrierPotion')).toBe(true);
    expect(stackable('antidote')).toBe(true);
    expect(stackable('knife')).toBe(true);
    expect(stackable('turret')).toBe(true);
    expect(stackable('decoy')).toBe(true);
    // 武具は1枠1個に戻す(rogue-33 では true だったが rogue-34 で false に修正)。
    expect(stackable('dagger')).toBe(false);
    expect(stackable('shield')).toBe(false);
    expect(stackable('leather')).toBe(false);
    expect(stackable('amber')).toBe(false);
    expect(stackable('royalJelly')).toBe(false);
    expect(stackable('mandible')).toBe(false);
  });

  it('STACK_MAX(rogue-34): turret/decoy/knife=10・potion=5', () => {
    expect(STACK_MAX('turret')).toBe(10);
    expect(STACK_MAX('decoy')).toBe(10);
    expect(STACK_MAX('knife')).toBe(10);
    expect(STACK_MAX('potion')).toBe(5);
    expect(STACK_MAX('barrierPotion')).toBe(5);
    expect(STACK_MAX('antidote')).toBe(5);
  });

  it('mergeable は weapon・armor・shield のみ', () => {
    expect(mergeable('dagger')).toBe(true);
    expect(mergeable('sword')).toBe(true);
    expect(mergeable('leather')).toBe(true);
    expect(mergeable('plate')).toBe(true);
    expect(mergeable('shield')).toBe(true);
    expect(mergeable('potion')).toBe(false);
    expect(mergeable('knife')).toBe(false);
    expect(mergeable('turret')).toBe(false);
    expect(mergeable('amber')).toBe(false);
  });

  it('itemLabel は n>=2 なら「×n」を表示', () => {
    expect(itemLabel({ item: 'potion', q: 0 })).toBe('癒しの水薬');
    expect(itemLabel({ item: 'potion', q: 1 })).toBe('癒しの水薬+1');
    expect(itemLabel({ item: 'potion', q: 0, n: 3 })).toBe('癒しの水薬 ×3');
    expect(itemLabel({ item: 'knife', q: 0, n: 2 })).toBe('投げナイフ ×2');
    expect(itemLabel({ item: 'dagger', q: 2 })).toBe('短剣+2');
  });

  it('lootTable(rogue-28) のナイフは bundle: q=0・n=2-3', () => {
    const rng = lcg(1);
    const items = Array.from({ length: 500 }, () => lootTable(1, rng)).flat();
    const knives = items.filter((s) => s.item === 'knife');
    expect(knives.length).toBeGreaterThan(50);
    // すべてのナイフが q=0
    expect(knives.every((s) => s.q === 0)).toBe(true);
    // すべてのナイフが n=2 または n=3
    expect(knives.every((s) => (s.n ?? 1) === 2 || (s.n ?? 1) === 3)).toBe(true);
    // n=2 と n=3 の両方が出ている(統計的に)
    expect(knives.some((s) => (s.n ?? 1) === 2)).toBe(true);
    expect(knives.some((s) => (s.n ?? 1) === 3)).toBe(true);
  });
});

describe('mergeIntoPack・takeOneFromPack(rogue-33: 全アイテムの束ね化)', () => {
  it('mergeIntoPack: 同 (item,q) の既存スタックがあれば n を加算して true', () => {
    const pack: ItemStack[] = [{ item: 'dagger', q: 0, n: 2 }, { item: 'sword', q: 1 }];
    const ok = mergeIntoPack(pack, { item: 'dagger', q: 0 });
    expect(ok).toBe(true);
    expect(pack).toHaveLength(2);
    expect(pack[0]).toEqual({ item: 'dagger', q: 0, n: 3 });
  });

  it('mergeIntoPack: 一致がなければ false(呼び出し側で push するか判断)', () => {
    const pack: ItemStack[] = [{ item: 'sword', q: 1 }];
    const ok = mergeIntoPack(pack, { item: 'dagger', q: 0 });
    expect(ok).toBe(false);
    expect(pack).toHaveLength(1);
  });

  it('takeOneFromPack: n>=2 は n-1 して単品を返す(枠は残る)', () => {
    const pack: ItemStack[] = [{ item: 'turret', q: 2, n: 2 }];
    const taken = takeOneFromPack(pack, 0);
    expect(taken).toEqual({ item: 'turret', q: 2 });
    expect(pack).toEqual([{ item: 'turret', q: 2, n: 1 }]);
  });

  it('takeOneFromPack: n===1 は枠ごと削除', () => {
    const pack: ItemStack[] = [{ item: 'turret', q: 2 }];
    const taken = takeOneFromPack(pack, 0);
    expect(taken).toEqual({ item: 'turret', q: 2 });
    expect(pack).toHaveLength(0);
  });
});
