// 盤面ストア（it-6 縮退後）の smoke テスト。
// 初期化で arena/occluder が埋まること、setParam(d) の単調性、プリセット切替を確認する。

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';

// 各テストの独立性のため、小アリーナへ戻す（既定プリセットは 29k セルで重い）。
beforeEach(() => {
  useStore.getState().setPreset('ruined');
  useStore.getState().setParam('Hmax', 4);
  useStore.getState().setParam('Lmax', 5);
  useStore.getState().setParam('d', 0.55);
});

describe('store 初期化', () => {
  it('arena / occluder が埋まっている', () => {
    const s = useStore.getState();
    expect(s.arenaSet.size).toBeGreaterThan(0);
    expect(s.occluderSet.size).toBeGreaterThan(0); // 大聖堂の床・柱がある
    for (const k of s.occluderSet) expect(s.arenaSet.has(k)).toBe(true);
  });
});

describe('setParam', () => {
  it('d を増やすと occluder が単調増加する', () => {
    const before = useStore.getState().occluderSet.size;
    useStore.getState().setParam('d', 1.5);
    expect(useStore.getState().occluderSet.size).toBeGreaterThanOrEqual(before);
  });

  it('アリーナ系でない param（S）では arena/occluder の参照が変わらない', () => {
    const before = useStore.getState();
    useStore.getState().setParam('S', 2.0);
    const after = useStore.getState();
    expect(after.arenaSet).toBe(before.arenaSet);
    expect(after.occluderSet).toBe(before.occluderSet);
  });
});

describe('setPreset（アリーナ切替）', () => {
  it('プリセット切替で地形・アリーナ・d が差し替わる', () => {
    const before = useStore.getState();
    useStore.getState().setPreset('sistine');
    const after = useStore.getState();
    expect(after.presetKey).toBe('sistine');
    expect(after.terrain).not.toBe(before.terrain);
    expect(after.arenaSet.size).toBeGreaterThan(40000); // 巨大アリーナ
    expect(after.params.Hmax).toBeGreaterThan(30);
  });

  it('未知キー・同一キーは無視（no-op）', () => {
    useStore.getState().setPreset('ruined');
    const ref = useStore.getState().terrain;
    useStore.getState().setPreset('ruined'); // 同一キー
    useStore.getState().setPreset('does-not-exist'); // 未知
    expect(useStore.getState().terrain).toBe(ref);
    expect(useStore.getState().presetKey).toBe('ruined');
  });
});
