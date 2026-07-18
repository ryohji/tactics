// 図鑑・実績(永続メタ。rogue-25)保存の単体テスト。masteryStore.test.ts と同型。

import { describe, it, expect, afterEach } from 'vitest';
import {
  INITIAL_CODEX,
  readCodex,
  recordBeastKill,
  recordItemFound,
  recordEscape,
  unlockFeat,
  clearCodexForTest,
  setCodexStorageForTest,
} from './codexStore';

/** localStorage 互換のインメモリ実装(history/mastery のテストと同じ手法)。 */
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
  setCodexStorageForTest(null);
});

describe('codexStore(図鑑・実績の永続化)', () => {
  it('初期状態は空(全て未収集)', () => {
    setCodexStorageForTest(memStorage());
    expect(readCodex()).toEqual(INITIAL_CODEX);
  });

  it('recordBeastKill: 討伐数が積み上がり、初討伐深度は最初の1回だけ記録される', () => {
    setCodexStorageForTest(memStorage());
    recordBeastKill('bat', 3);
    recordBeastKill('bat', 7); // 2回目以降は深度が変わっても firstDepth は据え置き
    const c = readCodex();
    expect(c.beasts.bat).toEqual({ kills: 2, firstDepth: 3 });
  });

  it('recordItemFound: 入手数が積み上がり、最高品質が更新される(下方には動かない)', () => {
    setCodexStorageForTest(memStorage());
    recordItemFound('sword', 0);
    recordItemFound('sword', 2);
    recordItemFound('sword', 1); // 品質1は既存の最高2を下回るので更新されない
    const c = readCodex();
    expect(c.items.sword).toEqual({ found: 3, bestQ: 2 });
  });

  it('unlockFeat: 冪等(二重に呼んでも feats に1つだけ残る)', () => {
    setCodexStorageForTest(memStorage());
    unlockFeat('firstGate');
    unlockFeat('firstGate');
    unlockFeat('deep16');
    const c = readCodex();
    expect(c.feats).toEqual(['firstGate', 'deep16']);
  });

  it('clearCodexForTest で初期値に戻る', () => {
    setCodexStorageForTest(memStorage());
    recordBeastKill('bat', 1);
    unlockFeat('firstGate');
    clearCodexForTest();
    expect(readCodex()).toEqual(INITIAL_CODEX);
  });

  it('壊れた JSON でも初期値を返す(例外を投げない)', () => {
    const s = memStorage();
    s.setItem('fcc-rogue-codex-v1', '{not json');
    setCodexStorageForTest(s);
    expect(readCodex()).toEqual(INITIAL_CODEX);
  });

  it('形の合わないデータでも初期値を返す', () => {
    const s = memStorage();
    s.setItem('fcc-rogue-codex-v1', '{"foo":"bar"}');
    setCodexStorageForTest(s);
    expect(readCodex()).toEqual(INITIAL_CODEX);
  });

  it('rogue-27: 保存済みデータに残る廃止アイテム id(trapSpike 等)は読み込み時にフィルタされる', () => {
    const s = memStorage();
    s.setItem(
      'fcc-rogue-codex-v1',
      JSON.stringify({
        ...INITIAL_CODEX,
        items: { sword: { found: 2, bestQ: 1 }, trapSpike: { found: 5, bestQ: 2 } },
      }),
    );
    setCodexStorageForTest(s);
    const c = readCodex();
    expect(c.items.sword).toEqual({ found: 2, bestQ: 1 }); // 既知 id は保持
    expect('trapSpike' in c.items).toBe(false); // 未知 id は落とす
  });

  it('recordEscape(rogue-34): ambers/jellies/mandibles が種別ごとに加算され、最深生還層が更新される', () => {
    setCodexStorageForTest(memStorage());
    recordEscape({ ambers: 2, jellies: 1, mandibles: 0 }, 3);
    recordEscape({ ambers: 0, jellies: 1, mandibles: 2 }, 1); // 最深生還層は最大値のまま
    const c = readCodex();
    expect(c.ambers).toBe(2);
    expect(c.jellies).toBe(2);
    expect(c.mandibles).toBe(2);
    expect(c.bestStratumEscape).toBe(3);
  });

  it('recordEscape(rogue-34): 旧データ(jellies/mandiblesキー無し)は0補完されてから加算される', () => {
    const s = memStorage();
    s.setItem(
      'fcc-rogue-codex-v1',
      JSON.stringify({ beasts: {}, items: {}, feats: [], ambers: 5, bestStratumEscape: 2 }),
    );
    setCodexStorageForTest(s);
    // 補完前提の確認: 読み込み時点で jellies/mandibles が 0 になっている。
    expect(readCodex().jellies).toBe(0);
    expect(readCodex().mandibles).toBe(0);
    recordEscape({ ambers: 0, jellies: 3, mandibles: 1 }, 2);
    const c = readCodex();
    expect(c.ambers).toBe(5); // 既存値は保持
    expect(c.jellies).toBe(3); // 0 + 3
    expect(c.mandibles).toBe(1); // 0 + 1
  });

  it('storage が無い(Node 環境相当)なら no-op で例外を投げない', () => {
    setCodexStorageForTest(null);
    expect(() => recordBeastKill('bat', 1)).not.toThrow();
    expect(() => recordItemFound('sword', 0)).not.toThrow();
    expect(() => recordEscape({ ambers: 1, jellies: 1, mandibles: 1 }, 1)).not.toThrow();
    expect(() => unlockFeat('firstGate')).not.toThrow();
    expect(readCodex()).toEqual(INITIAL_CODEX);
    expect(() => clearCodexForTest()).not.toThrow();
  });
});
