// isoDate・dailySeed(rogue-20「本日の迷宮」)の純関数テスト。
// playerAtk/playerEvade は rogue-27 でランク付き(EquippedSkill)へ移行。

import { describe, it, expect } from 'vitest';
import { isoDate, dailySeed, playerAtk, playerEvade } from './rules';
import type { PlayerState } from './types';
import type { EquippedSkill, NodeId } from './mastery';

function basePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    pos: [0, 0, 0],
    hp: 24,
    maxHp: 24,
    weapon: null,
    armor: null,
    shield: null,
    pack: [],
    relics: [],
    barrier: 0,
    status: null,
    immune: 0,
    ...overrides,
  };
}

/** id・rank から EquippedSkill 配列を組む(テスト用の簡略記法)。 */
function eq(...entries: [NodeId, number][]): EquippedSkill[] {
  return entries.map(([id, rank]) => ({ id, rank }));
}

describe('isoDate', () => {
  it('YYYY-MM-DD 形式に整形する(月・日は0埋め)', () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(isoDate(new Date(2026, 10, 23))).toBe('2026-11-23');
  });
});

describe('dailySeed(本日の迷宮)', () => {
  it('同じ日付なら時刻が違っても同じシードになる(決定性)', () => {
    const a = dailySeed(new Date(2026, 6, 12, 0, 0, 1));
    const b = dailySeed(new Date(2026, 6, 12, 23, 59, 59));
    expect(a).toBe(b);
  });

  it('日付が違えば通常は違うシードになる', () => {
    const a = dailySeed(new Date(2026, 6, 12));
    const b = dailySeed(new Date(2026, 6, 13));
    expect(a).not.toBe(b);
  });

  it('常に有効な整数シードを返す', () => {
    const s = dailySeed(new Date(2026, 6, 12));
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
  });
});

describe('playerEvade(盾の回避%。rogue-22)', () => {
  it('盾なしは0、盾装備で品質込みの回避%が上がる', () => {
    expect(playerEvade(basePlayer())).toBe(0);
    expect(playerEvade(basePlayer({ shield: { item: 'shield', q: 0 } }))).toBe(10);
    expect(playerEvade(basePlayer({ shield: { item: 'shield', q: 2 } }))).toBe(14);
  });
});

describe('スキルノードの効果(rogue-23。rogue-27でランク制)', () => {
  const dagger = { item: 'dagger', q: 0 } as const; // 片手武器
  const spear = { item: 'spear', q: 0 } as const; // 両手武器(twoHanded)
  const shield = { item: 'shield', q: 0 } as const;

  it('eq 省略時は素の値のまま(既存呼び出し元への後方互換)', () => {
    const p = basePlayer({ weapon: dagger });
    expect(playerAtk(p)).toBe(playerAtk(p, []));
  });

  it('kensan(研鑽): 武器装備中のみ攻撃+ランク(1/2/3。素手には効かない)', () => {
    const armed = basePlayer({ weapon: dagger });
    const unarmed = basePlayer({ weapon: null });
    expect(playerAtk(armed, eq(['kensan', 1]))).toBe(playerAtk(armed) + 1);
    expect(playerAtk(armed, eq(['kensan', 2]))).toBe(playerAtk(armed) + 2);
    expect(playerAtk(armed, eq(['kensan', 3]))).toBe(playerAtk(armed) + 3);
    expect(playerAtk(unarmed, eq(['kensan', 1]))).toBe(playerAtk(unarmed));
  });

  it('ryote(両手保持): 片手武器・盾スロットが空のときだけ攻撃+2', () => {
    const bare = basePlayer({ weapon: dagger, shield: null });
    const withShield = basePlayer({ weapon: dagger, shield });
    const twoHanded = basePlayer({ weapon: spear, shield: null });
    expect(playerAtk(bare, eq(['ryote', 1]))).toBe(playerAtk(bare) + 2);
    expect(playerAtk(withShield, eq(['ryote', 1]))).toBe(playerAtk(withShield)); // 盾で埋まっていると発動しない
    expect(playerAtk(twoHanded, eq(['ryote', 1]))).toBe(playerAtk(twoHanded)); // 両手武器には効かない
  });

  it('katate(片手扱い): 両手武器+盾の同時装備中のみ攻撃−2', () => {
    const dualWield = basePlayer({ weapon: spear, shield }); // katate があって初めて成立する組み合わせ
    const twoHandedOnly = basePlayer({ weapon: spear, shield: null });
    expect(playerAtk(dualWield, eq(['katate', 1]))).toBe(playerAtk(dualWield) - 2);
    expect(playerAtk(twoHandedOnly, eq(['katate', 1]))).toBe(playerAtk(twoHandedOnly)); // 盾が無ければ発動しない
  });

  it('jutsu(盾術): 盾装備中の回避+ランク段階(5/8/12。盾なしには効かない)', () => {
    const withShield = basePlayer({ shield });
    const withoutShield = basePlayer({ shield: null });
    expect(playerEvade(withShield, eq(['jutsu', 1]))).toBe(playerEvade(withShield) + 5);
    expect(playerEvade(withShield, eq(['jutsu', 2]))).toBe(playerEvade(withShield) + 8);
    expect(playerEvade(withShield, eq(['jutsu', 3]))).toBe(playerEvade(withShield) + 12);
    expect(playerEvade(withoutShield, eq(['jutsu', 1]))).toBe(0);
  });
});

