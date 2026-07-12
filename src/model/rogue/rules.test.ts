// isoDate・dailySeed(rogue-20「本日の迷宮」)の純関数テスト。

import { describe, it, expect } from 'vitest';
import { isoDate, dailySeed, playerAtk, playerEvade } from './rules';
import type { PlayerState } from './types';
import type { NodeId } from './mastery';

function basePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    pos: [0, 0, 0],
    hp: 24,
    maxHp: 24,
    weapon: null,
    armor: null,
    shield: null,
    pack: [],
    barrier: 0,
    status: null,
    immune: 0,
    ...overrides,
  };
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

describe('スキルノードの効果(rogue-23)', () => {
  const dagger = { item: 'dagger', q: 0 } as const; // 片手武器
  const spear = { item: 'spear', q: 0 } as const; // 両手武器(twoHanded)
  const shield = { item: 'shield', q: 0 } as const;
  const skills = (...ids: NodeId[]) => ids;

  it('skills 省略時は素の値のまま(既存呼び出し元への後方互換)', () => {
    const p = basePlayer({ weapon: dagger });
    expect(playerAtk(p)).toBe(playerAtk(p, []));
  });

  it('kensan(研鑽): 武器装備中のみ攻撃+1(素手には効かない)', () => {
    const armed = basePlayer({ weapon: dagger });
    const unarmed = basePlayer({ weapon: null });
    expect(playerAtk(armed, skills('kensan'))).toBe(playerAtk(armed) + 1);
    expect(playerAtk(unarmed, skills('kensan'))).toBe(playerAtk(unarmed));
  });

  it('ryote(両手保持): 片手武器・盾スロットが空のときだけ攻撃+2', () => {
    const bare = basePlayer({ weapon: dagger, shield: null });
    const withShield = basePlayer({ weapon: dagger, shield });
    const twoHanded = basePlayer({ weapon: spear, shield: null });
    expect(playerAtk(bare, skills('ryote'))).toBe(playerAtk(bare) + 2);
    expect(playerAtk(withShield, skills('ryote'))).toBe(playerAtk(withShield)); // 盾で埋まっていると発動しない
    expect(playerAtk(twoHanded, skills('ryote'))).toBe(playerAtk(twoHanded)); // 両手武器には効かない
  });

  it('katate(片手扱い): 両手武器+盾の同時装備中のみ攻撃−2', () => {
    const dualWield = basePlayer({ weapon: spear, shield }); // katate があって初めて成立する組み合わせ
    const twoHandedOnly = basePlayer({ weapon: spear, shield: null });
    expect(playerAtk(dualWield, skills('katate'))).toBe(playerAtk(dualWield) - 2);
    expect(playerAtk(twoHandedOnly, skills('katate'))).toBe(playerAtk(twoHandedOnly)); // 盾が無ければ発動しない
  });

  it('jutsu(盾術): 盾装備中の回避+5%(盾なしには効かない)', () => {
    const withShield = basePlayer({ shield });
    const withoutShield = basePlayer({ shield: null });
    expect(playerEvade(withShield, skills('jutsu'))).toBe(playerEvade(withShield) + 5);
    expect(playerEvade(withoutShield, skills('jutsu'))).toBe(0);
  });
});

describe('rogue-24 のノード補正(playerAtk / playerEvade)', () => {
  const base = (over: Partial<PlayerState> = {}): PlayerState => ({
    pos: [0, 0, 0],
    hp: 24,
    maxHp: 24,
    weapon: null,
    armor: null,
    shield: null,
    pack: [],
    barrier: 0,
    status: null,
    immune: 0,
    ...over,
  });

  it('拳打: 素手のときだけ攻撃+3', () => {
    expect(playerAtk(base(), ['kenPunch']) - playerAtk(base())).toBe(3);
    const armed = base({ weapon: { item: 'dagger', q: 0 } });
    expect(playerAtk(armed, ['kenPunch'])).toBe(playerAtk(armed));
  });

  it('無傷の型: HP満タンのときだけ攻撃+2', () => {
    expect(playerAtk(base(), ['kenMuku']) - playerAtk(base())).toBe(2);
    const hurt = base({ hp: 23 });
    expect(playerAtk(hurt, ['kenMuku'])).toBe(playerAtk(hurt));
  });

  it('背水: HP25%以下かつ障壁0のとき攻撃+3・回避+25', () => {
    const low = base({ hp: 6 });
    expect(playerAtk(low, ['kenHaisui']) - playerAtk(low)).toBe(3);
    expect(playerEvade(low, ['kenHaisui']) - playerEvade(low)).toBe(25);
    const withBarrier = base({ hp: 6, barrier: 8 });
    expect(playerAtk(withBarrier, ['kenHaisui'])).toBe(playerAtk(withBarrier));
    expect(playerEvade(withBarrier, ['kenHaisui'])).toBe(playerEvade(withBarrier));
  });

  it('身軽: 素手なら盾なしでも回避+10', () => {
    expect(playerEvade(base(), ['kenMigaru'])).toBe(10);
    const armed = base({ weapon: { item: 'dagger', q: 0 } });
    expect(playerEvade(armed, ['kenMigaru'])).toBe(0);
  });

  it('絞り撃ち: 「絞る」以下の明かりでのみ攻撃+2(消灯でも効く)', () => {
    expect(playerAtk(base(), ['hiShibori'], 0) - playerAtk(base())).toBe(2);
    expect(playerAtk(base(), ['hiShibori'], 3) - playerAtk(base())).toBe(2);
    expect(playerAtk(base(), ['hiShibori'], 1)).toBe(playerAtk(base()));
    expect(playerAtk(base(), ['hiShibori'], 2)).toBe(playerAtk(base()));
  });

  it('掲盾: 盾装備中の遠隔攻撃に対してのみ回避+20', () => {
    const shielded = base({ shield: { item: 'shield', q: 0 } });
    expect(playerEvade(shielded, ['tateKakage'], true) - playerEvade(shielded)).toBe(20);
    expect(playerEvade(shielded, ['tateKakage'], false)).toBe(playerEvade(shielded));
    expect(playerEvade(base(), ['tateKakage'], true)).toBe(0); // 盾なしは対象外
  });
});
