import { describe, it, expect } from 'vitest';
import {
  OFFSETS,
  cellKey,
  keyToCell,
  worldPos,
  nearestFCC,
  neighbors,
  layer,
  horizRadius,
  buildArena,
  type Cell,
} from './fcc';

const isFCC = (c: Cell) => (c[0] + c[1] + c[2]) % 2 === 0;
const norm2 = (c: Cell) => c[0] * c[0] + c[1] * c[1] + c[2] * c[2];

describe('OFFSETS', () => {
  it('12要素ある', () => {
    expect(OFFSETS).toHaveLength(12);
  });

  it('各オフセットは FCC 条件（和が偶数）を満たし、ノルム²=2', () => {
    for (const o of OFFSETS) {
      expect(isFCC(o)).toBe(true);
      expect(norm2(o)).toBe(2);
    }
  });

  it('[111] 鉛直で 同一層6 / 上層3 / 下層3 に分かれる', () => {
    const byDL = { up: 0, same: 0, down: 0 };
    for (const o of OFFSETS) {
      const dl = (o[0] + o[1] + o[2]) / 2; // ΔL
      if (dl === 1) byDL.up++;
      else if (dl === 0) byDL.same++;
      else if (dl === -1) byDL.down++;
    }
    expect(byDL).toEqual({ up: 3, same: 6, down: 3 });
  });
});

describe('cellKey / keyToCell', () => {
  it('往復で一致する', () => {
    const c: Cell = [2, -4, 0];
    expect(cellKey(c)).toBe('2,-4,0');
    expect(keyToCell(cellKey(c))).toEqual(c);
  });
});

describe('neighbors', () => {
  it('原点の12近傍はすべて FCC 条件を満たす', () => {
    const ns = neighbors([0, 0, 0]);
    expect(ns).toHaveLength(12);
    for (const n of ns) expect(isFCC(n)).toBe(true);
  });

  it('任意の FCC 点の近傍も FCC 条件を満たす', () => {
    for (const base of [[0, 0, 0], [2, 0, 0], [1, 1, 2], [-3, 1, 0]] as Cell[]) {
      for (const n of neighbors(base)) expect(isFCC(n)).toBe(true);
    }
  });
});

describe('worldPos', () => {
  it('原点は原点に写る', () => {
    expect(worldPos(0, 0, 0, 1.4)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('最近接のワールド距離は √2·S', () => {
    const S = 1.4;
    const o = worldPos(0, 0, 0, S);
    for (const n of neighbors([0, 0, 0])) {
      const p = worldPos(n[0], n[1], n[2], S);
      const d = Math.hypot(p.x - o.x, p.y - o.y, p.z - o.z);
      expect(d).toBeCloseTo(Math.SQRT2 * S, 10);
    }
  });

  it('S に線形にスケールする', () => {
    const p1 = worldPos(1, 1, 0, 1);
    const p3 = worldPos(1, 1, 0, 3);
    expect(p3.x).toBeCloseTo(p1.x * 3, 10);
    expect(p3.y).toBeCloseTo(p1.y * 3, 10);
    expect(p3.z).toBeCloseTo(p1.z * 3, 10);
  });
});

describe('nearestFCC', () => {
  it('既に FCC 点ならそのまま返す', () => {
    expect(nearestFCC(2, 0, 0)).toEqual([2, 0, 0]);
    expect(nearestFCC(1.1, 0.9, 0.05)).toEqual([1, 1, 0]);
  });

  it('和が奇数になる丸めは偶数和の点へ補正する', () => {
    const r = nearestFCC(1.0, 0.0, 0.0); // round=(1,0,0) 和1 → 補正
    expect(isFCC(r)).toBe(true);
  });

  it('任意の実数点で常に FCC 点（和が偶数）を返す', () => {
    const pts: [number, number, number][] = [
      [0.4, 0.4, 0.4], [2.6, -1.3, 0.1], [-0.5, 0.5, 1.49], [3.3, 3.3, 3.3],
    ];
    for (const [a, b, c] of pts) expect(isFCC(nearestFCC(a, b, c))).toBe(true);
  });
});

describe('layer / horizRadius', () => {
  it('layer = (x+y+z)/2', () => {
    expect(layer([0, 0, 0])).toBe(0);
    expect(layer([1, 1, 0])).toBe(1);
    expect(layer([2, 2, 2])).toBe(3);
  });

  it('horizRadius は中心軸上で 0', () => {
    // (x,y,z)=(t,t,t) は [111] 軸上 → 水平成分 0
    expect(horizRadius(0, 0, 0)).toBeCloseTo(0, 12);
    expect(horizRadius(2, 2, 2)).toBeCloseTo(0, 12);
  });

  it('horizRadius は最近接ワールド距離と整合（水平近傍で √2）', () => {
    // (1,-1,0) は同一層の水平近傍。水平距離 = √2。
    expect(horizRadius(1, -1, 0)).toBeCloseTo(Math.SQRT2, 12);
  });
});

describe('buildArena', () => {
  it('すべて FCC 条件・層範囲・水平半径を満たす', () => {
    const Hmax = 4;
    const arena = buildArena({ Lmin: 0, Lmax: 5, Hmax });
    expect(arena.size).toBeGreaterThan(0);
    for (const k of arena) {
      const c = keyToCell(k);
      expect(isFCC(c)).toBe(true);
      const L = layer(c);
      expect(L).toBeGreaterThanOrEqual(0);
      expect(L).toBeLessThanOrEqual(5);
      expect(horizRadius(c[0], c[1], c[2])).toBeLessThanOrEqual(Hmax + 1e-9);
    }
  });

  it('境界外（層範囲外・水平半径超過）を含まない', () => {
    const arena = buildArena({ Lmin: 0, Lmax: 5, Hmax: 4 });
    // 層外
    expect(arena.has(cellKey([-1, 0, -1]))).toBe(false); // L=-1
    // 水平半径超過（L=0 だが大きく外れた点）
    expect(arena.has(cellKey([6, -6, 0]))).toBe(false);
  });

  it('Hmax を広げるとセル数は単調に増える', () => {
    const small = buildArena({ Lmin: 0, Lmax: 3, Hmax: 2 });
    const big = buildArena({ Lmin: 0, Lmax: 3, Hmax: 5 });
    expect(big.size).toBeGreaterThan(small.size);
  });

  it('層範囲を広げるとセル数は単調に増える', () => {
    const narrow = buildArena({ Lmin: 0, Lmax: 1, Hmax: 4 });
    const wide = buildArena({ Lmin: 0, Lmax: 5, Hmax: 4 });
    expect(wide.size).toBeGreaterThan(narrow.size);
  });

  it('各層に少なくとも1セルが存在し、層数が範囲と一致する', () => {
    const Lmin = 0;
    const Lmax = 5;
    const arena = buildArena({ Lmin, Lmax, Hmax: 4 });
    const layers = new Set<number>();
    for (const k of arena) layers.add(layer(keyToCell(k)));
    for (let L = Lmin; L <= Lmax; L++) expect(layers.has(L)).toBe(true);
    expect(layers.size).toBe(Lmax - Lmin + 1);
  });
});
