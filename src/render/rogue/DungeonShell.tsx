// 洞窟の壁描画(rogue-1)。「発見済みの空洞セルに接する、空洞でない or 未発見のセル」を
// 岩としてメッシュ化する。RD は空間充填なので壁面は厳密に閉じ、未発見の空洞は壁のまま・
// 発見と同時に開く(discoveredRev で全再構築。差分更新は先送り)。
//
// ジオメトリはブロックのインスタンス描画ではなく「露出面だけをマージした単一メッシュ」。
// 隣も岩セルなら間の面を出さない。理由(目視フィードバック第2回):
//   - 隣接ブロック同士の共有面は「Aの表面」と「Bの裏面」が同一平面に重なり、
//     切断時に Z ファイト(市松模様のちらつき)を起こしていた。マージで重複自体を消す。
//   - rd.ts の RD_FACES は面ごとに巻き方向が不揃いで、裏返った面が黒く欠けて見えていた。
//     ここでは各面の法線を「セル→隣」方向と照合して巻きを統一する。
// 結果として岩塊の境界は水密な閉曲面になり、裏面パス(無陰影の土色)が
// 「切断で露出した岩の内部」を常に正しく塗る。
//
// カットアウェイ: 毎フレーム「視線に直交し、注視点より CUT_OFFSET 視点寄り」の平面を
// 更新し clippingPlanes に渡す。オフセットは隣接セルの壁面(中心から ~0.71 格子 =
// √2S/2 ≈ 1.41)より内側の 0.5S にする。これより大きいと、壁際に立つプレイヤーを
// 壁越しに見たとき背後の壁が切れずに視界を塞ぐ。
//
// 断面はステンシルキャップで塞ぐ(目視フィードバック第3回)。裏面パスだけの近似では、
// 「平面の手前側で壁の厚みを視線が丸ごと通過する」箇所は表も裏も両方クリップされて
// 背景が透けていた(=穴あき。メッシュ自体は有向辺対の検査で水密・巻き整合を確認済み)。
// three.js 公式 clipping_stencil の手法: 切断立体の裏面で stencil を+1、表面で-1 すると
// 「切り口が見えているピクセル」だけ stencil≠0 になる。そこへ切断平面上の大きな板を
// stencil テスト付きで描けば、断面がちょうど土色で塗り潰される(水密メッシュが前提)。

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OFFSETS, keyToCell, layer, worldPos, type Cell, type CellKey } from '../../model/fcc';
import { useRogue, ROGUE_S } from '../../state/rogue';
import { view } from '../../state/view';
import { RD_FACES, RD_VERTICES } from '../rd';
import { currentFocusGrid } from './rogueFocus';

const ROCK_SHALLOW = new THREE.Color('#7a6a55');
const ROCK_DEEP = new THREE.Color('#3a3452');
/** 切断面(岩の内部)の土色。 */
const CUT_COLOR = '#5c422e';
/** カット平面の注視点からのオフセット(視点寄り)。隣接セルの壁面(√2S/2)より内側に。 */
const CUT_OFFSET = 0.5 * ROGUE_S;
/** キャップ板の一辺(視錐台と平面の交差を覆う大きさ。遠方は霧に溶ける)。 */
const CAP_SIZE = 200 * ROGUE_S;

// 全シェルマテリアルで共有するクリッピング平面(毎フレーム更新)。
const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);

