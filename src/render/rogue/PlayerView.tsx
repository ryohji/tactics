// プレイヤーの描画(rogue)。位置は unitAnim の補間(PLAYER_ID)を毎フレーム読む。
// rogue-13: KayKit Adventurers の Knight(CC0, kaylousberg.com)を glTF で導入。
//   - アニメ状態機械: 死亡 > 攻撃/投擲(playerPose) > 歩行(isUnitMoving) > 待機
//   - 進行方向へ滑らかに旋回。たいまつは左手ボーンへポータルで装着
//   - 読み込み中(Suspense)は従来のプロシージャル体がフォールバック
// たいまつの主光源はゲームの視界ルールと揃えるため、手ではなくグループ固定。
// 揺らめき(光量フリッカー・グロー)は rogue-5 のまま。

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { createPortal, useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { worldPos } from '../../model/fcc';
import { useRogue, ROGUE_S, PLAYER_ID } from '../../state/rogue';
import { currentUnitGrid, isUnitMoving } from '../../state/unitAnim';
import { currentPose } from '../../state/playerPose';
import { glowTexture } from './glowTexture';

const S = ROGUE_S;
const MODEL_URL = `${import.meta.env.BASE_URL}models/Knight.glb`;
// 既定で全て表示されている装備バリアントのうち、使わないものを隠す。
const HIDE_PARTS = /Offhand|Shield|2H_Sword/i;
// ポーズ → アニメクリップ名(KayKit 共通リグ)。
const CLIP: Record<string, string> = {
  idle: 'Idle',
  walk: 'Walking_A',
  attack: '1H_Melee_Attack_Slice_Diagonal',
  throw: 'Throw',
  dead: 'Death_A',
};

useGLTF.preload(MODEL_URL);

/** 周期の違う正弦を重ねた 0.8〜1.2 程度の揺らぎ。 */
function flicker(t: number): number {
  return 1 + 0.13 * Math.sin(t * 11) + 0.07 * Math.sin(t * 23 + 1.7) + 0.05 * Math.sin(t * 5.3 + 0.6);
}

/** 左手に持つたいまつ(ボーンへポータルするのでボーン座標系)。 */
function TorchInHand({ flameRef }: { flameRef: React.RefObject<THREE.Mesh> }) {
  const glowMap = useMemo(() => glowTexture(), []);
  return (
    <group rotation={[0, 0, 0.2]}>
      <mesh position={[0, 0.14, 0]}>
        <cylinderGeometry args={[0.025, 0.032, 0.34, 6]} />
        <meshStandardMaterial color="#6b4a2b" roughness={0.9} />
      </mesh>
      <mesh ref={flameRef} position={[0, 0.38, 0]}>
        <coneGeometry args={[0.08, 0.22, 8]} />
        <meshStandardMaterial color="#ffe3a1" emissive="#ff8a2d" emissiveIntensity={3.4} />
      </mesh>
      <sprite position={[0, 0.38, 0]} scale={[0.6, 0.6, 1]}>
        <spriteMaterial
          map={glowMap}
          color="#ff9a3d"
          transparent
          opacity={0.5}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
    </group>
  );
}

/** glTF の騎士(読み込み後)。 */
function KnightModel({ alive }: { alive: boolean }) {
  const { scene, animations } = useGLTF(MODEL_URL);
  const group = useRef<THREE.Group>(null);
  const { actions } = useAnimations(animations, group);
  const flameRef = useRef<THREE.Mesh>(null!);
  const cur = useRef('');

  // 使わない装備バリアントを隠す(glb は全部乗せで出荷されている)。
  useEffect(() => {
    scene.traverse((o) => {
      if (HIDE_PARTS.test(o.name)) o.visible = false;
    });
  }, [scene]);

  // 身長をセル寸法に合わせる(モデルは ~2m 級)。
  const scale = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const h = box.max.y - box.min.y;
    return (0.95 * S) / (h > 0.1 ? h : 1.9);
  }, [scene]);

  const hand = useMemo(() => scene.getObjectByName('handslot.l') ?? null, [scene]);

  useFrame(({ clock }) => {
    // 状態機械: 死亡 > 一時ポーズ(攻撃/投擲) > 歩行 > 待機。
    const pose = currentPose();
    const want = !alive
      ? CLIP.dead
      : pose
        ? CLIP[pose]
        : isUnitMoving(PLAYER_ID)
          ? CLIP.walk
          : CLIP.idle;
    if (want !== cur.current) {
      const next = actions[want];
      if (next) {
        actions[cur.current]?.fadeOut(0.15);
        next.reset();
        if (want === CLIP.dead) {
          next.setLoop(THREE.LoopOnce, 1);
          next.clampWhenFinished = true;
        }
        next.fadeIn(0.15).play();
        cur.current = want;
      }
    }
    // 炎の伸縮(手の中のたいまつ)。
    const fl = flicker(clock.elapsedTime);
    if (flameRef.current) {
      flameRef.current.scale.set(0.8 + 0.25 * fl, 0.7 + 0.45 * fl, 0.8 + 0.25 * fl);
      flameRef.current.rotation.y = clock.elapsedTime * 1.7;
    }
  });

  return (
    <group ref={group}>
      <primitive object={scene} scale={scale} position={[0, -0.48 * S, 0]} />
      {hand && createPortal(<TorchInHand flameRef={flameRef} />, hand)}
    </group>
  );
}

