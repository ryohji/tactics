// マスタリー(永続メタ)保存の単体テスト(rogue-23)。history.test.ts と同型。

import { describe, it, expect, afterEach } from 'vitest';
import { INITIAL_MASTERY } from '../model/rogue/mastery';
import { readMastery, writeMastery, clearMasteryForTest, setMasteryStorageForTest } from './masteryStore';

/** localStorage 互換のインメモリ実装(history/rogue のテストと同じ手法)。 */
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

afterEach(() => {
  setMasteryStorageForTest(null);
});

describe('masteryStore(永続カウンタの保存)', () => {
  it('初期状態は全カウンタ0', () => {
    setMasteryStorageForTest(memStorage());
    expect(readMastery()).toEqual(INITIAL_MASTERY);
  });

  it('書き込んだ値がそのまま読み戻る', () => {
    setMasteryStorageForTest(memStorage());
    writeMastery({ ...INITIAL_MASTERY, weaponKills: 12, evades: 3, absorbed: 40 });
    expect(readMastery()).toEqual({ ...INITIAL_MASTERY, weaponKills: 12, evades: 3, absorbed: 40 });
  });

  it('clearMasteryForTest で初期値に戻る', () => {
    setMasteryStorageForTest(memStorage());
    writeMastery({ ...INITIAL_MASTERY, weaponKills: 12, evades: 3, absorbed: 40 });
    clearMasteryForTest();
    expect(readMastery()).toEqual(INITIAL_MASTERY);
  });

  it('壊れた JSON でも初期値を返す(例外を投げない)', () => {
    const s = memStorage();
    s.setItem('fcc-rogue-mastery-v1', '{not json');
    setMasteryStorageForTest(s);
    expect(readMastery()).toEqual(INITIAL_MASTERY);
  });

  it('形の合わないデータでも初期値を返す', () => {
    const s = memStorage();
    s.setItem('fcc-rogue-mastery-v1', '{"foo":"bar"}');
    setMasteryStorageForTest(s);
    expect(readMastery()).toEqual(INITIAL_MASTERY);
  });

  it('storage が無い(Node 環境相当)なら no-op で例外を投げない', () => {
    setMasteryStorageForTest(null);
    expect(() => writeMastery({ ...INITIAL_MASTERY, weaponKills: 1, evades: 1, absorbed: 1 })).not.toThrow();
    expect(readMastery()).toEqual(INITIAL_MASTERY);
    expect(() => clearMasteryForTest()).not.toThrow();
  });
});