const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** セル座標の決定的ハッシュ(0..1)。岩肌の色むらに使う。 */
function hash01(c: Cell): number {
  let h = (c[0] * 73856093) ^ (c[1] * 19349663) ^ (c[2] * 83492791);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/**
 * オフセット方向 → 巻きを統一した RD 面(格子単位の4頂点、外向き)。
 * RD_FACES から面中心 = offset/2 で対応を取り、ワールド空間の法線が
 * offset 方向を向くよう必要なら巻きを反転する(worldPos は向きを反転する
 * 等長変換 det=-1 なので、格子空間の見た目では判定しない)。
 */
const ORIENTED_FACES: { off: Cell; verts: [Cell, Cell, Cell, Cell] }[] = OFFSETS.map((off) => {
  const face = RD_FACES.find((f) => {
    const cx = (RD_VERTICES[f[0]][0] + RD_VERTICES[f[1]][0] + RD_VERTICES[f[2]][0] + RD_VERTICES[f[3]][0]) / 4;
    const cy = (RD_VERTICES[f[0]][1] + RD_VERTICES[f[1]][1] + RD_VERTICES[f[2]][1] + RD_VERTICES[f[3]][1]) / 4;
    const cz = (RD_VERTICES[f[0]][2] + RD_VERTICES[f[1]][2] + RD_VERTICES[f[2]][2] + RD_VERTICES[f[3]][2]) / 4;
    return Math.abs(cx * 2 - off[0]) < 1e-9 && Math.abs(cy * 2 - off[1]) < 1e-9 && Math.abs(cz * 2 - off[2]) < 1e-9;
  })!;
  let verts = face.map((i) => RD_VERTICES[i]) as [Cell, Cell, Cell, Cell];
  const a = worldPos(verts[0][0], verts[0][1], verts[0][2], 1);
  const b = worldPos(verts[1][0], verts[1][1], verts[1][2], 1);
  const c = worldPos(verts[2][0], verts[2][1], verts[2][2], 1);
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const n = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  };
  const ow = worldPos(off[0], off[1], off[2], 1);
  if (n.x * ow.x + n.y * ow.y + n.z * ow.z < 0) {
    verts = [verts[0], verts[3], verts[2], verts[1]];
  }
  return { off, verts };
});

