// 菱形十二面体（RD）の幾何ヘルパ（仕様12章）。領域稜線/セル塗りの共有定数。
// Terrain.tsx（W6）にも同等の定数があるが、当該ファイルは別担当のため import せず、
// 仕様定義に基づく独立コピーをここに置く（格子単位・セル中心原点）。
//
// worldPos は定数項なしの線形写像なので、セル局所頂点 v（格子単位）にもそのまま適用でき、
// RD を1つ作れば各セルへは worldPos(cell) の平行移動だけで配置できる（InstancedMesh 化可能）。

import * as THREE from 'three';
import { worldPos, type Cell } from '../model/fcc';

/** RD の14頂点（格子単位）。0..5=軸方向(4価), 6..13=立方体型(3価)。 */
export const RD_VERTICES: readonly Cell[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5],
  [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5],
];

/** 12枚のひし形面（RD_VERTICES への index 四角形）。 */
export const RD_FACES: readonly [number, number, number, number][] = [
  [0, 6, 2, 7], [0, 8, 3, 9], [0, 6, 4, 8], [0, 7, 5, 9],
  [1, 10, 2, 11], [1, 12, 3, 13], [1, 10, 4, 12], [1, 11, 5, 13],
  [2, 6, 4, 10], [2, 7, 5, 11], [3, 8, 4, 12], [3, 9, 5, 13],
];

/**
 * RD の一意な24辺。各ひし形面の4辺を無向辺として重複排除する
 * （12面×4辺＝48 有向辺 → 24 無向辺）。稜線（ワイヤフレーム）描画に使う。
 */
export const RD_EDGES: readonly [number, number][] = (() => {
  const seen = new Map<string, [number, number]>();
  for (const f of RD_FACES) {
    for (let i = 0; i < 4; i++) {
      const a = f[i];
      const b = f[(i + 1) % 4];
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = `${lo},${hi}`;
      if (!seen.has(key)) seen.set(key, [lo, hi]);
    }
  }
  return [...seen.values()];
})();

/** 占有セル1個ぶんの RD ジオメトリ（中心原点・ワールド空間・S倍）。フラット陰影。 */
export function buildRhombicDodecahedron(S: number): THREE.BufferGeometry {
  const v = RD_VERTICES.map((p) => worldPos(p[0], p[1], p[2], S));
  const pos: number[] = [];
  const push = (i: number) => pos.push(v[i].x, v[i].y, v[i].z);
  for (const [a, b, c, d] of RD_FACES) {
    push(a); push(b); push(c); // 三角形 a-b-c
    push(a); push(c); push(d); // 三角形 a-c-d
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
