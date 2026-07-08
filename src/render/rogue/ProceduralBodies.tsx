// プロシージャル造形(rogue-13)。glTF の無い種の本体+読み込み中のフォールバック。
// どれも「まどろみ=ゆっくり」「警戒=速く大きく」。位相は id でずらして群れの同期を防ぐ。

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BEASTS } from '../../model/beasts';
import { ROGUE_S, type Beast } from '../../state/rogue';

const S = ROGUE_S;

/** 洞穴コウモリ: 翼の羽ばたき。 */
function BatBody({ b }: { b: Beast }) {
  const def = BEASTS.bat;
  const wL = useRef<THREE.Mesh>(null);
  const wR = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const a = 0.45 * Math.sin(clock.elapsedTime * (b.awake ? 10 : 3.5) + b.id);
    if (wL.current) wL.current.rotation.z = -0.5 + a;
    if (wR.current) wR.current.rotation.z = 0.5 - a;
  });
  return (
    <>
      <mesh position={[0, 0.3 * S, 0]}>
        <sphereGeometry args={[0.14 * S, 10, 10]} />
        <meshStandardMaterial color={def.color} roughness={0.7} />
      </mesh>
      <mesh ref={wL} position={[0.16 * S, 0.32 * S, 0]} rotation={[0, 0, -0.5]}>
        <coneGeometry args={[0.1 * S, 0.26 * S, 4]} />
        <meshStandardMaterial color={def.color} roughness={0.8} />
      </mesh>
      <mesh ref={wR} position={[-0.16 * S, 0.32 * S, 0]} rotation={[0, 0, 0.5]}>
        <coneGeometry args={[0.1 * S, 0.26 * S, 4]} />
        <meshStandardMaterial color={def.color} roughness={0.8} />
      </mesh>
    </>
  );
}

/** 岩グモ: 6本脚+腹の脈動。警戒でせわしなく足踏み。 */
function SpiderBody({ b }: { b: Beast }) {
  const def = BEASTS.spider;
  const body = useRef<THREE.Mesh>(null);
  const legs = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const sp = b.awake ? 9 : 2.2;
    if (body.current) body.current.position.y = (0.12 + 0.015 * Math.sin(t * sp + b.id)) * S;
    if (legs.current) legs.current.rotation.y = 0.08 * Math.sin(t * sp * 0.7 + b.id);
  });
  return (
    <>
      <mesh ref={body} position={[0, 0.12 * S, 0]} scale={[1.3, 0.6, 1.3]}>
        <sphereGeometry args={[0.18 * S, 10, 10]} />
        <meshStandardMaterial color={def.color} roughness={0.85} />
      </mesh>
      <group ref={legs}>
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          return (
            <mesh
              key={i}
              position={[Math.cos(a) * 0.2 * S, 0.08 * S, Math.sin(a) * 0.2 * S]}
              rotation={[Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9]}
            >
              <cylinderGeometry args={[0.012 * S, 0.02 * S, 0.24 * S, 4]} />
              <meshStandardMaterial color={def.color} roughness={0.9} />
            </mesh>
          );
        })}
      </group>
    </>
  );
}

/** グール: 前屈みの揺れ+だらりと下がった腕の振り。 */
function GhoulBody({ b }: { b: Beast }) {
  const def = BEASTS.ghoul;
  const g = useRef<THREE.Group>(null);
  const aL = useRef<THREE.Mesh>(null);
  const aR = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const sp = b.awake ? 3.2 : 1.1;
    if (g.current) {
      g.current.rotation.z = 0.06 * Math.sin(t * sp + b.id);
      g.current.rotation.x = 0.12 + 0.04 * Math.sin(t * sp * 0.6 + b.id);
    }
    const sw = 0.25 * Math.sin(t * sp + b.id + 1.3);
    if (aL.current) aL.current.rotation.x = sw;
    if (aR.current) aR.current.rotation.x = -sw;
  });
  return (
    <group ref={g}>
      <mesh position={[0, 0.22 * S, 0]}>
        <capsuleGeometry args={[0.15 * S, 0.34 * S, 4, 10]} />
        <meshStandardMaterial color={def.color} roughness={0.9} />
      </mesh>
      <mesh ref={aL} position={[0.17 * S, 0.26 * S, 0.02 * S]} rotation={[0.2, 0, 0]}>
        <capsuleGeometry args={[0.04 * S, 0.22 * S, 3, 6]} />
        <meshStandardMaterial color={def.color} roughness={0.9} />
      </mesh>
      <mesh ref={aR} position={[-0.17 * S, 0.26 * S, 0.02 * S]} rotation={[0.2, 0, 0]}>
        <capsuleGeometry args={[0.04 * S, 0.22 * S, 3, 6]} />
        <meshStandardMaterial color={def.color} roughness={0.9} />
      </mesh>
    </group>
  );
}

