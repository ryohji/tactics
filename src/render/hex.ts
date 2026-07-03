// ヘックスタイル描画の共通部品(it-6 QAフィードバック第2回)。
// FCC 胞(菱形十二面体)の水平断面は正六角形(仕様12章 HEX_VERTICES)。
// これを「床タイル」として敷くことで、水平位置の読み取りを2次元ヘックスの直観に乗せる。
//
// worldPos は純線形写像なので、六角形を S 倍で1つ作れば各セルへは平行移動だけで配置できる
// (InstancedMesh の1ジオメトリ + per-instance 平行移動。Terrain.tsx の RD と同じ手法)。

import * as THREE from 'three';
import { worldPos, type Cell, type CellKey, keyToCell } from '../model/fcc';

/** 胞の水平断面六角形の6頂点(格子単位、仕様12章)。x+y+z=0 でセル中心と同層の平面。 */
export const HEX_VERTICES: readonly Cell[] = [
  [2 / 3, -1 / 3, -1 / 3],
  [1 / 3, 1 / 3, -2 / 3],
  [-1 / 3, 2 / 3, -1 / 3],
  [-2 / 3, 1 / 3, 1 / 3],
  [-1 / 3, -1 / 3, 2 / 3],
  [1 / 3, -2 / 3, 1 / 3],
];

/** タイルをセル中心からどれだけ沈めるか(ワールド、S 倍前)。足元の床に見せる。 */
export const HEX_Y_OFFSET = -0.42;

/** 六角形の塗り(triangle fan)。中心原点・ワールド空間・S 倍・足元へ沈めた高さ。 */
export function buildHexTile(S: number): THREE.BufferGeometry {
  const v = HEX_VERTICES.map((p) => worldPos(p[0], p[1], p[2], S));
  const pos: number[] = [];
  const push = (i: number) => pos.push(v[i].x, v[i].y + HEX_Y_OFFSET * S, v[i].z);
  for (let i = 1; i < 5; i++) {
    push(0);
    push(i);
    push(i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * セル集合の六角形の輪郭線をひとつの LineSegments 用ジオメトリにまとめる。
 * (セルごとに6辺。対象は数千セルまで想定 — 盤面変更時のみ再構築。)
 */
export function buildHexEdges(keys: readonly CellKey[], S: number): THREE.BufferGeometry {
  const v = HEX_VERTICES.map((p) => worldPos(p[0], p[1], p[2], S));
  const pos: number[] = [];
  for (const k of keys) {
    const c = keyToCell(k);
    const w = worldPos(c[0], c[1], c[2], S);
    const cy = w.y + HEX_Y_OFFSET * S;
    for (let i = 0; i < 6; i++) {
      const a = v[i];
      const b = v[(i + 1) % 6];
      pos.push(w.x + a.x, cy + a.y, w.z + a.z, w.x + b.x, cy + b.y, w.z + b.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
