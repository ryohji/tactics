// マスタリー(永続メタ)・スキルノードの純関数テスト(rogue-23)。
// レベル閾値・解禁・コスト集計・関門ドラフトの抽選(決定性/候補ゼロで乱数を引かない)。

import { describe, it, expect } from 'vitest';
import {
  masteryLevels,
  unlockedNodes,
  equippedCost,
  draftCandidates,
  counterFor,
  SKILL_NODES,
  NODE_IDS,
  INITIAL_MASTERY,
  type MasteryCounters,
} from './mastery';

function counters(over: Partial<MasteryCounters> = {}): MasteryCounters {
  return { ...INITIAL_MASTERY, ...over };
}

describe('masteryLevels(離散式の閾値)', () => {
  it('武技(討伐 10/30/80)', () => {
    expect(masteryLevels(counters({ weaponKills: 0 })).arms).toBe(0);
    expect(masteryLevels(counters({ weaponKills: 9 })).arms).toBe(0);
    expect(masteryLevels(counters({ weaponKills: 10 })).arms).toBe(1);
    expect(masteryLevels(counters({ weaponKills: 29 })).arms).toBe(1);
    expect(masteryLevels(counters({ weaponKills: 30 })).arms).toBe(2);
    expect(masteryLevels(counters({ weaponKills: 79 })).arms).toBe(2);
    expect(masteryLevels(counters({ weaponKills: 80 })).arms).toBe(3);
    expect(masteryLevels(counters({ weaponKills: 999 })).arms).toBe(3);
  });

  it('盾(回避 5/15/40)', () => {
    expect(masteryLevels(counters({ evades: 4 })).guard).toBe(0);
    expect(masteryLevels(counters({ evades: 5 })).guard).toBe(1);
    expect(masteryLevels(counters({ evades: 15 })).guard).toBe(2);
    expect(masteryLevels(counters({ evades: 40 })).guard).toBe(3);
  });

  it('甲殻(吸収 30/100/300)', () => {
    expect(masteryLevels(counters({ absorbed: 29 })).carapace).toBe(0);
    expect(masteryLevels(counters({ absorbed: 30 })).carapace).toBe(1);
    expect(masteryLevels(counters({ absorbed: 100 })).carapace).toBe(2);
    expect(masteryLevels(counters({ absorbed: 300 })).carapace).toBe(3);
  });

  it('系統は互いに独立している', () => {
    const levels = masteryLevels(counters({ weaponKills: 80, evades: 0, absorbed: 0 }));
    expect(levels).toEqual({ arms: 3, guard: 0, carapace: 0, fist: 0, stealth: 0, trapper: 0, light: 0 });
  });
});

/** 全系統0を基準に一部だけ上書きするレベル表(rogue-24 で系統が7本に増えたため)。 */
function levels(over: Partial<Record<import('./mastery').MasterySystem, number>> = {}) {
  return { arms: 0, guard: 0, carapace: 0, fist: 0, stealth: 0, trapper: 0, light: 0, ...over };
}

describe('unlockedNodes', () => {
  it('レベル0では何も解禁されない', () => {
    expect(unlockedNodes(levels())).toEqual([]);
  });

  it('系統ごとのレベルに応じてノードが解禁される', () => {
    const ids = unlockedNodes(levels({ arms: 2, guard: 1, carapace: 1 }));
    expect(ids).toContain('kensan'); // arms lv1
    expect(ids).toContain('ryote'); // arms lv2
    expect(ids).not.toContain('katate'); // arms lv3(未達)
    expect(ids).toContain('jutsu'); // guard lv1
    expect(ids).not.toContain('ukekaeshi'); // guard lv2(未達)
    expect(ids).toContain('kouka'); // carapace lv1
  });

  it('全系統レベル3で全ノードが解禁される', () => {
    expect(unlockedNodes(levels({ arms: 3, guard: 3, carapace: 3, fist: 3, stealth: 3, trapper: 3, light: 3 }))).toEqual(NODE_IDS);
  });
});

describe('counterFor(スキルツリー表示の進捗算出)', () => {
  it('系統ごとに対応するカウンタ値を返す', () => {
    const c = counters({ weaponKills: 42, evades: 7, absorbed: 120, fistKills: 3, stealthKills: 9, trapKills: 2, dimCollapses: 1 });
    expect(counterFor('arms', c)).toBe(42);
    expect(counterFor('guard', c)).toBe(7);
    expect(counterFor('carapace', c)).toBe(120);
    expect(counterFor('fist', c)).toBe(3);
    expect(counterFor('stealth', c)).toBe(9);
    expect(counterFor('trapper', c)).toBe(2);
    expect(counterFor('light', c)).toBe(1);
  });
});

describe('equippedCost', () => {
  it('コストの合計を返す', () => {
    expect(equippedCost([])).toBe(0);
    expect(equippedCost(['kensan'])).toBe(SKILL_NODES.kensan.cost);
    expect(equippedCost(['kensan', 'ryote'])).toBe(
      SKILL_NODES.kensan.cost + SKILL_NODES.ryote.cost,
    );
  });
});

describe('draftCandidates(関門ドラフトの抽選)', () => {
  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  it('候補ゼロなら rng を一切呼ばない', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5;
    };
    expect(draftCandidates([], rng, 3)).toEqual([]);
    expect(calls).toBe(0);
  });

  it('候補が1つ以上あれば rng を引く(候補数ぶん)', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5;
    };
    draftCandidates(['kensan'], rng, 3);
    expect(calls).toBe(1);
  });

  it('プールが n 未満なら有るだけ返す(重複なし)', () => {
    const out = draftCandidates(['kensan', 'jutsu'], lcg(1), 3);
    expect(out).toHaveLength(2);
    expect(new Set(out).size).toBe(2);
    expect(out.every((id) => ['kensan', 'jutsu'].includes(id))).toBe(true);
  });

  it('n を超えるプールから重複なく n 個を選ぶ', () => {
    const out = draftCandidates(NODE_IDS, lcg(7), 3);
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
  });

  it('同じプール・同じシードなら同じ3候補になる(決定性)', () => {
    const a = draftCandidates(NODE_IDS, lcg(12345), 3);
    const b = draftCandidates(NODE_IDS, lcg(12345), 3);
    expect(a).toEqual(b);
  });
});