/** 鬼火: 発光の脈動+呼吸するスケール。 */
function WispBody({ b }: { b: Beast }) {
  const def = BEASTS.wisp;
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const sp = b.awake ? 5.5 : 1.6;
    const p = 0.5 + 0.5 * Math.sin(t * sp + b.id);
    if (mat.current) mat.current.emissiveIntensity = 1.5 + 1.6 * p;
    if (mesh.current) mesh.current.scale.setScalar(0.92 + 0.16 * p);
  });
  return (
    <mesh ref={mesh} position={[0, 0.32 * S, 0]}>
      <sphereGeometry args={[0.15 * S, 12, 12]} />
      <meshStandardMaterial
        ref={mat}
        color={def.color}
        emissive={def.color}
        emissiveIntensity={2.2}
        transparent
        opacity={0.85}
      />
    </mesh>
  );
}

/** 兵隊蟻: 大顎の開閉+触角の揺れ。警戒でカチカチと速く。 */
function SoldierBody({ b }: { b: Beast }) {
  const def = BEASTS.soldier;
  const jL = useRef<THREE.Mesh>(null);
  const jR = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const open = b.awake ? 0.25 + 0.22 * Math.abs(Math.sin(t * 6 + b.id)) : 0.12 + 0.05 * Math.sin(t * 1.5 + b.id);
    if (jL.current) jL.current.rotation.y = -open;
    if (jR.current) jR.current.rotation.y = open;
  });
  return (
    <>
      <mesh position={[0, 0.16 * S, -0.12 * S]} scale={[1, 0.8, 1.3]}>
        <sphereGeometry args={[0.16 * S, 10, 10]} />
        <meshStandardMaterial color={def.color} roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.2 * S, 0.16 * S]}>
        <sphereGeometry args={[0.12 * S, 10, 10]} />
        <meshStandardMaterial color={def.color} roughness={0.7} />
      </mesh>
      <mesh ref={jL} position={[0.07 * S, 0.18 * S, 0.28 * S]} rotation={[0.4, 0, 0]}>
        <coneGeometry args={[0.03 * S, 0.14 * S, 4]} />
        <meshStandardMaterial color="#3a2418" roughness={0.6} />
      </mesh>
      <mesh ref={jR} position={[-0.07 * S, 0.18 * S, 0.28 * S]} rotation={[0.4, 0, 0]}>
        <coneGeometry args={[0.03 * S, 0.14 * S, 4]} />
        <meshStandardMaterial color="#3a2418" roughness={0.6} />
      </mesh>
    </>
  );
}

/** 深淵の影: ゆっくり回りながら形が揺らぎ、不定形にちらつく。 */
function ShadeBody({ b }: { b: Beast }) {
  const def = BEASTS.shade;
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const sp = b.awake ? 2.2 : 0.7;
    if (mesh.current) {
      mesh.current.rotation.y = t * sp;
      mesh.current.scale.set(
        1 + 0.12 * Math.sin(t * 3.1 + b.id),
        1 + 0.08 * Math.sin(t * 2.3 + b.id * 2),
        1 + 0.12 * Math.cos(t * 2.7 + b.id),
      );
    }
    if (mat.current) mat.current.opacity = 0.55 + 0.2 * Math.sin(t * 4.3 + b.id);
  });
  return (
    <mesh ref={mesh} position={[0, 0.28 * S, 0]}>
      <coneGeometry args={[0.2 * S, 0.55 * S, 8]} />
      <meshStandardMaterial
        ref={mat}
        color={def.color}
        emissive={def.color}
        emissiveIntensity={0.9}
        transparent
        opacity={0.7}
        depthWrite={false}
      />
    </mesh>
  );
}

