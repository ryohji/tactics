// isoDate・dailySeed(rogue-20「本日の迷宮」)の純関数テスト。

import { describe, it, expect } from 'vitest';
import { isoDate, dailySeed, playerEvade } from './rules';
import type { PlayerState } from './types';

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