/** 露出面だけの水密メッシュを構築(位置+頂点色、フラット法線)。 */
function buildShellGeometry(shellSet: Set<CellKey>, S: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const c3 = new THREE.Color();
  for (const k of shellSet) {
    const c = keyToCell(k);
    const t = Math.min(1, Math.max(0, -layer(c) / 26));
    c3.copy(ROCK_SHALLOW).lerp(ROCK_DEEP, t);
    c3.multiplyScalar(0.82 + 0.36 * hash01(c));
    for (const { off, verts } of ORIENTED_FACES) {
      // 隣も描画対象の岩なら共有面は完全に隠れる(かつ Z ファイトの元)ので出さない。
      if (shellSet.has(`${c[0] + off[0]},${c[1] + off[1]},${c[2] + off[2]}`)) continue;
      const w = verts.map((v) => worldPos(c[0] + v[0], c[1] + v[1], c[2] + v[2], S));
      for (const i of [0, 1, 2, 0, 2, 3]) {
        pos.push(w[i].x, w[i].y, w[i].z);
        col.push(c3.r, c3.g, c3.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals(); // 非インデックスなので面フラット法線になる
  return g;
}

export function DungeonShell() {
  const discoveredRev = useRogue((s) => s.discoveredRev);
  const gl = useThree((s) => s.gl);

  // マテリアル単位のクリッピングはレンダラ側の許可が要る。
  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);

  // ステンシルバッファの実在確認。無い環境ではステンシルテストが「常に合格」になり
  // キャップ板が全画面を塗り潰してしまう(WebGL 仕様)ため、キャップを無効化して
  // 裏面塗りのみに退避する。App の Canvas は gl={{ stencil: true }} を要求しているが、
  // コンテキスト属性は生成時にしか効かない(HMR で開きっぱなしのタブは古いまま)。
  const hasStencil = useMemo(() => {
    const attrs = gl.getContext().getContextAttributes?.();
    const ok = !!attrs?.stencil;
    if (!ok) {
      console.warn(
        'WebGL コンテキストに stencil バッファがありません。断面キャップを無効化します。' +
          'ページを再読み込み(ハードリロード)すると有効になります。',
      );
    }
    return ok;
  }, [gl]);

  const geom = useMemo(() => {
    const { dungeon, discovered } = useRogue.getState();
    const shell = new Set<CellKey>();
    for (const k of discovered) {
      const c = keyToCell(k);
      for (const o of OFFSETS) {
        const nk = `${c[0] + o[0]},${c[1] + o[1]},${c[2] + o[2]}`;
        if (!dungeon.open.has(nk) || !discovered.has(nk)) shell.add(nk);
      }
    }
    return buildShellGeometry(shell, ROGUE_S);
    // discoveredRev が唯一の変更検知キー(dungeon/discovered は in-place 更新)。
  }, [discoveredRev]);
  useEffect(() => () => geom.dispose(), [geom]);

  // カット平面の更新: 法線=視線方向、通過点=注視点から視点側へ CUT_OFFSET 戻した点。
  // 「平面よりカメラ側」(n·p + c < 0)が描画されない。キャップ板は平面に一致させ、
  // 共面 Z ファイトを避けて僅かにカメラ側へ寄せる。
  const capRef = useRef<THREE.Mesh>(null);
  const tmpP = useRef(new THREE.Vector3());
  const tmpN = useRef(new THREE.Vector3());
  useFrame(({ camera }) => {
    const free = useRogue.getState().freeCam;
    const g = free && view.base ? view.base : currentFocusGrid();
    const w = worldPos(g[0], g[1], g[2], ROGUE_S);
    const p = tmpP.current.set(w.x, w.y, w.z);
    const n = tmpN.current.copy(p).sub(camera.position).normalize();
    p.addScaledVector(n, -CUT_OFFSET);
    cutPlane.setFromNormalAndCoplanarPoint(n, p);
    const cap = capRef.current;
    if (cap) {
      cap.position.copy(p).addScaledVector(n, -0.02 * ROGUE_S);
      cap.quaternion.setFromUnitVectors(Z_AXIS, n);
    }
  });

  return (
    <group>
      {/* 表面: 通常の岩肌(カメラ側はクリップ) */}
      <mesh frustumCulled={false}>
        <primitive object={geom} attach="geometry" />
        <meshStandardMaterial
          vertexColors
          roughness={0.95}
          metalness={0.02}
          flatShading
          clippingPlanes={[cutPlane]}
        />
      </mesh>
      {/* 裏面: 切断で露出した岩の内部の土色(キャップの背後の保険。stencil 不可環境の退路) */}
      <mesh frustumCulled={false}>
        <primitive object={geom} attach="geometry" />
        <meshBasicMaterial color={CUT_COLOR} side={THREE.BackSide} clippingPlanes={[cutPlane]} />
      </mesh>
      {/* ステンシル計数: 切断立体の裏面 +1 / 表面 -1(色・深度は書かない) */}
      {hasStencil && (
      <mesh frustumCulled={false} renderOrder={1}>
        <primitive object={geom} attach="geometry" />
        <meshBasicMaterial
          colorWrite={false}
          depthWrite={false}
          depthTest={false}
          side={THREE.BackSide}
          clippingPlanes={[cutPlane]}
          stencilWrite
          stencilFunc={THREE.AlwaysStencilFunc}
          stencilFail={THREE.IncrementWrapStencilOp}
          stencilZFail={THREE.IncrementWrapStencilOp}
          stencilZPass={THREE.IncrementWrapStencilOp}
        />
      </mesh>
      )}
      {hasStencil && (
      <mesh frustumCulled={false} renderOrder={1}>
        <primitive object={geom} attach="geometry" />
        <meshBasicMaterial
          colorWrite={false}
          depthWrite={false}
          depthTest={false}
          side={THREE.FrontSide}
          clippingPlanes={[cutPlane]}
          stencilWrite
          stencilFunc={THREE.AlwaysStencilFunc}
          stencilFail={THREE.DecrementWrapStencilOp}
          stencilZFail={THREE.DecrementWrapStencilOp}
          stencilZPass={THREE.DecrementWrapStencilOp}
        />
      </mesh>
      )}
      {/* キャップ: stencil≠0 のピクセル(=切り口)だけ土色の板が残る */}
      {hasStencil && (
      <mesh ref={capRef} frustumCulled={false} renderOrder={2}>
        <planeGeometry args={[CAP_SIZE, CAP_SIZE]} />
        <meshBasicMaterial
          color={CUT_COLOR}
          side={THREE.DoubleSide}
          stencilWrite
          stencilRef={0}
          stencilFunc={THREE.NotEqualStencilFunc}
          stencilFail={THREE.ReplaceStencilOp}
          stencilZFail={THREE.ReplaceStencilOp}
          stencilZPass={THREE.ReplaceStencilOp}
        />
      </mesh>
      )}
    </group>
  );
}
