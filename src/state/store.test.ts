// W4 ストアの smoke テスト。初期化で各 Set が埋まること、
// setActive が到達外を弾くこと、setParam(d) で occluder が単調増加することを確認する。

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { keyToCell, cellKey } from '../model/fcc';

// 各テストの独立性のため、既定パラメータと再評価で初期状態へ戻す。
beforeEach(() => {
  useStore.setState({
    params: { S: 1.4, d: 0.45, Rthreat: 2.6, Hmax: 4, Lmin: 0, Lmax: 5 },
    arenaSet: undefined as never, // 直後に setParam で再生成
  });
  // Hmax を一度書いてアリーナ再生成 + refresh を確実に走らせる。
  useStore.getState().setParam('Hmax', 4);
});

describe('store 初期化', () => {
  it('各導出 Set が埋まっている', () => {
    const s = useStore.getState();
    expect(s.arenaSet.size).toBeGreaterThan(0);
    expect(s.occluderSet.size).toBeGreaterThan(0); // 地形があるので非空
    expect(s.reachableSet.size).toBeGreaterThan(0); // 妥当な active なら到達先がある
  });

  it('active は arena 内・非 occluder', () => {
    const s = useStore.getState();
    const k = cellKey(s.active);
    expect(s.arenaSet.has(k)).toBe(true);
    expect(s.occluderSet.has(k)).toBe(false);
  });
});

describe('setActive', () => {
  it('reachable 外のセルは弾く（active 不変）', () => {
    const before = useStore.getState().active;
    // arena から十分外れた到達不能セルを渡す。
    useStore.getState().setActive([999, 999, 998]);
    expect(useStore.getState().active).toEqual(before);
  });

  it('reachable 内のセルへ移動できる', () => {
    const reachable = [...useStore.getState().reachableSet];
    expect(reachable.length).toBeGreaterThan(0);
    const target = keyToCell(reachable[0]);
    useStore.getState().setActive(target);
    expect(useStore.getState().active).toEqual(target);
  });

  it('移動では occluderSet/threatSet を再計算しない（参照不変＝壮大スケールでも軽い）', () => {
    const before = useStore.getState();
    const occRef = before.occluderSet;
    const threatRef = before.threatSet;
    const target = keyToCell([...before.reachableSet][0]);
    useStore.getState().setActive(target);
    const after = useStore.getState();
    // active 非依存の重い導出は同一参照のまま（全アリーナ sdf 判定をやり直していない）。
    expect(after.occluderSet).toBe(occRef);
    expect(after.threatSet).toBe(threatRef);
    // 一方、active 依存の reachableSet は更新されている。
    expect(after.active).toEqual(target);
    expect(after.reachableSet).not.toBe(before.reachableSet);
  });
});

describe('setParam', () => {
  it('d を増やすと occluder が単調増加する', () => {
    const before = useStore.getState().occluderSet.size;
    useStore.getState().setParam('d', 1.5);
    expect(useStore.getState().occluderSet.size).toBeGreaterThanOrEqual(before);
  });
});

describe('setPreset（アリーナ切替）', () => {
  it('巨大プリセットへ切替で地形・アリーナ・d が差し替わり、導出 Set が妥当', () => {
    const before = useStore.getState();
    useStore.getState().setPreset('sistine');
    const after = useStore.getState();
    expect(after.presetKey).toBe('sistine');
    expect(after.terrain).not.toBe(before.terrain); // 地形が差し替わった
    expect(after.arenaSet.size).toBeGreaterThan(40000); // 巨大アリーナ
    expect(after.params.Hmax).toBeGreaterThan(30);
    // active は arena 内・非 occluder、到達セルがある（壊れていない）。
    const k = cellKey(after.active);
    expect(after.arenaSet.has(k)).toBe(true);
    expect(after.occluderSet.has(k)).toBe(false);
    expect(after.reachableSet.size).toBeGreaterThan(0);
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
