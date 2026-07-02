import { describe, it, expect } from "vitest";
import {
  createSampleTerrain, buildCathedral, recommendedArena, vaultCrownOf,
  RUINED_CATHEDRAL, SISTINE_CATHEDRAL, PRESETS, DEFAULT_PRESET, type CathedralSpec,
} from "./cathedral";
import type { Vec3 } from "./terrain";
import { buildArena, keyToCell, layer, horizRadius } from "./fcc";

// テストはフレーム座標 (a,u,b) で代表点を作り、格子座標へ逆変換して sdf に渡す。
const SQRT2 = Math.SQRT2, SQRT3 = Math.sqrt(3), SQRT6 = Math.sqrt(6);
/** (a,u,b) フレーム → 格子座標。 */
function g(a: number, u: number, b: number): Vec3 {
  return [a / SQRT2 + u / SQRT3 + b / SQRT6, -a / SQRT2 + u / SQRT3 + b / SQRT6, u / SQRT3 - (2 * b) / SQRT6];
}
/** spec から導出する寸法ヘルパ（テストを寸法変更に強くする）。 */
function dims(s: CathedralSpec) {
  const pillarA = (i: number) => -s.naveHalfLen + (2 * s.naveHalfLen * i) / s.bays;
  const bayCenter = (i: number) => (pillarA(i) + pillarA(i + 1)) / 2;
  return { ...s, crown: vaultCrownOf(s), pillarA, bayCenter };
}

describe("RUINED_CATHEDRAL（既定 / 人間スケールの廃墟大聖堂）", () => {
  const terrain = createSampleTerrain();
  const S = dims(RUINED_CATHEDRAL);

  it("実体の内部で sdf が負（床・アーケード柱・側廊外壁・ヴォールト頂）", () => {
    expect(terrain.sdf(g(0, S.floorTop / 2, 0))).toBeLessThan(0); // 床
    expect(terrain.sdf(g(S.pillarA(3), 5, S.naveHalfWidth))).toBeLessThan(0); // アーケードのピア(a=0, 健在)
    expect(terrain.sdf(g(0, 4, S.aisleHalfWidth))).toBeLessThan(0); // 側廊外壁(a=0 ピア線, 窓なし)
    expect(terrain.sdf(g(S.naveHalfLen * 0.6, S.crown + 0.3, 0))).toBeLessThan(0); // ヴォールト殻の頂(屋根抜けの外)
  });

  it("障害物のない身廊筋に床上〜ヴォールト下まで連続して飛行できる空気がある", () => {
    const a = S.naveHalfLen * 0.65; // 瓦礫・倒れ柱の無い東寄りの筋
    for (const u of [2, 6, 12, S.crown - 2]) expect(terrain.sdf(g(a, u, 0))).toBeGreaterThan(0);
  });

  it("西扉・屋根抜けが空気（外と上に開く）", () => {
    expect(terrain.sdf(g(-(S.naveHalfLen + S.wallThick), 3, 0))).toBeGreaterThan(0); // 西正面の大扉
    expect(terrain.sdf(g(0, S.crown + 1, 0))).toBeGreaterThan(0); // 身廊中央の屋根抜け
  });

  it("アーケードは穴あき壁：ピアは実体、アーチ開口は空気（身廊⇄側廊が通る）", () => {
    expect(terrain.sdf(g(S.pillarA(3), 5, S.naveHalfWidth))).toBeLessThan(0); // ピア
    expect(terrain.sdf(g(S.bayCenter(2), 4, S.naveHalfWidth))).toBeGreaterThan(0); // ベイ中心のアーチ開口
  });

  it("南側廊の大崩落が内外を繋ぐ：内部・外壁ライン・外部が連続して空気", () => {
    const [ba, bu] = [6, 7]; // breach c=[6,7,-8] の高さ
    expect(terrain.sdf(g(ba, bu, -6))).toBeGreaterThan(0); // 内部（側廊）
    expect(terrain.sdf(g(ba, bu, -S.aisleHalfWidth))).toBeGreaterThan(0); // 外壁ライン
    expect(terrain.sdf(g(ba, bu, -10))).toBeGreaterThan(0); // 外部
  });

  it("折れピアはアーケードを欠く：keep より上は空気、根本は実体", () => {
    // side -1 index2 keep=4。
    expect(terrain.sdf(g(S.pillarA(2), S.floorTop + 6, -S.naveHalfWidth))).toBeGreaterThan(0); // keep より上
    expect(terrain.sdf(g(S.pillarA(2), S.floorTop + 1.5, -S.naveHalfWidth))).toBeLessThan(0); // 残った柱脚
  });

  it("瓦礫の山・倒れ柱が身廊の低層に実体 occluder（足場・くぐる遮蔽）を作る", () => {
    expect(terrain.sdf(g(-1, 2, 0))).toBeLessThan(0); // 身廊中央の瓦礫の山
    expect(terrain.sdf(g(3, 1.7, -1.5))).toBeLessThan(0); // 身廊を横切る倒れ柱
  });
});