/** 読み込み中・失敗時のフォールバック(従来のプロシージャル体)。 */
function CapsuleBody({ alive }: { alive: boolean }) {
  return (
    <>
      <mesh position={[0, 0.05 * S, 0]}>
        <capsuleGeometry args={[0.16 * S, 0.3 * S, 4, 10]} />
        <meshStandardMaterial color={alive ? '#4f83e8' : '#475569'} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.42 * S, 0]}>
        <sphereGeometry args={[0.13 * S, 12, 12]} />
        <meshStandardMaterial color="#e8c39e" roughness={0.7} />
      </mesh>
    </>
  );
}

export function PlayerView() {
  const pos = useRogue((s) => s.player.pos);
  const alive = useRogue((s) => s.phase === 'play');
  const mapMode = useRogue((s) => s.mapMode);
  const lightLevel = useRogue((s) => s.lightLevel);
  const ref = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const glowRef = useRef<THREE.Sprite>(null);
  const lastPos = useRef(new THREE.Vector3());
  const yaw = useRef(0);
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
    g.position.set(w.x, w.y, w.z);
    // 進行方向へ旋回(短弧補間。停止中は最後の向きを保つ)。
    const dx = w.x - lastPos.current.x;
    const dz = w.z - lastPos.current.z;
    if (dx * dx + dz * dz > 1e-6) {
      const target = Math.atan2(dx, dz);
      let d = target - yaw.current;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw.current += d * 0.25;
    }
    lastPos.current.set(w.x, w.y, w.z);
    if (bodyRef.current) bodyRef.current.rotation.y = yaw.current;
    const fl = flicker(t);
    if (lightRef.current) lightRef.current.intensity = lightInt * fl;
    if (glowRef.current) {
      const s = (0.9 + 0.35 * fl) * S * (0.8 + 0.25 * lightLevel);
      glowRef.current.scale.set(s, s, 1);
    }
  });

  return (
    <group ref={ref}>
      {/* たいまつの明かり(探索の可視域とゲーム内の「発見」を感覚的に一致させる)。
          手の位置でなくグループ固定 — 光源が揺れると視界の読みが濁るため。 */}
      <pointLight
        ref={lightRef}
        color="#ffb469"
        intensity={lightInt}
        distance={lightDist}
        decay={1.4}
        position={[0, 0.5 * S, 0]}
      />
      <sprite ref={glowRef} position={[0, 0.55 * S, 0]}>
        <spriteMaterial
          map={glowMap}
          color="#ff9a3d"
          transparent
          opacity={0.35}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <group ref={bodyRef}>
        <Suspense fallback={<CapsuleBody alive={alive} />}>
          <KnightModel alive={alive} />
        </Suspense>
      </group>
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
