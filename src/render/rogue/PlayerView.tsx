// プレイヤーの描画(rogue)。小さな冒険者の造形 + 追従するたいまつ(ポイントライト)。
// 位置は unitAnim の補間(PLAYER_ID)を毎フレーム読む。
// rogue-5: たいまつを「揺らめく火」にした。光量のフリッカー(周期の違う正弦の重ね)、
// 炎コーンの伸縮、加算グロースプライトのにじみ。ブルームと合わせて主役の光源にする。

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { worldPos } from '../../model/fcc';
import { useRogue, ROGUE_S, PLAYER_ID } from '../../state/rogue';
import { currentUnitGrid } from '../../state/unitAnim';
import { glowTexture } from './glowTexture';

const S = ROGUE_S;

/** 周期の違う正弦を重ねた 0.8〜1.2 程度の揺らぎ。 */
function flicker(t: number): number {
  return 1 + 0.13 * Math.sin(t * 11) + 0.07 * Math.sin(t * 23 + 1.7) + 0.05 * Math.sin(t * 5.3 + 0.6);
}

export function PlayerView() {
  const pos = useRogue((s) => s.player.pos);
  const alive = useRogue((s) => s.phase === 'play');
  const mapMode = useRogue((s) => s.mapMode);
  const lightLevel = useRogue((s) => s.lightLevel);
  const ref = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const flameRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Sprite>(null);
  const glowMap = useMemo(() => glowTexture(), []);
  // 明かりの段階でたいまつの届く距離と強さを変える(ゲームルールの視界と揃える)。
  const lightDist = [7, 11, 15][lightLevel] * S;
  const lightInt = [2.2, 3.2, 4.4][lightLevel];

  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const gp = currentUnitGrid(PLAYER_ID, pos);
    const w = worldPos(gp[0], gp[1], gp[2], S);
    const t = clock.elapsedTime;
    g.position.set(w.x, w.y + 0.03 * S * Math.sin(t * 2.2), w.z);
    const fl = flicker(t);
    if (lightRef.current) lightRef.current.intensity = lightInt * fl;
    if (flameRef.current) {
      flameRef.current.scale.set(0.8 + 0.25 * fl, 0.7 + 0.45 * fl, 0.8 + 0.25 * fl);
      flameRef.current.rotation.y = t * 1.7;
    }
    if (glowRef.current) {
      const s = (0.9 + 0.35 * fl) * S * (0.8 + 0.25 * lightLevel);
      glowRef.current.scale.set(s, s, 1);
    }
  });

  return (
    <group ref={ref}>
      {/* たいまつの明かり(探索の可視域とゲーム内の「発見」を感覚的に一致させる) */}
      <pointLight
        ref={lightRef}
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
      {/* たいまつ(柄 + 揺れる炎 + にじむグロー) */}
      <mesh position={[0.22 * S, 0.34 * S, 0]}>
        <cylinderGeometry args={[0.022 * S, 0.028 * S, 0.3 * S, 6]} />
        <meshStandardMaterial color="#6b4a2b" roughness={0.9} />
      </mesh>
      <mesh ref={flameRef} position={[0.22 * S, 0.55 * S, 0]}>
        <coneGeometry args={[0.07 * S, 0.2 * S, 8]} />
        <meshStandardMaterial color="#ffe3a1" emissive="#ff8a2d" emissiveIntensity={3.4} />
      </mesh>
      <sprite ref={glowRef} position={[0.22 * S, 0.55 * S, 0]}>
        <spriteMaterial
          map={glowMap}
          color="#ff9a3d"
          transparent
          opacity={0.5}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
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
