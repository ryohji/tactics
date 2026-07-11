// summary.ts の集計ロジック(rogue-19a)。RunResult[] は手で組み立て、
// パーセンタイル・死亡率・死因の集計だけを検証する(シミュレータ実行は絡めない)。

import { describe, it, expect } from 'vitest';
import { summarize } from './summary';
import type { RunResult } from './runner';

function result(over: Partial<RunResult>): RunResult {
  return {
    seed: 1,
    policy: 'greedy',
    phase: 'play',
    turns: 100,
    maxDepth: 5,
    kills: 3,
    deathCause: null,
    hp: 10,
    lightLevel: 1,
    discovered: 20,
    chambers: 4,
    stratum: 0,
    packSummary: {},
    ...over,
  };
}

describe('summarize', () => {
  it('policy ごとに分けて集計する', () => {
    const rs = [
      result({ policy: 'greedy', maxDepth: 1 }),
      result({ policy: 'cautious', maxDepth: 2 }),
    ];
    const s = summarize(rs);
    expect(s.map((x) => x.policy)).toEqual(['cautious', 'greedy']); // 名前順
    expect(s.find((x) => x.policy === 'greedy')?.runs).toBe(1);
  });

  it('到達深度の min/p50/max が並びと対応する', () => {
    const rs = [1, 2, 3, 4, 5].map((d) => result({ maxDepth: d }));
    const [s] = summarize(rs);
    expect(s.depth.min).toBe(1);
    expect(s.depth.p50).toBe(3);
    expect(s.depth.max).toBe(5);
  });

  it('通過層数(崩落)の平均・最大を数える', () => {
    const rs = [result({ stratum: 0 }), result({ stratum: 1 }), result({ stratum: 2 })];
    const [s] = summarize(rs);
    expect(s.stratum.avg).toBeCloseTo(1);
    expect(s.stratum.max).toBe(2);
  });

  it('死亡率と死因のヒストグラムを数える', () => {
    const rs = [
      result({ phase: 'dead', deathCause: '影の獣' }),
      result({ phase: 'dead', deathCause: '影の獣' }),
      result({ phase: 'dead', deathCause: '地竜' }),
      result({ phase: 'play', deathCause: null }),
    ];
    const [s] = summarize(rs);
    expect(s.deathRate).toBeCloseTo(0.75);
    expect(s.deathCauses).toEqual([
      { cause: '影の獣', count: 2 },
      { cause: '地竜', count: 1 },
    ]);
  });
});
