// ローカルスコアボード(rogue-20)の単体テスト。追加・上限切り詰め・破損 JSON 耐性。

import { describe, it, expect, afterEach } from 'vitest';
import { appendRun, readHistory, clearHistory, setHistoryStorageForTest, type RunRecord } from './history';

/** localStorage 互換のインメモリ実装(persist/rogue のテストと同じ手法)。 */
function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, v),
  } as unknown as Storage;
}

function record(over: Partial<RunRecord> = {}): RunRecord {
  return {
    v: 'r19',
    seed: 1,
    date: '2026-07-12',
    turns: 10,
    kills: 1,
    maxDepth: 2,
    stratum: 0,
    deathCause: 'グール',
    daily: false,
    skills: [],
    ...over,
  };
}

afterEach(() => {
  setHistoryStorageForTest(null);
});

describe('history(ローカルスコアボード)', () => {
  it('追加した記録が先頭(最新)に来る', () => {
    setHistoryStorageForTest(memStorage());
    appendRun(record({ seed: 1 }));
    appendRun(record({ seed: 2 }));
    const h = readHistory();
    expect(h).toHaveLength(2);
    expect(h[0].seed).toBe(2);
    expect(h[1].seed).toBe(1);
  });

  it('最大100件で切り詰める', () => {
    setHistoryStorageForTest(memStorage());
    for (let i = 0; i < 105; i++) appendRun(record({ seed: i }));
    const h = readHistory();
    expect(h).toHaveLength(100);
    expect(h[0].seed).toBe(104); // 最新が先頭
    expect(h[99].seed).toBe(5); // 古い5件は切り詰められている
  });

  it('clearHistory で空になる', () => {
    setHistoryStorageForTest(memStorage());
    appendRun(record());
    clearHistory();
    expect(readHistory()).toEqual([]);
  });

  it('壊れた JSON でも空配列を返す(例外を投げない)', () => {
    const s = memStorage();
    s.setItem('fcc-rogue-history-v1', '{not json');
    setHistoryStorageForTest(s);
    expect(readHistory()).toEqual([]);
  });

  it('配列以外が入っていても空配列を返す', () => {
    const s = memStorage();
    s.setItem('fcc-rogue-history-v1', '{"foo":"bar"}');
    setHistoryStorageForTest(s);
    expect(readHistory()).toEqual([]);
  });

  it('storage が無い(Node 環境相当)なら no-op で例外を投げない', () => {
    setHistoryStorageForTest(null);
    expect(() => appendRun(record())).not.toThrow();
    expect(readHistory()).toEqual([]);
    expect(() => clearHistory()).not.toThrow();
  });
});
