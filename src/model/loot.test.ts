// 出土テーブルと湧きテーブルの深度スケーリング(rogue-9)。
// 乱数は seed 固定の LCG で統計的な性質(解禁・品質の伸び)を確認する。

import { describe, it, expect } from 'vitest';
import { lcg } from './dungeon';
import { lootTable } from './loot';
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
