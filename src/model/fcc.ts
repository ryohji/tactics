// FCC（面心立方格子）コア幾何。Three 非依存の純 TS。
// 座標系・幾何定数は fcc_hex_3d_strategy_spec.md（1・2・5・7・12章）に厳密準拠する。

/** FCC 格子点。整数3つ組で x+y+z が偶数。 */
export type Cell = [number, number, number];

/** Set/Map のキーに使う文字列表現。 */
export type CellKey = string;

const SQRT2 = Math.SQRT2;
const SQRT3 = Math.sqrt(3);
const SQRT6 = Math.sqrt(6);

/**
 * 12近傍オフセット（仕様12章）。各々 x+y+z が偶数、ノルム²=2。
 * [111] 鉛直のもとで和（=2·ΔL）により 同一層6 / 上層3 / 下層3 に分かれる。
 */
export const OFFSETS: readonly Cell[] = [
  [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
  [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
  [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
];

/** Cell → "x,y,z" のキー文字列。 */
export function cellKey(c: Cell): CellKey {
  return `${c[0]},${c[1]},${c[2]}`;
}

/** キー文字列 → Cell。 */
export function keyToCell(k: CellKey): Cell {
  const parts = k.split(',');
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** ワールド座標（仕様2章）。S は表示倍率（幾何のみに効くスカラ）。 */
export function worldPos(
  x: number,
  y: number,
  z: number,
  S: number,
): { x: number; y: number; z: number } {
  return {
    x: (S * (x - y)) / SQRT2,
    y: (S * (x + y + z)) / SQRT3,
    z: (S * (x + y - 2 * z)) / SQRT6,
  };
}

/**
 * 実数点 (a,b,c) を最も近い FCC 格子点へ量子化する（仕様7.2）。
 * 各成分を丸め、和が奇数なら丸め残差最大の軸を2番目に近い整数へ振って偶奇を直す。
 */
export function nearestFCC(a: number, b: number, c: number): Cell {
  const r: Cell = [Math.round(a), Math.round(b), Math.round(c)];
  if ((r[0] + r[1] + r[2]) % 2 === 0) return r;

  const res = [a - r[0], b - r[1], c - r[2]];
  let i = 0;
  for (let k = 1; k < 3; k++) {
    if (Math.abs(res[k]) > Math.abs(res[i])) i = k;
  }
  r[i] += res[i] > 0 ? 1 : -1;
  return r;
}

/** c の12近傍（OFFSETS を足した点）。 */
export function neighbors(c: Cell): Cell[] {
  return OFFSETS.map((o) => [c[0] + o[0], c[1] + o[1], c[2] + o[2]] as Cell);
}

/** 層 L = (x+y+z)/2（仕様2章）。 */
export function layer(c: Cell): number {
  return (c[0] + c[1] + c[2]) / 2;
}

/** 水平半径（格子単位、仕様5章）。[111] に垂直な平面内での中心からの距離。 */
export function horizRadius(x: number, y: number, z: number): number {
  const u = (x - y) / SQRT2;
  const w = (x + y - 2 * z) / SQRT6;
  return Math.sqrt(u * u + w * w);
}

export interface ArenaParams {
  Lmin: number;
  Lmax: number;
  Hmax: number;
}

/**
 * 六角柱アリーナ（仕様5章）。
 * { (x,y,z) ∈ FCC : Lmin ≤ (x+y+z)/2 ≤ Lmax ∧ horizRadius ≤ Hmax }。
 * 戻り値は DESIGN §2 の arenaSet 型に合わせ Set<CellKey>。
 */
export function buildArena({ Lmin, Lmax, Hmax }: ArenaParams): Set<CellKey> {
  const arena = new Set<CellKey>();

  // 探索範囲。直交基底による (X,Y,Z) と (x,y,z) は等長変換で結ばれるため、
  // |X|,|Z| ≤ Hmax かつ Y=2L/√3 から各座標の絶対値上限を導ける（+1 余裕）。
  const Labs = Math.max(Math.abs(Lmin), Math.abs(Lmax));
  const Ymax = (2 * Labs) / SQRT3;
  const xyBound = Math.ceil(Hmax / SQRT2 + Ymax / SQRT3 + Hmax / SQRT6) + 1;
  const zBound = Math.ceil(Ymax / SQRT3 + (2 * Hmax) / SQRT6) + 1;

  for (let x = -xyBound; x <= xyBound; x++) {
    for (let y = -xyBound; y <= xyBound; y++) {
      for (let z = -zBound; z <= zBound; z++) {
        if ((x + y + z) % 2 !== 0) continue; // FCC 条件
        const L = (x + y + z) / 2;
        if (L < Lmin || L > Lmax) continue;
        if (horizRadius(x, y, z) > Hmax) continue;
        arena.add(cellKey([x, y, z]));
      }
    }
  }
  return arena;
}
