// マスタリー(永続メタ)・スキルノードの純関数テスト(rogue-23。rogue-27でランク・
// 結び・排他・天秤ドラフトへ改訂。rogue-35で四道・ノード単位 deed へ再編)。
// deed 閾値による解禁ランク判定・コスト集計・takeable(EXCLUDES 込み)・
// draftLanes(決定性/候補ゼロで乱数を引かない)。

import { describe, it, expect } from 'vitest';
import {
  unlockedRank,
  equippedCost,
  takeable,
  draftLanes,
  hasAnyMastery,
  SKILL_NODES,
  NODE_IDS,
  EXCLUDES,
  INITIAL_MASTERY,
  type MasteryCounters,
  type EquippedSkill,
} from './mastery';

function counters(over: Partial<MasteryCounters> = {}): MasteryCounters {
  return { ...INITIAL_MASTERY, ...over };
}

describe('unlockedRank(rogue-35: ノード単位 deed の解禁判定)', () => {
  it('根ノード(at[0]===0)はカウンタ0でもランクI解禁', () => {
    expect(unlockedRank('kenPunch', counters())).toBe(1);
    expect(unlockedRank('wanaAmi', counters())).toBe(1);
  });

  it('根でないノードはカウンタ0では0', () => {
    expect(unlockedRank('jutsu', counters())).toBe(0);
    expect(unlockedRank('kenMuku', counters())).toBe(0);
  });

  it('ライン(ランクI/II/III)は閾値を跨ぐごとに段階的に解禁される(kenPunch: 0/5/15)', () => {
    expect(unlockedRank('kenPunch', counters({ fistKills: 0 }))).toBe(1);
    expect(unlockedRank('kenPunch', counters({ fistKills: 4 }))).toBe(1);
    expect(unlockedRank('kenPunch', counters({ fistKills: 5 }))).toBe(2);
    expect(unlockedRank('kenPunch', counters({ fistKills: 14 }))).toBe(2);
    expect(unlockedRank('kenPunch', counters({ fistKills: 15 }))).toBe(3);
    expect(unlockedRank('kenPunch', counters({ fistKills: 999 }))).toBe(3);
  });

  it('単発ノードは閾値未満なら0、以上なら1(上限1)', () => {
    expect(unlockedRank('kenMuku', counters({ unhurtKills: 9 }))).toBe(0);
    expect(unlockedRank('kenMuku', counters({ unhurtKills: 10 }))).toBe(1);
    expect(unlockedRank('kenMuku', counters({ unhurtKills: 999 }))).toBe(1);
  });

  it('各ノードの deed カウンタが正しく紐づいている(表の一部を代表確認)', () => {
    expect(unlockedRank('ryote', counters({ oneHandFreeKills: 15 }))).toBe(1);
    expect(unlockedRank('katate', counters({ twoHandKills: 15 }))).toBe(1);
    expect(unlockedRank('kenHaisui', counters({ lowHpKills: 3 }))).toBe(1);
    expect(unlockedRank('tosshin', counters({ twoHandKills: 10 }))).toBe(1);
    expect(unlockedRank('jutsu', counters({ evades: 5 }))).toBe(1);
    expect(unlockedRank('kaeshi', counters({ evades: 10 }))).toBe(1);
    expect(unlockedRank('tateuchi', counters({ evades: 25 }))).toBe(1);
    expect(unlockedRank('shinShinobi', counters({ stealthStrikes: 5 }))).toBe(1);
    expect(unlockedRank('keikai', counters({ stealthStrikes: 15 }))).toBe(1);
    expect(unlockedRank('kawarimi', counters({ stealthStrikes: 25 }))).toBe(1);
    expect(unlockedRank('hiShibori', counters({ darkKills: 3 }))).toBe(1);
    expect(unlockedRank('shingan', counters({ darkKills: 10 }))).toBe(1);
    expect(unlockedRank('knifeRico', counters({ knifeKills: 5 }))).toBe(1);
    expect(unlockedRank('hiEnjin', counters({ trapKills: 5 }))).toBe(1);
    expect(unlockedRank('tenka', counters({ absorbed: 100 }))).toBe(1);
    expect(unlockedRank('hiKagari', counters({ absorbed: 30 }))).toBe(1);
  });
});

describe('equippedCost(rogue-27: ランク別コストの合計)', () => {
  it('コストの合計を返す(ランクごとの costs[rank-1])', () => {
    expect(equippedCost([])).toBe(0);
    expect(equippedCost([{ id: 'kenPunch', rank: 1 }])).toBe(SKILL_NODES.kenPunch.costs[0]);
    expect(equippedCost([{ id: 'kenPunch', rank: 2 }])).toBe(SKILL_NODES.kenPunch.costs[1]);
    expect(
      equippedCost([
        { id: 'kenPunch', rank: 1 },
        { id: 'ryote', rank: 1 },
      ]),
    ).toBe(SKILL_NODES.kenPunch.costs[0] + SKILL_NODES.ryote.costs[0]);
  });
});

describe('hasAnyMastery', () => {
  it('全カウンタ0なら false', () => {
    expect(hasAnyMastery(counters())).toBe(false);
  });
  it('1つでも動いていれば true', () => {
    expect(hasAnyMastery(counters({ evades: 1 }))).toBe(true);
  });
});