describe('二刀流(左手武器)の盾ボーナス kind ガード(rogue-30)', () => {
  const dagger = { item: 'dagger', q: 0 } as const; // 片手武器(左手に入りうる)
  const shield = { item: 'shield', q: 0 } as const;

  it('盾スロットに武器が入っていると盾の基礎回避%が乗らない', () => {
    expect(playerEvade(basePlayer({ shield: dagger }))).toBe(0);
    expect(playerEvade(basePlayer({ shield }))).toBe(10); // 本物の盾なら乗る(対照)
  });

  it('jutsu(盾術)の回避加算は盾スロットが本物の盾(kind===shield)のときだけ乗る', () => {
    const withWeapon = basePlayer({ shield: dagger });
    const withShield = basePlayer({ shield });
    expect(playerEvade(withWeapon, eq(['jutsu', 2]))).toBe(0);
    expect(playerEvade(withShield, eq(['jutsu', 2]))).toBe(10 + 8);
  });

  it('掲盾(tateKakage)の遠隔回避加算も盾スロットが本物の盾のときだけ乗る', () => {
    const withWeapon = basePlayer({ shield: dagger });
    const withShield = basePlayer({ shield });
    expect(playerEvade(withWeapon, eq(['tateKakage', 1]), true)).toBe(0);
    expect(playerEvade(withShield, eq(['tateKakage', 1]), true)).toBe(10 + 20);
  });
});

