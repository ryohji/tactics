// 戦闘エフェクト（it-6）。game.fx のイベント列を消費して描く。
//   bolt     : 射撃/魔法の投射体（光球が from→to へ飛ぶ）
//   slash    : 近接の白い斬撃リング
//   hit      : 命中の橙フラッシュ
//   miss     : 空振りの灰リング
//   heal     : 緑の上昇リング
//   levitate : 紫の上昇リング
//   death    : 暗紫の消滅球
//   popup    : ダメージ数字/MISS の DOM ポップアップ（CSS アニメ）
// 各エフェクトは自分の進行度 t=(now-start)/dur を useFrame で読み、終了後は不可視になる。
// fx 配列そのものの掃除は game 側（pushFx 時）に任せる。

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { worldPos, type Cell } from '../model/fcc';
import { useStore } from '../state/store';
import { useGame, type FxEvent } from '../state/game';

function toWorld(c: Cell, S: number): THREE.Vector3 {
  const w = worldPos(c[0], c[1], c[2], S);
  return new THREE.Vector3(w.x, w.y, w.z);
}

function progress(fx: FxEvent): number {
  return Math.min(1, Math.max(0, (performance.now() - fx.start) / fx.dur));
}

/** 投射体。 */
function Bolt({ fx, S }: { fx: FxEvent; S: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const from = toWorld(fx.from!, S);
  const to = toWorld(fx.to!, S);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const t = progress(fx);
    m.visible = t < 1;
    m.position.lerpVectors(from, to, t);
  });
  const color = fx.magic ? '#c084fc' : '#fbbf24';
  return (
    <mesh ref={ref} frustumCulled={false}>
      <sphereGeometry args={[0.14 * S, 8, 8]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.2} />
    </mesh>
  );
}

/** 拡がって消えるリング（slash/hit/miss/heal/levitate 共通）。rise で上昇。 */
function Ring({
  fx,
  S,
  color,
  maxR,
  rise = 0,
}: {
  fx: FxEvent;
  S: number;
  color: string;
  maxR: number;
  rise?: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const at = toWorld(fx.at!, S);
  useFrame(({ camera }) => {
    const m = ref.current;
    if (!m) return;
    const t = progress(fx);
    m.visible = t < 1;
    m.position.set(at.x, at.y + rise * t * S, at.z);
    m.quaternion.copy(camera.quaternion); // 常にカメラへ正対
    const r = (0.2 + t * maxR) * S;
    m.scale.setScalar(r);
    if (matRef.current) matRef.current.opacity = 0.9 * (1 - t);
  });
  return (
    <mesh ref={ref} frustumCulled={false}>
      <torusGeometry args={[1, 0.12, 8, 28]} />
      <meshBasicMaterial ref={matRef} color={color} transparent depthWrite={false} />
    </mesh>
  );
}

/** 命中フラッシュ（膨らんで薄れる光球）。 */
function Flash({ fx, S, color }: { fx: FxEvent; S: number; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const at = toWorld(fx.at!, S);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const t = progress(fx);
    m.visible = t < 1;
    m.position.copy(at);
    m.scale.setScalar((0.25 + t * 0.6) * S);
    if (matRef.current) matRef.current.opacity = 0.85 * (1 - t);
  });
  return (
    <mesh ref={ref} frustumCulled={false}>
      <sphereGeometry args={[1, 10, 10]} />
      <meshBasicMaterial ref={matRef} color={color} transparent depthWrite={false} />
    </mesh>
  );
}

/** 消滅（縮んで暗くなる球）。 */
function Death({ fx, S }: { fx: FxEvent; S: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const at = toWorld(fx.at!, S);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const t = progress(fx);
    m.visible = t < 1;
    m.position.set(at.x, at.y + 0.2 * t * S, at.z);
    m.scale.setScalar(Math.max(0.001, (1 - t) * 0.5) * S);
    if (matRef.current) matRef.current.opacity = 0.8 * (1 - t);
  });
  return (
    <mesh ref={ref} frustumCulled={false}>
      <sphereGeometry args={[1, 10, 10]} />
      <meshBasicMaterial ref={matRef} color="#6b21a8" transparent depthWrite={false} />
    </mesh>
  );
}

/** ダメージ数字/回復/MISS の DOM ポップアップ。CSS（hud.css .fx-popup）が浮上+フェード。 */
function Popup({ fx, S }: { fx: FxEvent; S: number }) {
  const at = toWorld(fx.at!, S);
  return (
    <Html position={[at.x, at.y + 0.9 * S, at.z]} center zIndexRange={[100, 0]}>
      <div className="fx-popup" style={{ color: fx.color ?? '#fff' }}>
        {fx.text}
      </div>
    </Html>
  );
}

function FxItem({ fx, S }: { fx: FxEvent; S: number }) {
  switch (fx.kind) {
    case 'bolt':
      return <Bolt fx={fx} S={S} />;
    case 'slash':
      return <Ring fx={fx} S={S} color="#f8fafc" maxR={0.7} />;
    case 'hit':
      return <Flash fx={fx} S={S} color="#fb923c" />;
    case 'miss':
      return <Ring fx={fx} S={S} color="#94a3b8" maxR={0.5} rise={0.3} />;
    case 'heal':
      return <Ring fx={fx} S={S} color="#4ade80" maxR={0.6} rise={0.8} />;
    case 'levitate':
      return <Ring fx={fx} S={S} color="#c084fc" maxR={0.6} rise={1.0} />;
    case 'death':
      return <Death fx={fx} S={S} />;
    case 'popup':
      return <Popup fx={fx} S={S} />;
  }
}

export function Effects() {
  const fx = useGame((s) => s.fx);
  const S = useStore((s) => s.params.S);
  return (
    <>
      {fx.map((e) => (
        <FxItem key={e.id} fx={e} S={S} />
      ))}
    </>
  );
}