describe('takeable(次に装着できる候補。EXCLUDES 込み)', () => {
  it('マスタリー0では根ノード(kenPunch・wanaAmi)ランクIだけが候補', () => {
    const cands = takeable([], counters());
    expect(cands.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [
        { id: 'kenPunch', rank: 1 },
        { id: 'wanaAmi', rank: 1 },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it('deed が満たされると次ランクが候補になる(現在ランクの次だけ)', () => {
    const cands = takeable([{ id: 'kenPunch', rank: 1 }], counters({ fistKills: 15 }));
    const kenPunch = cands.find((c) => c.id === 'kenPunch');
    expect(kenPunch).toEqual({ id: 'kenPunch', rank: 2 }); // 既にランク1、次はランク2のみ
  });

  it('全ランク解禁済みでも、装着済みノードは候補から外れる(cur>=max)', () => {
    const full = counters({
      fistKills: 999,
      evades: 999,
      absorbed: 999,
      stealthStrikes: 999,
      trapKills: 999,
      oneHandFreeKills: 999,
      twoHandKills: 999,
      unhurtKills: 999,
      lowHpKills: 999,
      darkKills: 999,
      knifeKills: 999,
    });
    const cands = takeable([{ id: 'kenPunch', rank: 3 }], full);
    expect(cands.some((c) => c.id === 'kenPunch')).toBe(false);
  });

  it('EXCLUDES: kenMuku 装着中は kenHaisui のランクI到達が候補から外れる(逆方向も対称)', () => {
    const full = counters({ unhurtKills: 999, lowHpKills: 999 });
    expect(takeable([{ id: 'kenMuku', rank: 1 }], full).some((c) => c.id === 'kenHaisui')).toBe(false);
    expect(takeable([{ id: 'kenHaisui', rank: 1 }], full).some((c) => c.id === 'kenMuku')).toBe(false);
  });

  it('EXCLUDES はこの1組だけ(反撃排他は返し統合で消滅)', () => {
    expect(EXCLUDES.length).toBe(1);
    expect(EXCLUDES[0]).toEqual([
      ['kenMuku', 1],
      ['kenHaisui', 1],
    ]);
  });

  it('NODE_IDS の全ノードを走査する(未知の id が混ざらない)', () => {
    const full = counters({
      fistKills: 999,
      evades: 999,
      absorbed: 999,
      stealthStrikes: 999,
      trapKills: 999,
      oneHandFreeKills: 999,
      twoHandKills: 999,
      unhurtKills: 999,
      lowHpKills: 999,
      darkKills: 999,
      knifeKills: 999,
    });
    const cands = takeable([], full);
    expect(cands.every((c) => NODE_IDS.includes(c.id))).toBe(true);
    expect(cands.length).toBeGreaterThan(0);
  });
});

describe('廃止ノード・結びの縮小(rogue-35)', () => {
  it('廃止 id は SKILL_NODES に存在しない', () => {
    const ids = Object.keys(SKILL_NODES);
    for (const removed of ['kensan', 'kenMigaru', 'hiShobo', 'ukekaeshi']) {
      expect(ids).not.toContain(removed);
    }
  });

  it('NODE_IDS は25個(四道: bu8・mamori7・kage7・waza3)', () => {
    expect(NODE_IDS.length).toBe(25);
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
    // kenPunch・wanaAmi ランクIが常時候補なので、真に空にするには両方装着済みにしておく。
    const eq: EquippedSkill[] = [
      { id: 'kenPunch', rank: 1 },
      { id: 'wanaAmi', rank: 1 },
    ];
    expect(draftLanes(eq, counters(), rng)).toEqual([]);
    expect(calls).toBe(0);
  });

  it('候補が2つ(根ノードのみ)なら2枠まで引く', () => {
    const rng = () => 0.5;
    const out = draftLanes([], counters(), rng);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((c) => c.id === 'kenPunch' || c.id === 'wanaAmi')).toBe(true);
  });

  it('同じ装着・カウンタ・乱数列なら同じ3枠になる(決定性)', () => {
    const full = counters({
      fistKills: 999,
      evades: 999,
      absorbed: 999,
      stealthStrikes: 999,
      trapKills: 999,
      oneHandFreeKills: 999,
      twoHandKills: 999,
      unhurtKills: 999,
      lowHpKills: 999,
      darkKills: 999,
      knifeKills: 999,
    });
    const a = draftLanes([], full, lcg(12345));
    const b = draftLanes([], full, lcg(12345));
    expect(a).toEqual(b);
  });

  it('候補が3つ以上あれば3枠とも埋まり、id は重複しない', () => {
    const full = counters({
      fistKills: 999,
      evades: 999,
      absorbed: 999,
      stealthStrikes: 999,
      trapKills: 999,
      oneHandFreeKills: 999,
      twoHandKills: 999,
      unhurtKills: 999,
      lowHpKills: 999,
      darkKills: 999,
      knifeKills: 999,
    });
    const out = draftLanes([], full, lcg(7));
    expect(out).toHaveLength(3);
    expect(new Set(out.map((c) => c.id)).size).toBe(3);
  });

  it('enレーン: 装着中と同じ道・または結びの相方のランク1候補が選ばれうる', () => {
    // kouka(mamori)を装着中: 同じ道のtenka・tateuchi・hiKagari、および結び
    // (rentetsu/kouken/shouha)の相方である jutsu・kenPunch・tateuchi のランク1候補が
    // en レーンの対象になりうる。
    const full = counters({
      fistKills: 999,
      evades: 999,
      absorbed: 999,
      stealthStrikes: 999,
      trapKills: 999,
      oneHandFreeKills: 999,
      twoHandKills: 999,
      unhurtKills: 999,
      lowHpKills: 999,
      darkKills: 999,
      knifeKills: 999,
    });
    const eq: EquippedSkill[] = [{ id: 'kouka', rank: 1 }]; // mamori
    const out = draftLanes(eq, full, lcg(99));
    expect(out.length).toBeGreaterThan(0);
    const en = out.find((c) => c.lane === 'en');
    if (en) {
      expect(en.rank).toBe(1);
    }
  });
});
