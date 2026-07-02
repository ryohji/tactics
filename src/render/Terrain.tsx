// 地形描画（W6）。胞構造と整合する2系統をトグルで併置する（DESIGN §5 / 仕様8章 7）。
//   1. ボリューム表示: 地形SDF の Marching Cubes 等値面メッシュ（連続地形の姿）。
//   2. 占有セルの塗り: occluderSet を菱形十二面体（RD）の半透明メッシュで塗る（胞分割）。
// 両者を重ねて「連続地形 ↔ 胞分割」の対応を見比べる。
//
// 統合（Scene/App への差し込み）は W5 が担当。本ファイルは独立コンポーネントのみ提供する。
//
// 座標変換の要点（仕様2・12章）: worldPos は格子座標の純線形写像（定数項なし）。
//   worldPos(cell + v) = worldPos(cell) + worldPos(v)
// なので RD のセル局所頂点 v（格子単位）にもそのまま worldPos を適用でき、
// RD 形状を S 倍で1つ作れば各占有セルへは worldPos(cell) の平行移動だけで配置できる
// （= InstancedMesh の1ジオメトリ + per-instance 平行移動で全セルを塗れる）。

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { worldPos, keyToCell, type Cell } from '../model/fcc';
import { useStore } from '../state/store';

// 描画パラメータ（当面ファイル内定数。必要なら後で store 化）。
const TERRAIN_RES = 48; // 等値面の分割数
const TERRAIN_OPACITY = 1.0; // ボリュームメッシュ不透明度
const CELL_OPACITY = 0.35; // 占有セル胞塗りの不透明度

// --- 描画用定数（仕様12章 RD_VERTICES / RD_FACES。格子単位・セル中心原点） ---

/** 菱形十二面体の14頂点（格子単位）。0..5=軸方向(4価), 6..13=立方体型(3価)。 */
const RD_VERTICES: readonly Cell[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5],
  [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5],
];

/** 12枚のひし形面（RD_VERTICES への index 四角形）。各々2三角形に分割して描く。 */
const RD_FACES: readonly [number, number, number, number][] = [
  [0, 6, 2, 7], [0, 8, 3, 9], [0, 6, 4, 8], [0, 7, 5, 9],
  [1, 10, 2, 11], [1, 12, 3, 13], [1, 10, 4, 12], [1, 11, 5, 13],
  [2, 6, 4, 10], [2, 7, 5, 11], [3, 8, 4, 12], [3, 9, 5, 13],
];

// --- ジオメトリ生成 ---

/**
 * 等値面メッシュ（格子座標）をワールド変換した BufferGeometry を作る。
 * 各頂点を worldPos(·,S) で写し、computeVertexNormals で陰影用法線を付ける。
 */
function buildTerrainGeometry(
  mesh: { positions: Float32Array; indices: Uint32Array },
  S: number,
): THREE.BufferGeometry {
  const src = mesh.positions;
  const pos = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const w = worldPos(src[i], src[i + 1], src[i + 2], S);
    pos[i] = w.x;
    pos[i + 1] = w.y;
    pos[i + 2] = w.z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  g.computeVertexNormals();
  return g;
}

/**
 * 占有セル1個ぶんの菱形十二面体ジオメトリ（中心原点・ワールド空間・S倍）。
 * 12四角形を各2三角形へ分割し、面ごとに頂点を複製（非インデックス）して
 * computeVertexNormals がフラット法線を出すようにする（多面体らしい陰影）。
 */
function buildRhombicDodecahedron(S: number): THREE.BufferGeometry {
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

// --- コンポーネント ---

/**
 * 地形の2系統表示。store の terrain / params.S / occluderSet を読み、
 * 表示トグルは store.toggles を購読して切替える（leva 登録は Controls.tsx に一本化）。
 *
 * 依存する store フィールド:
 *   `terrain`, `params.S`, `occluderSet`,
 *   `toggles.showTerrainMesh`(既定false), `toggles.showOccluderCells`(既定true)。
 * 再生成: ボリュームは terrain/S 変更時のみ、RD インスタンスは occluderSet/S 変更時のみ。
 */
export function TerrainView() {
  const terrain = useStore((s) => s.terrain);
  const S = useStore((s) => s.params.S);
  const occluderSet = useStore((s) => s.occluderSet);
  const showTerrainMesh = useStore((s) => s.toggles.showTerrainMesh);
  const showOccluderCells = useStore((s) => s.toggles.showOccluderCells);

  // ボリューム等値面: terrain / S にのみ依存。
  const terrainGeom = useMemo(
    () => buildTerrainGeometry(terrain.mesh(TERRAIN_RES), S),
    [terrain, S],
  );
  useEffect(() => () => terrainGeom.dispose(), [terrainGeom]);

  // RD テンプレート: S にのみ依存（全セル共通の1ジオメトリ）。
  const rdGeom = useMemo(() => buildRhombicDodecahedron(S), [S]);
  useEffect(() => () => rdGeom.dispose(), [rdGeom]);

  // 占有セル中心のワールド座標: occluderSet / S にのみ依存。
  const centers = useMemo(
    () => [...occluderSet].map((k) => {
      const c = keyToCell(k);
      return worldPos(c[0], c[1], c[2], S);
    }),
    [occluderSet, S],
  );

  const instRef = useRef<THREE.InstancedMesh>(null);
  // 依存に showOccluderCells を含めるのが要点。トグル off→on で instancedMesh は
  // 作り直され instRef が新インスタンスを指すが、centers 参照は不変なので
  // 「centers だけ」依存だと再設定が走らず、全インスタンスが単位行列（原点重なり＝
  // 原点付近の1セルに見える）のまま残る。トグルを依存に入れて再マウント時に必ず
  // 行列を貼り直す。
  useLayoutEffect(() => {
    const m = instRef.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    centers.forEach((p, i) => {
      mat.makeTranslation(p.x, p.y, p.z);
      m.setMatrixAt(i, mat);
    });
    m.count = centers.length;
    m.instanceMatrix.needsUpdate = true;
    // バウンディング球を全インスタンス込みで再計算しないと、視点回転時に
    // フラスタムカリングで胞塗りが丸ごと消える（既定の球は原点1セルぶんしかない）。
    m.computeBoundingSphere();
  }, [centers, showOccluderCells]);

  return (
    <group>
      {showTerrainMesh && (
        <mesh geometry={terrainGeom}>
          <meshStandardMaterial
            color="#8a8170"
            roughness={0.95}
            metalness={0.0}
            transparent={TERRAIN_OPACITY < 1}
            opacity={TERRAIN_OPACITY}
            side={THREE.DoubleSide}
            flatShading={false}
          />
        </mesh>
      )}

      {showOccluderCells && centers.length > 0 && (
        // args の count を centers.length にすると、occluder 数の変化で R3F が
        // インスタンスメッシュを作り直す（matrix は useLayoutEffect で都度再設定）。
        // frustumCulled=false で、念のためカリングによる消失を二重に防ぐ。
        <instancedMesh
          ref={instRef}
          args={[undefined, undefined, centers.length]}
          frustumCulled={false}
        >
          <primitive object={rdGeom} attach="geometry" />
          <meshStandardMaterial
            color="#d9534f"
            roughness={0.6}
            metalness={0.0}
            transparent
            opacity={CELL_OPACITY}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </instancedMesh>
      )}
    </group>
  );
}
