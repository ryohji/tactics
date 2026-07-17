// マスタリー(永続メタ)・スキルノードの純関数テスト(rogue-23。rogue-27でランク・
// 結び・排他・天秤ドラフトへ改訂)。レベル閾値・解禁ランク・コスト集計・
// takeable(EXCLUDES 込み)・draftLanes(決定性/候補ゼロで乱数を引かない)。

import { describe, it, expect } from 'vitest';
import {
  masteryLevels,
  unlockedRank,
  equippedCost,
  takeable,
  draftLanes,
  counterFor,
  SKILL_NODES,
  NODE_IDS,
  INITIAL_MASTERY,
  type MasteryCounters,
  type EquippedSkill,
  type MasterySystem,
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
function levels(over: Partial<Record<MasterySystem, number>> = {}) {
  return { arms: 0, guard: 0, carapace: 0, fist: 0, stealth: 0, trapper: 0, light: 0, ...over };
}

describe('unlockedRank(rogue-27: ランク制の解禁判定)', () => {
  it('レベル0では単発/ラインとも0(ただし wanaAmi はランクIが常時解禁)', () => {
    expect(unlockedRank('kensan', levels())).toBe(0);
    expect(unlockedRank('jutsu', levels())).toBe(0);
    expect(unlockedRank('wanaAmi', levels())).toBe(1); // unlockLevels=[0,1,2] → ランクIはLv0
  });

  it('ラインはレベルに応じてランクが段階的に解禁される(kensan: 1/2/3)', () => {
    expect(unlockedRank('kensan', levels({ arms: 1 }))).toBe(1);
    expect(unlockedRank('kensan', levels({ arms: 2 }))).toBe(2);
    expect(unlockedRank('kensan', levels({ arms: 3 }))).toBe(3);
  });

  it('wanaAmi はレベル1でランクII、レベル2でランクIII', () => {
    expect(unlockedRank('wanaAmi', levels({ trapper: 1 }))).toBe(2);
    expect(unlockedRank('wanaAmi', levels({ trapper: 2 }))).toBe(3);
  });

  it('単発ノードは要求レベル未満なら0、以上なら1(上限1)', () => {
    expect(unlockedRank('ryote', levels({ arms: 1 }))).toBe(0); // ryote は arms lv2
    expect(unlockedRank('ryote', levels({ arms: 2 }))).toBe(1);
    expect(unlockedRank('ryote', levels({ arms: 3 }))).toBe(1);
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

describe('equippedCost(rogue-27: ランク別コストの合計)', () => {
  it('コストの合計を返す(ランクごとの costs[rank-1])', () => {
    expect(equippedCost([])).toBe(0);
    expect(equippedCost([{ id: 'kensan', rank: 1 }])).toBe(SKILL_NODES.kensan.costs[0]);
    expect(equippedCost([{ id: 'kensan', rank: 2 }])).toBe(SKILL_NODES.kensan.costs[1]);
    expect(
      equippedCost([
        { id: 'kensan', rank: 1 },
        { id: 'ryote', rank: 1 },
      ]),
    ).toBe(SKILL_NODES.kensan.costs[0] + SKILL_NODES.ryote.costs[0]);
  });
});

describe('takeable(次に装着できる候補。EXCLUDES 込み)', () => {
  it('マスタリー0では何も取れない(wanaAmi ランクIだけが常時候補)', () => {
    const cands = takeable([], levels());
    expect(cands).toEqual([{ id: 'wanaAmi', rank: 1 }]);
  });

  it('系統レベルに応じて次ランクが候補になる(現在ランクの次だけ)', () => {
    const cands = takeable([{ id: 'kensan', rank: 1 }], levels({ arms: 3 }));
    const kensan = cands.find((c) => c.id === 'kensan');
    expect(kensan).toEqual({ id: 'kensan', rank: 2 }); // 既にランク1、次はランク2のみ
  });

  it('全ランク解禁済みでも、装着済みノードは候補から外れる(cur>=max)', () => {
    const cands = takeable(
      [{ id: 'kensan', rank: 3 }],
      levels({ arms: 3, guard: 3, carapace: 3, fist: 3, stealth: 3, trapper: 3, light: 3 }),
    );
    expect(cands.some((c) => c.id === 'kensan')).toBe(false);
  });

  it('EXCLUDES: jutsu ランクII以上を装着中は kenMigaru のランクII到達が候補から外れる', () => {
    const full = levels({ arms: 3, guard: 3, carapace: 3, fist: 3, stealth: 3, trapper: 3, light: 3 });
    const eq: EquippedSkill[] = [
      { id: 'jutsu', rank: 2 },
      { id: 'kenMigaru', rank: 1 },
    ];
    const cands = takeable(eq, full);
    // kenMigaru は現在ランク1、次候補はランク2のはずだが EXCLUDES で塞がれている。
    expect(cands.some((c) => c.id === 'kenMigaru')).toBe(false);
  });

  it('EXCLUDES: kenMuku 装着中は kenHaisui のランクI到達が候補から外れる(逆方向も対称)', () => {
    const full = levels({ arms: 3, guard: 3, carapace: 3, fist: 3, stealth: 3, trapper: 3, light: 3 });
    expect(takeable([{ id: 'kenMuku', rank: 1 }], full).some((c) => c.id === 'kenHaisui')).toBe(false);
    expect(takeable([{ id: 'kenHaisui', rank: 1 }], full).some((c) => c.id === 'kenMuku')).toBe(false);
  });

  it('NODE_IDS の全ノードを走査する(未知の id が混ざらない)', () => {
    const full = levels({ arms: 3, guard: 3, carapace: 3, fist: 3, stealth: 3, trapper: 3, light: 3 });
    const cands = takeable([], full);
    expect(cands.every((c) => NODE_IDS.includes(c.id))).toBe(true);
    expect(cands.length).toBeGreaterThan(0);
  });
});

describe('draftLanes(関門の天秤ドラフト)', () => {
  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  it('takeable が空なら rng を一切呼ばない', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5;
    };
    // wanaAmi ランクIが常時候補なので、真に空にするには装着済みにしておく。
    const eq: EquippedSkill[] = [{ id: 'wanaAmi', rank: 1 }];
    expect(draftLanes(eq, levels(), rng)).toEqual([]);
    expect(calls).toBe(0);
  });

  it('候補が1つ(wanaAmiランクIのみ)なら1枠だけ引き、lane=nagareに縮退する', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5;
    };
    const out = draftLanes([], levels(), rng);
    expect(out).toEqual([{ id: 'wanaAmi', rank: 1, lane: 'nagare' }]);
    expect(calls).toBe(1);
  });

  it('同じ装着・レベル・乱数列なら同じ3枠になる(決定性)', () => {
    const full = levels({ arms: 3, guard: 3, carapace: 3, fist: 3, stealth: 3, trapper: 3, light: 3 });
    const a = draftLanes([], full, lcg(12345));
    const b = draftLanes([], full, lcg(12345));
    expect(a).toEqual(b);
  });

  it('候補が3つ以上あれば3枠とも埋まり、id は重複しない', () => {
    const full = levels({ arms: 3, guard: 3, carapace: 3, fist: 3, stealth: 3, trapper: 3, light: 3 });
    const out = draftLanes([], full, lcg(7));
    expect(out).toHaveLength(3);
    expect(new Set(out.map((c) => c.id)).size).toBe(3);
  });

  it('enレーン: 装着中と同系統・または結びの相方のランク1候補が選ばれうる', () => {
    // kouka(carapace)を装着中: 同系統のtenka、および結び(rentetsu/kouken)の相方である
    // jutsu・kenPunchのランク1候補がenレーンの対象になりうる。
    const full = levels({ arms: 3, guard: 3, carapace: 3, fist: 3, stealth: 3, trapper: 3, light: 3 });
    const eq: EquippedSkill[] = [{ id: 'kouka', rank: 1 }]; // carapace 系統
    const out = draftLanes(eq, full, lcg(99));
    expect(out.length).toBeGreaterThan(0);
    // en レーンで採用されていれば、同系統(carapace)のランク1候補のはず。
    const en = out.find((c) => c.lane === 'en');
    if (en) {
      expect(en.rank).toBe(1);
    }
  });
});
