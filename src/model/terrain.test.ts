import { describe, it, expect } from "vitest";
import {
  toFrame,
  fromFrame,
  sdSphere,
  sdBox,
  sdCappedCylinder,
  subtract,
  smoothUnion,
  marchingCubes,
  UP,
  type Vec3,
  type FrameBounds,
} from "./terrain";

// terrain.ts は SDF ツールキット（プリミティブ + フレーム変換 + Marching Cubes）。
// 具体地形は cathedral.ts が組み立てる（cathedral.test.ts でカバー）。ここは toolkit の単体検証。

const SQRT2 = Math.SQRT2, SQRT3 = Math.sqrt(3);

describe("フレーム変換 toFrame/fromFrame", () => {
  it("toFrame は格子座標 → (a,u,b) 正規直交。往復で一致する", () => {
    for (const p of [[1, 0, 0], [0, 2, -3], [2.5, -1.5, 4]] as Vec3[]) {
      const [a, u, b] = toFrame(p);
      const back = fromFrame(a, u, b);
      for (let k = 0; k < 3; k++) expect(back[k]).toBeCloseTo(p[k], 9);
    }
  });

  it("u 軸は [1,1,1] 方向（鉛直）、a 軸は (x-y)/√2", () => {
    const v = toFrame([1, 1, 1]); // [111] は純粋に u 方向
    expect(v[0]).toBeCloseTo(0, 9);
    expect(v[1]).toBeCloseTo(SQRT3, 9);
    expect(v[2]).toBeCloseTo(0, 9);
    const w = toFrame([1, -1, 0]); // (x-y)/√2 = √2 の a 方向
    expect(w[0]).toBeCloseTo(SQRT2, 9);
    expect(w[1]).toBeCloseTo(0, 9);
    expect(w[2]).toBeCloseTo(0, 9);
  });

  it("フレーム距離は格子距離に一致する（S=1 正規直交回転）", () => {
    const p: Vec3 = [1.2, -0.7, 2.1], q: Vec3 = [-0.3, 1.1, 0.4];
    const fp = toFrame(p), fq = toFrame(q);
    const dFrame = Math.hypot(fp[0] - fq[0], fp[1] - fq[1], fp[2] - fq[2]);
    const dGrid = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    expect(dFrame).toBeCloseTo(dGrid, 9);
  });
});

describe("プリミティブ SDF", () => {
  it("sdSphere: 中心で -r、表面で 0、外で正、距離が正確", () => {
    expect(sdSphere([0, 0, 0], [0, 0, 0], 2)).toBeCloseTo(-2, 9);
    expect(sdSphere([2, 0, 0], [0, 0, 0], 2)).toBeCloseTo(0, 9);
    expect(sdSphere([5, 0, 0], [0, 0, 0], 2)).toBeCloseTo(3, 9);
  });

  it("sdBox: 内部は負、面外は正確な外部距離", () => {
    expect(sdBox([0, 0, 0], [0, 0, 0], [1, 1, 1])).toBeLessThan(0);
    expect(sdBox([3, 0, 0], [0, 0, 0], [1, 1, 1])).toBeCloseTo(2, 9);
  });

  it("sdCappedCylinder: 軸上は内部、側面距離・キャップ距離が正確", () => {
    expect(sdCappedCylinder([0, 0, 0], [0, 0, 0], UP, 2, 1)).toBeLessThan(0);
    expect(sdCappedCylinder([3, 0, 0], [0, 0, 0], UP, 2, 1)).toBeCloseTo(2, 9); // 側面方向
    expect(sdCappedCylinder([0, 5, 0], [0, 0, 0], UP, 2, 1)).toBeCloseTo(3, 9); // 軸方向（キャップ）
  });

  it("subtract / smoothUnion の規約（負=内部）", () => {
    // 球から球をくり抜くと中心は空気（正）になる。
    expect(subtract(sdSphere([0, 0, 0], [0, 0, 0], 2), sdSphere([0, 0, 0], [0, 0, 0], 1))).toBeGreaterThan(0);
    // smoothUnion は min 以下（接合がふくらむ）。
    const a = sdSphere([1, 0, 0], [0, 0, 0], 1.2), b = sdSphere([1, 0, 0], [2, 0, 0], 1.2);
    expect(smoothUnion(a, b, 0.5)).toBeLessThanOrEqual(Math.min(a, b) + 1e-9);
  });
});

describe("marchingCubes（球の等値面）", () => {
  it("半径 R の球を三角形化し、全頂点が球面近傍に乗る", () => {
    const R = 2;
    const field = (a: number, u: number, b: number) => Math.hypot(a, u, b) - R;
    const bounds: FrameBounds = { aMin: -3, aMax: 3, uMin: -3, uMax: 3, bMin: -3, bMax: 3 };
    const { positions, indices } = marchingCubes(field, bounds, 24);
    expect(positions.length).toBeGreaterThan(0);
    expect(indices.length % 3).toBe(0);
    // positions は格子座標。フレームへ戻して半径を測ると R 近傍。
    let maxErr = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const [a, u, b] = toFrame([positions[i], positions[i + 1], positions[i + 2]]);
      maxErr = Math.max(maxErr, Math.abs(Math.hypot(a, u, b) - R));
    }
    expect(maxErr).toBeLessThan(0.15); // res=24 の格子解像度内
  });
});