/** 地竜: 呼吸で膨らむ胴+首の振り+尻尾の揺れ。 */
function DrakeBody({ b }: { b: Beast }) {
  const def = BEASTS.drake;
  const body = useRef<THREE.Mesh>(null);
  const head = useRef<THREE.Mesh>(null);
  const tail = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const sp = b.awake ? 3.5 : 1.2;
    const br = 1 + 0.05 * Math.sin(t * sp * 0.8 + b.id);
    if (body.current) body.current.scale.set(br, 0.8 * br, 1.5);
    if (head.current) head.current.rotation.z = 0.15 * Math.sin(t * sp * 0.5 + b.id);
    if (tail.current) tail.current.rotation.y = 0.35 * Math.sin(t * sp + b.id + 2);
  });
  return (
    <>
      <mesh ref={body} position={[0, 0.2 * S, 0]} scale={[1, 0.8, 1.5]}>
        <sphereGeometry args={[0.24 * S, 10, 10]} />
        <meshStandardMaterial color={def.color} roughness={0.7} />
      </mesh>
      <mesh ref={head} position={[0, 0.42 * S, 0.28 * S]}>
        <coneGeometry args={[0.1 * S, 0.24 * S, 6]} />
        <meshStandardMaterial color={def.color} roughness={0.7} />
      </mesh>
      <mesh ref={tail} position={[0, 0.18 * S, -0.42 * S]} rotation={[Math.PI / 2.2, 0, 0]}>
        <coneGeometry args={[0.06 * S, 0.3 * S, 5]} />
        <meshStandardMaterial color={def.color} roughness={0.75} />
      </mesh>
    </>
  );
}

/** 岩窟の巨人: 重い胴の捻りと頭石の傾ぎ(鈍い周期)。 */
function ColossusBody({ b }: { b: Beast }) {
  const def = BEASTS.colossus;
  const torso = useRef<THREE.Mesh>(null);
  const head = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const sp = b.awake ? 1.6 : 0.5;
    if (torso.current) torso.current.rotation.y = 0.1 * Math.sin(t * sp + b.id);
    if (head.current) head.current.rotation.z = 0.08 * Math.sin(t * sp * 0.7 + b.id + 1);
  });
  return (
    <>
      <mesh ref={torso} position={[0, 0.28 * S, 0]} scale={[1.2, 1, 1]}>
        <dodecahedronGeometry args={[0.3 * S, 0]} />
        <meshStandardMaterial color={def.color} roughness={0.95} flatShading />
      </mesh>
      <mesh ref={head} position={[0, 0.62 * S, 0]}>
        <dodecahedronGeometry args={[0.15 * S, 0]} />
        <meshStandardMaterial color={def.color} roughness={0.95} flatShading />
      </mesh>
    </>
  );
}

/** 種族→本体コンポーネントの分岐(glTF の無い種+読み込み中のフォールバック)。 */
export function ProceduralBody({ b }: { b: Beast }) {
  switch (b.kind) {
    case 'bat':
      return <BatBody b={b} />;
    case 'spider':
      return <SpiderBody b={b} />;
    case 'ghoul':
      return <GhoulBody b={b} />;
    case 'wisp':
      return <WispBody b={b} />;
    case 'soldier':
      return <SoldierBody b={b} />;
    case 'shade':
      return <ShadeBody b={b} />;
    case 'drake':
      return <DrakeBody b={b} />;
    case 'colossus':
      return <ColossusBody b={b} />;
  }
}
