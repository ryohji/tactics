// 戦闘エフェクト(rogue)。tactics の Effects.tsx の縮約版で、useRogue.fx を消費する。
//   bolt  : 投げナイフの投射体
//   hit   : 命中の橙フラッシュ
//   heal  : 緑の上昇リング
//   death : 消滅球
//   popup : ダメージ数字/拾得名の DOM ポップアップ(hud.css .fx-popup)

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { worldPos, type Cell } from '../model/fcc';
import { useRogue, ROGUE_S, type RogueFx } from '../state/rogue';

const S = ROGUE_S;

function toWorld(c: Cell): THREE.Vector3 {
  const w = worldPos(c[0], c[1], c[2], S);
  return new THREE.Vector3(w.x, w.y, w.z);
}

function progress(fx: RogueFx): number {
  return Math.min(1, Math.max(0, (performance.now() - fx.start) / fx.dur));
}

function Bolt({ fx }: { fx: RogueFx }) {
  const ref = useRef<THREE.Mesh>(null);
  const from = toWorld(fx.from!);
  const to = toWorld(fx.to!);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const t = progress(fx);
    m.visible = t < 1;
    m.position.lerpVectors(from, to, t);
  });
  return (
    <mesh ref={ref} frustumCulled={false}>
      <sphereGeometry args={[0.1 * S, 8, 8]} />
      <meshStandardMaterial color="#e2e8f0" emissive="#cbd5e1" emissiveIntensity={2} />
    </mesh>
  );
}

function Flash({ fx }: { fx: RogueFx }) {
  const ref = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const at = toWorld(fx.at!);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const t = progress(fx);
    m.visible = t < 1;
    m.position.set(at.x, at.y + 0.3 * S, at.z);
    m.scale.setScalar((0.25 + t * 0.6) * S);
    if (matRef.current) matRef.current.opacity = 0.85 * (1 - t);
  });
  return (
    <mesh ref={ref} frustumCulled={false}>
      <sphereGeometry args={[1, 10, 10]} />
      <meshBasicMaterial ref={matRef} color="#fb923c" transparent depthWrite={false} />
    </mesh>
  );
}

function Ring({ fx, color, rise }: { fx: RogueFx; color: string; rise: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const at = toWorld(fx.at!);
  useFrame(({ camera }) => {
    const m = ref.current;
    if (!m) return;
    const t = progress(fx);
    m.visible = t < 1;
    m.position.set(at.x, at.y + rise * t * S, at.z);
    m.quaternion.copy(camera.quaternion);
    m.scale.setScalar((0.2 + t * 0.6) * S);
    if (matRef.current) matRef.current.opacity = 0.9 * (1 - t);
  });
  return (
    <mesh ref={ref} frustumCulled={false}>
      <torusGeometry args={[1, 0.12, 8, 28]} />
      <meshBasicMaterial ref={matRef} color={color} transparent depthWrite={false} />
    </mesh>
  );
}

function Death({ fx }: { fx: RogueFx }) {
  const ref = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const at = toWorld(fx.at!);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const t = progress(fx);
    m.visible = t < 1;
    m.position.set(at.x, at.y + (0.3 + 0.2 * t) * S, at.z);
    m.scale.setScalar(Math.max(0.001, (1 - t) * 0.4) * S);
    if (matRef.current) matRef.current.opacity = 0.8 * (1 - t);
  });
  return (
    <mesh ref={ref} frustumCulled={false}>
      <sphereGeometry args={[1, 10, 10]} />
      <meshBasicMaterial ref={matRef} color="#6b21a8" transparent depthWrite={false} />
    </mesh>
  );
}

function Popup({ fx }: { fx: RogueFx }) {
  const at = toWorld(fx.at!);
  return (
    <Html position={[at.x, at.y + 0.8 * S, at.z]} center zIndexRange={[6, 0]}>
      <div className="fx-popup" style={{ color: fx.color ?? '#fff' }}>
        {fx.text}
      </div>
    </Html>
  );
}

function FxItem({ fx }: { fx: RogueFx }) {
  switch (fx.kind) {
    case 'bolt':
      return <Bolt fx={fx} />;
    case 'hit':
      return <Flash fx={fx} />;
    case 'heal':
      return <Ring fx={fx} color="#4ade80" rise={0.8} />;
    case 'death':
      return <Death fx={fx} />;
    case 'popup':
      return <Popup fx={fx} />;
  }
}

export function RogueEffects() {
  const fx = useRogue((s) => s.fx);
  return (
    <>
      {fx.map((e) => (
        <FxItem key={e.id} fx={e} />
      ))}
    </>
  );
}
