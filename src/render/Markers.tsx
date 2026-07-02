// 格子点マーカー描画（W5 / 仕様8章 1・2・5 / DESIGN §7）。it-4 壮大スケール対応。
//
// 役割:
//   - クリック場: active の「到達セル」（=12近傍の通行可能先）だけを1つの InstancedMesh の
//     小球で描く。これがクリック→移動の対象。到達は十数個なのでレイキャストも軽い。
//     色分け: 到達(安全)=寒色 / 到達(脅威圏内)=暖色。
//   - 自機マーカー: 金の球を activeAnim の補間値で滑らかに動かす（F1。離散 active とは分離）。
//   - 敵マーカー: store.enemies を自機と区別できる赤い八面体で表示。
//
// it-4 で「全通行可能セルの小球」描画は廃止した（数万セルで破綻・視覚的にもソバ状）。
// 飛行モデルでは室内外の空気がほぼ全部通行可能になるため、空きセルは出さない。
// 空間把握の補助となる地形 occluder の胞塗りと領域表示（Region.tsx）が空間を読ませる。
//
// 領域のセル塗り/稜線（自機・到達・脅威）は Region.tsx が別途オーバーレイする。
// 再計算は store 変化時のみ（毎フレームではない）。位置は worldPos(cell,S)。

import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { worldPos, keyToCell, cellKey, type Cell } from '../model/fcc';
import { useStore } from '../state/store';
import { setMarkerCells, pickInstance } from '../input/pick';
import { currentActiveGrid } from './activeAnim';

// 色（material.color(白)×instanceColor）。
const C_REACH = new THREE.Color('#38bdf8'); // 寒色: 到達(安全)
const C_REACH_THREAT = new THREE.Color('#fb923c'); // 暖色: 到達(脅威圏内)

// 球半径（ワールド単位。S 比例でアリーナ表示倍率へ追従）。
const R_REACH = 0.24;
const R_SELF = 0.3;
const R_ENEMY = 0.34;

/** active の到達セル（クリック対象）だけを小球で描く。 */
function Field() {
  const reachableSet = useStore((s) => s.reachableSet);
  const threatSet = useStore((s) => s.threatSet);
  const active = useStore((s) => s.active);
  const S = useStore((s) => s.params.S);
  const showThreat = useStore((s) => s.toggles.showThreat);

  // クリック対象 = 到達セル（自機セルは除く。そこへは移動不要）。並びが instanceId になる。
  const cells = useMemo(() => {
    const akey = cellKey(active);
    const out: Cell[] = [];
    for (const k of reachableSet) {
      if (k === akey) continue;
      out.push(keyToCell(k));
    }
    return out;
  }, [reachableSet, active]);

  const instRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    setMarkerCells(cells); // count=0（到達なし）でもレジストリは空に同期
    const m = instRef.current;
    if (!m) return;

    const mat = new THREE.Matrix4();
    const quat = new THREE.Quaternion(); // 無回転
    const scl = new THREE.Vector3();
    const pos = new THREE.Vector3();

    cells.forEach((c, i) => {
      const k = cellKey(c);
      const w = worldPos(c[0], c[1], c[2], S);
      const thr = showThreat && threatSet.has(k);

      pos.set(w.x, w.y, w.z);
      scl.setScalar(R_REACH * S);
      mat.compose(pos, quat, scl);
      m.setMatrixAt(i, mat);
      m.setColorAt(i, thr ? C_REACH_THREAT : C_REACH);
    });

    m.count = cells.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere(); // B2: インスタンス行列込みの境界球（回転で消えるのを防ぐ）
  }, [cells, threatSet, S, showThreat]);

  if (cells.length === 0) return null;
  // onClick のみ（hover 系ハンドラは付けない）。pointermove 毎のレイキャストを誘発させない。
  return (
    <instancedMesh
      ref={instRef}
      args={[undefined, undefined, cells.length]}
      frustumCulled={false}
      onClick={(e) => {
        e.stopPropagation();
        pickInstance(e.instanceId);
      }}
    >
      <sphereGeometry args={[1, 10, 10]} />
      <meshStandardMaterial roughness={0.45} metalness={0.0} />
    </instancedMesh>
  );
}

/** 自機マーカー（金）。activeAnim の補間値で毎フレーム位置を更新（F1）。 */
function SelfMarker() {
  const S = useStore((s) => s.params.S);
  const firstPerson = useStore((s) => s.toggles.firstPerson);
  const ref = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const g = currentActiveGrid();
    const w = worldPos(g[0], g[1], g[2], S);
    m.position.set(w.x, w.y, w.z);
    m.scale.setScalar(R_SELF * S);
  });

  // FP は視点が自機位置にあるため自機マーカーを隠す（仕様9.2）。
  if (firstPerson) return null;
  return (
    <mesh ref={ref} frustumCulled={false}>
      <sphereGeometry args={[1, 16, 16]} />
      <meshStandardMaterial color="#fde047" emissive="#6b5200" emissiveIntensity={0.45} roughness={0.4} />
    </mesh>
  );
}

/** 敵マーカー（赤い八面体）。自機（球）と区別する。it-2 は移動しない。 */
function Enemies() {
  const enemies = useStore((s) => s.enemies);
  const S = useStore((s) => s.params.S);
  return (
    <>
      {enemies.map((e, i) => {
        const w = worldPos(e[0], e[1], e[2], S);
        const r = R_ENEMY * S;
        return (
          <mesh key={i} position={[w.x, w.y, w.z]} scale={[r, r, r]} frustumCulled={false}>
            <octahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color="#dc2626" emissive="#3b0a0a" emissiveIntensity={0.35} roughness={0.4} />
          </mesh>
        );
      })}
    </>
  );
}

export function Markers() {
  return (
    <group>
      <Field />
      <SelfMarker />
      <Enemies />
    </group>
  );
}
