// 設置物の描画(rogue-4)。罠(種別ごとの色の棘付き円盤)・魔導砲塔(砲身つき塔)・
// 囮人形(藁色のプレイヤー風)。すべて自分が置いたものなので常時見える。

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { worldPos } from '../../model/fcc';
import { useRogue, ROGUE_S, type PlacedTrap, type Turret, type Decoy } from '../../state/rogue';
import type { TrapKind } from '../../model/loot';

const S = ROGUE_S;

const TRAP_COLOR: Record<TrapKind, string> = {
  spike: '#cbd5e1',
  fire: '#fb923c',
  confuse: '#f472b6',
  fear: '#a78bfa',
  sleep: '#60a5fa',
};

function TrapMesh({ t }: { t: PlacedTrap }) {
  const w = worldPos(t.pos[0], t.pos[1], t.pos[2], S);
  const color = TRAP_COLOR[t.kind];
  return (
    <group position={[w.x, w.y - 0.3 * S, w.z]}>
      <mesh>
        <cylinderGeometry args={[0.32 * S, 0.36 * S, 0.06 * S, 6]} />
        <meshStandardMaterial color="#3f3a33" roughness={0.9} />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={i}
          position={[0.18 * S * Math.cos((i * Math.PI) / 2), 0.1 * S, 0.18 * S * Math.sin((i * Math.PI) / 2)]}
        >
          <coneGeometry args={[0.05 * S, 0.16 * S, 4]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function TurretMesh({ t }: { t: Turret }) {
  const ref = useRef<THREE.Group>(null);
  const w = worldPos(t.pos[0], t.pos[1], t.pos[2], S);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.elapsedTime * 0.8;
  });
  return (
    <group position={[w.x, w.y - 0.2 * S, w.z]}>
      <mesh>
        <cylinderGeometry args={[0.2 * S, 0.26 * S, 0.34 * S, 8]} />
        <meshStandardMaterial color="#64748b" metalness={0.6} roughness={0.4} />
      </mesh>
      <group ref={ref} position={[0, 0.28 * S, 0]}>
        <mesh position={[0.14 * S, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <cylinderGeometry args={[0.05 * S, 0.05 * S, 0.3 * S, 8]} />
          <meshStandardMaterial color="#475569" metalness={0.7} roughness={0.3} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.12 * S, 8, 8]} />
          <meshStandardMaterial color="#7dd3fc" emissive="#38bdf8" emissiveIntensity={1.4} />
        </mesh>
      </group>
    </group>
  );
}

function DecoyMesh({ d }: { d: Decoy }) {
  const damaged = d.hp / d.maxHp;
  return (
    <group position={[worldPos(d.pos[0], d.pos[1], d.pos[2], S).x, worldPos(d.pos[0], d.pos[1], d.pos[2], S).y, worldPos(d.pos[0], d.pos[1], d.pos[2], S).z]}>
      <mesh position={[0, 0.05 * S, 0]} rotation={[0, 0.6, 0.08]}>
        <capsuleGeometry args={[0.15 * S, 0.28 * S, 4, 10]} />
        <meshStandardMaterial color="#c9b37a" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.4 * S, 0]}>
        <sphereGeometry args={[0.12 * S, 10, 10]} />
        <meshStandardMaterial color="#d6c391" roughness={0.95} />
      </mesh>
      {/* 耐久が減ると傾く */}
      {damaged < 0.5 && (
        <mesh position={[0.1 * S, 0.2 * S, 0]} rotation={[0, 0, -0.6]}>
          <boxGeometry args={[0.04 * S, 0.3 * S, 0.04 * S]} />
          <meshStandardMaterial color="#8a7a52" roughness={1} />
        </mesh>
      )}
    </group>
  );
}

export function DevicesView() {
  const traps = useRogue((s) => s.traps);
  const turrets = useRogue((s) => s.turrets);
  const decoys = useRogue((s) => s.decoys);
  return (
    <>
      {traps.map((t) => (
        <TrapMesh key={`t${t.id}`} t={t} />
      ))}
      {turrets.map((t) => (
        <TurretMesh key={`u${t.id}`} t={t} />
      ))}
      {decoys.map((d) => (
        <DecoyMesh key={`d${d.id}`} d={d} />
      ))}
    </>
  );
}
