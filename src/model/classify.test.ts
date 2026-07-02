import { describe, it, expect } from 'vitest';
import {
  occluderSet,
  reachable,
  reachableWithin,
  threatened,
  lineBlocked,
} from './classify';
import { buildArena, cellKey, neighbors, type Cell, type CellKey } from './fcc';
import type { Terrain, Vec3 } from './terrain';
import { createSampleTerrain } from './cathedral';

const ARENA = { Lmin: 0, Lmax: 5, Hmax: 4 } as const;

// --- テスト用の合成 Terrain（classify のロジック検証用。サンプル地形の造形に依存しない）---
// classify は格子座標のセル中心をそのまま sdf へ渡すので、ここでは格子座標で
// 直接プリミティブSDFを定義する。mesh は classify では使わないのでダミー。

const DUMMY_MESH = { positions: new Float32Array(), indices: new Uint32Array() };

/** 中心 center・半径 r の球。内部 sdf<0、外部 sdf>0 を厳密に満たす。 */
function sphereTerrain(center: Vec3, r: number): Terrain {
  return {
    sdf: (p: Vec3) =>
      Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]) - r,
    mesh: () => DUMMY_MESH,
  };
}

describe('occluderSet', () => {
  it('d を上げると単調に増加する（包含関係を保つ）', () => {
    const arena = buildArena(ARENA);
    const terrain = sphereTerrain([0, 0, 0], 2);
    const ds = [-3, -2, -1, 0, 0.45, 1, 2, 5];
    let prev: Set<CellKey> | null = null;
    for (const d of ds) {
      const occ = occluderSet(arena, terrain, d);
      if (prev) {
        expect(occ.size).toBeGreaterThanOrEqual(prev.size);
        for (const k of prev) expect(occ.has(k)).toBe(true); // 包含
      }
      for (const k of occ) expect(arena.has(k)).toBe(true); // arena の部分集合
      prev = occ;
    }
  });

  it('球内部のセルは occluder に入り、外部のセルは入らない', () => {
    const arena = buildArena(ARENA);
    const center: Vec3 = [0, 0, 0];
    const r = 2;
    const terrain = sphereTerrain(center, r);
    const occ = occluderSet(arena, terrain, 0); // d=0 → sdf≤0（内部）のみ
    expect(occ.size).toBeGreaterThan(0);
    for (const k of arena) {
      const c = keyToVec(k);
      const inside = Math.hypot(c[0], c[1], c[2]) <= r; // sdf≤0
      expect(occ.has(k)).toBe(inside);
    }
  });

  it('サンプル地形でも occluder が一定数生成される（造形に依存しない緩い検証）', () => {
    const arena = buildArena(ARENA);
    const occ = occluderSet(arena, createSampleTerrain(), 0.45);
    expect(occ.size).toBeGreaterThan(0);
    expect(occ.size).toBeLessThan(arena.size); // 全部は埋まらない
    for (const k of occ) expect(arena.has(k)).toBe(true);
  });
});

describe('reachable', () => {
  const active: Cell = [0, 0, 0];
  const ns = neighbors(active);

  it('arena 外の近傍を除外する', () => {
    const arena = new Set<CellKey>(ns.slice(0, 6).map(cellKey));
    const r = reachable(active, arena, new Set());
    const keys = r.map(cellKey);
    expect(keys).toHaveLength(6);
    for (const n of ns.slice(0, 6)) expect(keys).toContain(cellKey(n));
    for (const n of ns.slice(6)) expect(keys).not.toContain(cellKey(n));
  });

  it('occluder の近傍を除外する', () => {
    const arena = new Set<CellKey>(ns.map(cellKey));
    const occ = new Set<CellKey>([cellKey(ns[0]), cellKey(ns[3])]);
    const r = reachable(active, arena, occ);
    const keys = r.map(cellKey);
    expect(keys).toHaveLength(10);
    expect(keys).not.toContain(cellKey(ns[0]));
    expect(keys).not.toContain(cellKey(ns[3]));
  });

  it('他ユニット占有の近傍を除外する（occupied 任意）', () => {
    const arena = new Set<CellKey>(ns.map(cellKey));
    const occupied = new Set<CellKey>([cellKey(ns[2])]);
    expect(reachable(active, arena, new Set())).toHaveLength(12);
    expect(reachable(active, arena, new Set(), occupied)).toHaveLength(11);
  });

  it('合成地形: occluder/arena外を結果に含まない', () => {
    const arena = buildArena(ARENA);
    // 原点付近の球を地形に。active は球から離れた空きセルに置く。
    const occ = occluderSet(arena, sphereTerrain([0, 0, 0], 2), 0.45);
    const start: Cell = [4, 4, 2];
    expect(occ.has(cellKey(start))).toBe(false);
    const r = reachable(start, arena, occ);
    expect(r.length).toBeGreaterThan(0);
    for (const n of r) {
      const k = cellKey(n);
      expect(arena.has(k)).toBe(true);
      expect(occ.has(k)).toBe(false);
    }
  });
});

