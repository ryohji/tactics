// isoDate・dailySeed(rogue-20「本日の迷宮」)の純関数テスト。

import { describe, it, expect } from 'vitest';
import { isoDate, dailySeed } from './rules';

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
