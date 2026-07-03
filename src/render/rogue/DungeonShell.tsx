// 洞窟の壁描画(rogue-1)。「発見済みの空洞セルに接する、空洞でない or 未発見のセル」を
// 岩ブロック(RD)としてインスタンス描画する。RD は空間充填なので壁面は厳密に閉じ、
// 未発見の空洞は壁のまま・発見と同時に開く(discoveredRev で全再構築。差分更新は先送り)。
// 色は深さで暖色の岩 → 冷たい深部へ遷移し、セルごとのハッシュで僅かに揺らす。
//
// カットアウェイ(QAフィードバック対応):
// 壁セルに阻まれて広間の形状が見えない問題への対処。毎フレーム「視線に直交し、
// 注視点(プレイヤー/視点モードの旋回中心)より少し視点寄り」の平面を更新し、
// これよりカメラ側の壁をクリッピングで消す。あわせて同じインスタンス群を
// 「裏面のみ・無陰影の茶色」でもう1パス描く。RD ブロックは閉メッシュなので、
// 表が切り取られた部分では内側の裏面=茶色が見え、「岩の断面(見えない部分)」を示す
// (ステンシルキャップの安価な近似)。

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OFFSETS, keyToCell, layer, worldPos, type Cell, type CellKey } from '../../model/fcc';
import { useRogue, ROGUE_S } from '../../state/rogue';
import { view } from '../../state/view';
import { buildRhombicDodecahedron } from '../rd';
import { currentFocusGrid } from './rogueFocus';

const ROCK_SHALLOW = new THREE.Color('#7a6a55');
const ROCK_DEEP = new THREE.Color('#3a3452');
/** 切断面(ブロック内側)の土色。 */
const CUT_COLOR = '#5c422e';
/** カット平面の注視点からのオフセット(視点寄り)。プレイヤーと足元は残す。 */
const CUT_OFFSET = 2.5 * ROGUE_S;

// 全シェルマテリアルで共有するクリッピング平面(毎フレーム更新)。
const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);

/** セル座標の決定的ハッシュ(0..1)。岩肌の色むらに使う。 */
function hash01(c: Cell): number {
  let h = (c[0] * 73856093) ^ (c[1] * 19349663) ^ (c[2] * 83492791);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

export function DungeonShell() {
  const discoveredRev = useRogue((s) => s.discoveredRev);
  const gl = useThree((s) => s.gl);

  // マテリアル単位のクリッピングはレンダラ側の許可が要る。
  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);

  const shell = useMemo(() => {
    const { dungeon, discovered } = useRogue.getState();
    const out = new Set<CellKey>();
    for (const k of discovered) {
      const c = keyToCell(k);
      for (const o of OFFSETS) {
        const n: Cell = [c[0] + o[0], c[1] + o[1], c[2] + o[2]];
        const nk = `${n[0]},${n[1]},${n[2]}`;
        if (!dungeon.open.has(nk) || !discovered.has(nk)) out.add(nk);
      }
    }
    return [...out].map(keyToCell);
    // discoveredRev が唯一の変更検知キー(dungeon/discovered は in-place 更新)。
  }, [discoveredRev]);

  const geom = useMemo(() => buildRhombicDodecahedron(ROGUE_S), []);

  const frontRef = useRef<THREE.InstancedMesh>(null);
  const backRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mat = new THREE.Matrix4();
    const col = new THREE.Color();
    for (const m of [frontRef.current, backRef.current]) {
      if (!m) continue;
      shell.forEach((c, i) => {
        const w = worldPos(c[0], c[1], c[2], ROGUE_S);
        mat.makeTranslation(w.x, w.y, w.z);
        m.setMatrixAt(i, mat);
      });
      m.count = shell.length;
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
    const m = frontRef.current;
    if (m) {
      shell.forEach((c, i) => {
        const t = Math.min(1, Math.max(0, -layer(c) / 26));
        col.copy(ROCK_SHALLOW).lerp(ROCK_DEEP, t);
        col.multiplyScalar(0.82 + 0.36 * hash01(c));
        m.setColorAt(i, col);
      });
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }, [shell]);

  // カット平面の更新: 法線=視線方向、通過点=注視点から視点側へ CUT_OFFSET 戻した点。
  // 「平面よりカメラ側」(n·p + c < 0)が描画されない。
  const target = useRef(new THREE.Vector3());
  const nrm = useRef(new THREE.Vector3());
  useFrame(({ camera }) => {
    const free = useRogue.getState().freeCam;
    const g = free && view.base ? view.base : currentFocusGrid();
    const w = worldPos(g[0], g[1], g[2], ROGUE_S);
    target.current.set(w.x, w.y, w.z);
    nrm.current.copy(target.current).sub(camera.position).normalize();
    target.current.addScaledVector(nrm.current, -CUT_OFFSET);
    cutPlane.setFromNormalAndCoplanarPoint(nrm.current, target.current);
  });

  if (shell.length === 0) return null;
  return (
    <group>
      {/* 表面: 通常の岩肌(カメラ側はクリップ) */}
      <instancedMesh
        key={`f${shell.length}`}
        ref={frontRef}
        args={[undefined, undefined, shell.length]}
        frustumCulled={false}
      >
        <primitive object={geom} attach="geometry" />
        <meshStandardMaterial
          roughness={0.95}
          metalness={0.02}
          flatShading
          clippingPlanes={[cutPlane]}
        />
      </instancedMesh>
      {/* 裏面: 切断で露出したブロック内側を土色で塗る(断面の示唆) */}
      <instancedMesh
        key={`b${shell.length}`}
        ref={backRef}
        args={[undefined, undefined, shell.length]}
        frustumCulled={false}
      >
        <primitive object={geom} attach="geometry" />
        <meshBasicMaterial color={CUT_COLOR} side={THREE.BackSide} clippingPlanes={[cutPlane]} />
      </instancedMesh>
    </group>
  );
}