describe('reachableWithin（BFS 複数歩）', () => {
  const arena = buildArena(ARENA);
  const occ = occluderSet(arena, sphereTerrain([0, 0, 0], 2), 0.45);
  const active: Cell = [4, 4, 2];

  it('1歩は reachable と一致する', () => {
    const one = new Set(reachableWithin(active, 1, arena, occ).map(cellKey));
    const ref = new Set(reachable(active, arena, occ).map(cellKey));
    expect(one).toEqual(ref);
  });

  it('歩数を増やすと到達集合は単調に拡大し、active を含まない', () => {
    const s1 = new Set(reachableWithin(active, 1, arena, occ).map(cellKey));
    const r2 = reachableWithin(active, 2, arena, occ);
    const s2 = new Set(r2.map(cellKey));
    expect(s2.size).toBeGreaterThanOrEqual(s1.size);
    for (const k of s1) expect(s2.has(k)).toBe(true);
    expect(s2.has(cellKey(active))).toBe(false);
    for (const n of r2) {
      const k = cellKey(n);
      expect(arena.has(k)).toBe(true);
      expect(occ.has(k)).toBe(false);
    }
  });
});

describe('threatened', () => {
  it('Rthreat 以内の敵があれば true', () => {
    const enemies: Cell[] = [[2, 2, 0]];
    // [0,0,0]→[2,2,0] の距離 = √8 ≈ 2.83
    expect(threatened([0, 0, 0], enemies, 2.6)).toBe(false);
    expect(threatened([0, 0, 0], enemies, 3.0)).toBe(true);
    expect(threatened([1, 1, 0], enemies, 2.6)).toBe(true); // 距離 √2
  });

  it('敵がいなければ常に false', () => {
    expect(threatened([0, 0, 0], [], 100)).toBe(false);
  });
});

describe('lineBlocked（近似 LoS）', () => {
  const params = { dOcc: 0.45, spacing: 0.12 };

  it('地形を挟む2点は遮蔽 true', () => {
    // 原点の球を挟んで対称な2点。線分中点が球内部を通る。
    const terrain = sphereTerrain([0, 0, 0], 1.5);
    expect(lineBlocked([2, -2, 0], [-2, 2, 0], terrain, params)).toBe(true);
  });

  it('開けた経路の2点は遮蔽 false', () => {
    // 同じ球を、線分が常に球から離れている高さに置いた2点。
    const terrain = sphereTerrain([0, 0, 0], 1.5);
    expect(lineBlocked([2, -2, 4], [-2, 2, 4], terrain, params)).toBe(false);
  });

  it('端点が地形内部でも内点が地形外なら false（端点は除外）', () => {
    // P 自身は球内部だが、Q は遠方で線分の内点は球外を通る。
    const terrain = sphereTerrain([0, 0, 0], 1);
    expect(lineBlocked([0, 0, 0], [10, 10, 0], terrain, params)).toBe(false);
  });

  it('退化線分（P==Q）は常に false', () => {
    const terrain = sphereTerrain([0, 0, 0], 1.5);
    expect(lineBlocked([0, 0, 0], [0, 0, 0], terrain, params)).toBe(false);
  });
});

/** CellKey "x,y,z" → Vec3。テスト内の球内外判定用。 */
function keyToVec(k: CellKey): Vec3 {
  const [x, y, z] = k.split(',').map(Number);
  return [x, y, z];
}
