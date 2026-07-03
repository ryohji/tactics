// シーン合成（it-6）。Canvas 内のすべてをここに集約する:
// 空気感（背景・霧・星） + ライト + 地形 + 対象フィールド + ユニット + エフェクト + カメラ。
// 旧プロトタイプの Markers / Region は撤去し、ゲーム用の TargetField / Units / Effects に置換。

import { Stars } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../state/store';
import { TerrainView } from './Terrain';
import { HexFloor } from './HexFloor';
import { TargetField } from './TargetField';
import { Units } from './Units';
import { Effects } from './Effects';
import { CameraRig } from './CameraRig';

/** 足元の大地（アリーナ底 L=Lmin の面。暗い円盤で空間の基準を作る）。 */
function GroundDisc() {
  const S = useStore((s) => s.params.S);
  const Hmax = useStore((s) => s.params.Hmax);
  // ヘックスタイル(HexFloor, セル中心-0.42S)との z-fight を避けて少し下げる。
  return (
    <mesh position={[0, -0.7 * S, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[Hmax * S * 1.8, 48]} />
      <meshStandardMaterial color="#181528" roughness={1} metalness={0} />
    </mesh>
  );
}

export function Scene() {
  const S = useStore((s) => s.params.S);
  const Hmax = useStore((s) => s.params.Hmax);
  const worldR = Hmax * S;

  return (
    <>
      {/* 黄昏の空気感: 深紫の背景 + 距離霧 + 星空 */}
      <color attach="background" args={['#141126']} />
      <fog attach="fog" args={[new THREE.Color('#141126'), worldR * 1.6, worldR * 6]} />
      <Stars radius={worldR * 5} depth={worldR} count={2400} factor={4} saturation={0.4} fade speed={0.4} />

      <ambientLight intensity={0.55} color="#cdc8ff" />
      <directionalLight position={[18, 30, 12]} intensity={1.0} color="#ffe0b8" />
      <directionalLight position={[-14, 8, -10]} intensity={0.35} color="#8ea2ff" />

      <GroundDisc />
      <HexFloor />
      <TerrainView />
      <TargetField />
      <Units />
      <Effects />
      <CameraRig />
    </>
  );
}