describe('rogue-24 のノード補正(playerAtk / playerEvade。rogue-27でランク制)', () => {
  const base = (over: Partial<PlayerState> = {}): PlayerState => ({
    pos: [0, 0, 0],
    hp: 24,
    maxHp: 24,
    weapon: null,
    armor: null,
    shield: null,
    pack: [],
    relics: [],
    barrier: 0,
    status: null,
    immune: 0,
    ...over,
  });

  it('拳打: 素手のときだけ攻撃+3/+5/+7(ランク別)', () => {
    expect(playerAtk(base(), eq(['kenPunch', 1])) - playerAtk(base())).toBe(3);
    expect(playerAtk(base(), eq(['kenPunch', 2])) - playerAtk(base())).toBe(5);
    expect(playerAtk(base(), eq(['kenPunch', 3])) - playerAtk(base())).toBe(7);
    const armed = base({ weapon: { item: 'dagger', q: 0 } });
    expect(playerAtk(armed, eq(['kenPunch', 1]))).toBe(playerAtk(armed));
  });

  it('無傷の型: HP満タンのときだけ攻撃+2', () => {
    expect(playerAtk(base(), eq(['kenMuku', 1])) - playerAtk(base())).toBe(2);
    const hurt = base({ hp: 23 });
    expect(playerAtk(hurt, eq(['kenMuku', 1]))).toBe(playerAtk(hurt));
  });

  it('背水: HP25%以下かつ障壁0のとき攻撃+3・回避+25', () => {
    const low = base({ hp: 6 });
    expect(playerAtk(low, eq(['kenHaisui', 1])) - playerAtk(low)).toBe(3);
    expect(playerEvade(low, eq(['kenHaisui', 1])) - playerEvade(low)).toBe(25);
    const withBarrier = base({ hp: 6, barrier: 8 });
    expect(playerAtk(withBarrier, eq(['kenHaisui', 1]))).toBe(playerAtk(withBarrier));
    expect(playerEvade(withBarrier, eq(['kenHaisui', 1]))).toBe(playerEvade(withBarrier));
  });

  it('身軽: 素手なら盾なしでも回避+10/+10/+15(ランク別)', () => {
    expect(playerEvade(base(), eq(['kenMigaru', 1]))).toBe(10);
    expect(playerEvade(base(), eq(['kenMigaru', 2]))).toBe(10);
    expect(playerEvade(base(), eq(['kenMigaru', 3]))).toBe(15);
    const armed = base({ weapon: { item: 'dagger', q: 0 } });
    expect(playerEvade(armed, eq(['kenMigaru', 1]))).toBe(0);
  });

  it('絞り撃ち: 「絞る」以下の明かりでのみ攻撃+2(消灯でも効く)', () => {
    expect(playerAtk(base(), eq(['hiShibori', 1]), 0) - playerAtk(base())).toBe(2);
    expect(playerAtk(base(), eq(['hiShibori', 1]), 3) - playerAtk(base())).toBe(2);
    expect(playerAtk(base(), eq(['hiShibori', 1]), 1)).toBe(playerAtk(base()));
    expect(playerAtk(base(), eq(['hiShibori', 1]), 2)).toBe(playerAtk(base()));
  });

  it('掲盾: 盾装備中の遠隔攻撃に対してのみ回避+20', () => {
    const shielded = base({ shield: { item: 'shield', q: 0 } });
    expect(playerEvade(shielded, eq(['tateKakage', 1]), true) - playerEvade(shielded)).toBe(20);
    expect(playerEvade(shielded, eq(['tateKakage', 1]), false)).toBe(playerEvade(shielded));
    expect(playerEvade(base(), eq(['tateKakage', 1]), true)).toBe(0); // 盾なしは対象外
  });

  it('結び「甲拳」(rogue-27 S2): 拳打×硬化の同時装着中、素手かつ障壁1以上で攻撃+2', () => {
    const knot = eq(['kenPunch', 1], ['kouka', 1]);
    const withBarrier = base({ barrier: 5 });
    const noBarrier = base({ barrier: 0 });
    const armed = base({ barrier: 5, weapon: { item: 'dagger', q: 0 } });
    // 拳打+3 に加えて甲拳+2。
    expect(playerAtk(withBarrier, knot) - playerAtk(withBarrier)).toBe(5);
    expect(playerAtk(noBarrier, knot) - playerAtk(noBarrier)).toBe(3); // 障壁0では発動しない
    expect(playerAtk(armed, knot)).toBe(playerAtk(armed, eq(['kouka', 1]))); // 武器持ちには効かない
    // 親が片方だけ(結び不成立)では素の拳打のみ。
    expect(playerAtk(withBarrier, eq(['kenPunch', 1])) - playerAtk(withBarrier)).toBe(3);
  });
});
