// 領域表示（F2 / it-2 / 仕様8章 2・3・5）。
// 自機・到達セル・（showThreat 時の）脅威セルを、セル塗り（showRegionCells）と
// 菱形十二面体の稜線（showRegionEdges）で併置表示する（両方 on 可）。
//
// 色は用途で分ける: 自機=金 / 到達(安全)=寒色 / 到達(脅威圏内)=暖色 / 非到達の脅威=淡暖色。
// セル塗りは RD を InstancedMesh で（Terrain.tsx と同方式）、稜線は RD_EDGES の24辺を
// 全対象セルぶん1つの LineSegments にまとめて頂点カラーで色分けする（対象は小さいので都度再構築）。

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { worldPos, keyToCell, cellKey, type Cell, type CellKey } from '../model/fcc';
import { useStore } from '../state/store';
import { RD_EDGES, RD_VERTICES, buildRhombicDodecahedron } from './rd';

const GOLD = new THREE.Color('#fde047'); // 自機
const COOL = new THREE.Color('#38bdf8'); // 到達(安全)
const WARM = new THREE.Color('#fb923c'); // 到達(脅威圏内)
const WARM_DIM = new THREE.Color('#f87171'); // 非到達の脅威

interface RegionCell {
  cell: Cell;
  color: THREE.Color;
}

/** 表示対象セル＋用途色を導出する（active / reachableSet / threatSet から）。 */
function useRegion(): RegionCell[] {
  const reachableSet = useStore((s) => s.reachableSet);
  const threatSet = useStore((s) => s.threatSet);
  const active = useStore((s) => s.active);
  const showThreat = useStore((s) => s.toggles.showThreat);

  return useMemo(() => {
    const map = new Map<CellKey, THREE.Color>();
    map.set(cellKey(active), GOLD); // 自機が最優先
    for (const k of reachableSet) {
      if (k === cellKey(active)) continue;
      map.set(k, showThreat && threatSet.has(k) ? WARM : COOL);
    }
    if (showThreat) {
      for (const k of threatSet) {
        if (!map.has(k)) map.set(k, WARM_DIM); // 非到達・非自機の脅威セル
      }
    }
    return [...map.entries()].map(([k, color]) => ({ cell: keyToCell(k), color }));
  }, [reachableSet, threatSet, active, showThreat]);
}

/** 対象セルを RD の半透明塗りで表示（InstancedMesh + per-instance color）。 */
function RegionCells({ region, S }: { region: RegionCell[]; S: number }) {
  const rd = useMemo(() => buildRhombicDodecahedron(S), [S]);
  useEffect(() => () => rd.dispose(), [rd]);

  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    region.forEach((r, i) => {
      const w = worldPos(r.cell[0], r.cell[1], r.cell[2], S);
      mat.makeTranslation(w.x, w.y, w.z);
      m.setMatrixAt(i, mat);
      m.setColorAt(i, r.color);
    });
    m.count = region.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere(); // インスタンス行列込みの境界球（カリング対策）
  }, [region, S]);

  if (region.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, region.length]} frustumCulled={false}>
      <primitive object={rd} attach="geometry" />
      <meshStandardMaterial
        transparent
        opacity={0.22}
        depthWrite={false}
        side={THREE.DoubleSide}
        roughness={0.6}
        metalness={0.0}
      />
    </instancedMesh>
  );
}

/** 対象セルの RD 稜線（24辺）を1つの LineSegments にまとめ、頂点カラーで色分け。 */
function RegionEdges({ region, S }: { region: RegionCell[]; S: number }) {
  const geom = useMemo(() => {
    const pos: number[] = [];
    const col: number[] = [];
    for (const r of region) {
      for (const [a, b] of RD_EDGES) {
        const va = RD_VERTICES[a];
        const vb = RD_VERTICES[b];
        const wa = worldPos(r.cell[0] + va[0], r.cell[1] + va[1], r.cell[2] + va[2], S);
        const wb = worldPos(r.cell[0] + vb[0], r.cell[1] + vb[1], r.cell[2] + vb[2], S);
        pos.push(wa.x, wa.y, wa.z, wb.x, wb.y, wb.z);
        col.push(r.color.r, r.color.g, r.color.b, r.color.r, r.color.g, r.color.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [region, S]);
  useEffect(() => () => geom.dispose(), [geom]);

  if (region.length === 0) return null;
  return (
    <lineSegments frustumCulled={false}>
      <primitive object={geom} attach="geometry" />
      <lineBasicMaterial vertexColors />
    </lineSegments>
  );
}

export function Region() {
  const region = useRegion();
  const S = useStore((s) => s.params.S);
  const showCells = useStore((s) => s.toggles.showRegionCells);
  const showEdges = useStore((s) => s.toggles.showRegionEdges);

  return (
    <>
      {showCells && <RegionCells region={region} S={S} />}
      {showEdges && <RegionEdges region={region} S={S} />}
    </>
  );
}