describe("アリーナ整合（recommendedArena が地形を内包し飛行余白を持つ）", () => {
  it("廃墟大聖堂が既定アリーナに収まり、外周に通行可能な空気が残る", () => {
    const S = dims(RUINED_CATHEDRAL);
    const arena = DEFAULT_PRESET.arena;
    // 地形の最遠点（apse 東端・ヴォールト頂）がアリーナ内に入る。
    expect(arena.Hmax).toBeGreaterThanOrEqual(S.naveHalfLen + S.naveHalfWidth); // 身廊長手を覆う
    expect((2 * arena.Lmax) / SQRT3).toBeGreaterThan(S.crown); // ヴォールト頂より上まで層がある
  });

  it("既定 d で occluder が低層・中層・高層に分布し、外部にも空気が広がる", () => {
    const terrain = createSampleTerrain();
    const arena = buildArena(DEFAULT_PRESET.arena);
    const d = DEFAULT_PRESET.d;
    const occLayers = new Set<number>();
    let free = 0, exterior = 0;
    const hzOuter = RUINED_CATHEDRAL.aisleHalfWidth + 3;
    for (const key of arena) {
      const cell = keyToCell(key);
      if (terrain.sdf(cell) <= d) { occLayers.add(layer(cell)); continue; }
      free++;
      if (horizRadius(cell[0], cell[1], cell[2]) >= hzOuter) exterior++;
    }
    const layers = [...occLayers];
    expect(occLayers.size).toBeGreaterThanOrEqual(3);
    expect(layers.some((L) => L <= 2)).toBe(true); // 低層（床）
    expect(layers.some((L) => L >= 4 && L <= 10)).toBe(true); // 中層（壁・柱）
    expect(layers.some((L) => L >= 13)).toBe(true); // 高層（ヴォールト）
    expect(free).toBeGreaterThan(arena.size / 2); // 過半が通行可能（飛行前提）
    expect(exterior).toBeGreaterThan(20); // 建物外も飛べる
  });
});

describe("SISTINE_CATHEDRAL（巨大 / 側廊なしの単一大空間）", () => {
  const terrain = buildCathedral(SISTINE_CATHEDRAL);
  const S = dims(SISTINE_CATHEDRAL);

  it("既定の廃墟大聖堂より明確に大きい（高さ・長さとも）", () => {
    expect(S.crown).toBeGreaterThan(vaultCrownOf(RUINED_CATHEDRAL) * 1.4);
    expect(SISTINE_CATHEDRAL.naveHalfLen).toBeGreaterThan(RUINED_CATHEDRAL.naveHalfLen * 1.4);
  });

  it("床は実体、極めて高い内部空間が空気で連続する", () => {
    expect(terrain.sdf(g(0, S.floorTop / 2, 0))).toBeLessThan(0); // 床
    for (const u of [3, 12, 20, S.crown - 2]) expect(terrain.sdf(g(10, u, 0))).toBeGreaterThan(0);
  });

  it("側廊を持たない：身廊壁の外側（b>naveHalfWidth）はすぐ外部の空気", () => {
    expect(terrain.sdf(g(S.pillarA(4), 6, S.naveHalfWidth))).toBeLessThan(0); // 身廊外壁のピアは実体
    expect(terrain.sdf(g(S.pillarA(4), 6, S.naveHalfWidth + 2.5))).toBeGreaterThan(0); // その外は外部（側廊なし）
  });

  it("mesh() が空でない健全な三角形を返す", () => {
    const { positions, indices } = terrain.mesh(48);
    expect(positions.length).toBeGreaterThan(0);
    expect(indices.length % 3).toBe(0);
    for (const i of indices) expect(i).toBeLessThan(positions.length / 3);
  });

  it("巨大アリーナは数万セル規模で地形を内包する", () => {
    const arena = recommendedArena(SISTINE_CATHEDRAL);
    expect(arena.Hmax).toBeGreaterThanOrEqual(S.naveHalfLen);
    expect(buildArena(arena).size).toBeGreaterThan(40000);
  });
});

describe("PRESETS レジストリ", () => {
  it("ruined / sistine が登録され、各々 spec・推奨アリーナ・d を持つ", () => {
    for (const key of ["ruined", "sistine"]) {
      const p = PRESETS[key];
      expect(p.spec).toBeDefined();
      expect(p.arena.Hmax).toBeGreaterThan(0);
      expect(p.d).toBeGreaterThan(0);
    }
    expect(DEFAULT_PRESET).toBe(PRESETS.ruined);
  });
});
