// プレイヤーの描画(rogue)。小さな冒険者の造形 + 追従するたいまつ(ポイントライト)。
// 位置は unitAnim の補間(PLAYER_ID)を毎フレーム読む。

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { worldPos } from '../../model/fcc';
import { useRogue, ROGUE_S, PLAYER_ID } from '../../state/rogue';
import { currentUnitGrid } from '../../state/unitAnim';

const S = ROGUE_S;

export function PlayerView() {
  const pos = useRogue((s) => s.player.pos);
  const alive = useRogue((s) => s.phase === 'play');
  const mapMode = useRogue((s) => s.mapMode);
  const lightLevel = useRogue((s) => s.lightLevel);
  const ref = useRef<THREE.Group>(null);
  // 明かりの段階でたいまつの届く距離と強さを変える(ゲームルールの視界と揃える)。
  const lightDist = [7, 11, 15][lightLevel] * S;
  const lightInt = [2.2, 3.2, 4.4][lightLevel];

  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const gp = currentUnitGrid(PLAYER_ID, pos);
    const w = worldPos(gp[0], gp[1], gp[2], S);
    g.position.set(w.x, w.y + 0.03 * S * Math.sin(clock.elapsedTime * 2.2), w.z);
  });

  return (
    <group ref={ref}>
      {/* たいまつの明かり(探索の可視域とゲーム内の「発見」を感覚的に一致させる) */}
      <pointLight
        color="#ffb469"
        intensity={lightInt}
        distance={lightDist}
        decay={1.4}
        position={[0, 0.5 * S, 0]}
      />
      {/* 体 */}
      <mesh position={[0, 0.05 * S, 0]}>
        <capsuleGeometry args={[0.16 * S, 0.3 * S, 4, 10]} />
        <meshStandardMaterial color={alive ? '#4f83e8' : '#475569'} roughness={0.6} />
      </mesh>
      {/* 頭 */}
      <mesh position={[0, 0.42 * S, 0]}>
        <sphereGeometry args={[0.13 * S, 12, 12]} />
        <meshStandardMaterial color="#e8c39e" roughness={0.7} />
      </mesh>
      {/* たいまつの火 */}
      <mesh position={[0.22 * S, 0.5 * S, 0]}>
        <sphereGeometry args={[0.06 * S, 8, 8]} />
        <meshStandardMaterial color="#ffcf6e" emissive="#ff9a3d" emissiveIntensity={3} />
      </mesh>
      {/* マップモードの標識ビーコン(遠目でも現在地が分かる光柱) */}
      {mapMode && (
        <mesh position={[0, 3.2 * S, 0]}>
          <cylinderGeometry args={[0.08 * S, 0.16 * S, 6 * S, 8]} />
          <meshBasicMaterial color="#7ce7ff" transparent opacity={0.7} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
