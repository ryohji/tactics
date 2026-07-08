// 落ちているアイテムの描画(rogue)。発見済みセルのみ。踏むと拾う(クリック不要)。
// 種別で形と色を変え、ゆっくり回転+浮遊して「拾える物」だと分かるようにする。

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { cellKey, worldPos } from '../model/fcc';
import { ITEMS } from '../model/loot';
import { useRogue, ROGUE_S, type GroundItem } from '../state/rogue';

const S = ROGUE_S;

function ItemMesh({ g }: { g: GroundItem }) {
  const ref = useRef<THREE.Group>(null);
  const def = ITEMS[g.stack.item];
  const w = worldPos(g.pos[0], g.pos[1], g.pos[2], S);

  useFrame(({ clock }) => {
    const gr = ref.current;
    if (!gr) return;
    gr.rotation.y = clock.elapsedTime * 1.2 + g.id;
    gr.position.y = w.y + (0.15 + 0.05 * Math.sin(clock.elapsedTime * 2 + g.id)) * S;
  });

  let shape: React.ReactNode;
  switch (def.kind) {
    case 'weapon':
      shape = (
        <mesh rotation={[0, 0, Math.PI]}>
          <coneGeometry args={[0.09 * S, 0.34 * S, 6]} />
          <meshStandardMaterial color="#eab308" emissive="#a16207" emissiveIntensity={0.5} metalness={0.6} roughness={0.3} />
        </mesh>
      );
      break;
    case 'armor':
      shape = (
        <mesh>
          <boxGeometry args={[0.2 * S, 0.22 * S, 0.14 * S]} />
          <meshStandardMaterial color="#94a3b8" emissive="#475569" emissiveIntensity={0.4} metalness={0.7} roughness={0.35} />
        </mesh>
      );
      break;
    case 'potion':
      shape = (
        <mesh>
          <sphereGeometry args={[0.11 * S, 10, 10]} />
          <meshStandardMaterial color="#f87171" emissive="#dc2626" emissiveIntensity={0.9} transparent opacity={0.9} />
        </mesh>
      );
      break;
    case 'trap':
      shape = (
        <mesh rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.13 * S, 0.18 * S, 5]} />
          <meshStandardMaterial color="#b45309" emissive="#92400e" emissiveIntensity={0.6} roughness={0.6} />
        </mesh>
      );
      break;
    case 'turret':
      shape = (
        <mesh>
          <cylinderGeometry args={[0.09 * S, 0.12 * S, 0.22 * S, 8]} />
          <meshStandardMaterial color="#7dd3fc" emissive="#38bdf8" emissiveIntensity={0.7} metalness={0.6} roughness={0.4} />
        </mesh>
      );
      break;
    case 'decoy':
      shape = (
        <mesh>
          <capsuleGeometry args={[0.08 * S, 0.16 * S, 4, 8]} />
          <meshStandardMaterial color="#c9b37a" emissive="#8a7a52" emissiveIntensity={0.5} roughness={0.9} />
        </mesh>
      );
      break;
    default: // thrown
      shape = (
        <mesh>
          <tetrahedronGeometry args={[0.12 * S]} />
          <meshStandardMaterial color="#e2e8f0" emissive="#94a3b8" emissiveIntensity={0.5} metalness={0.8} roughness={0.3} />
        </mesh>
      );
  }

  return (
    <group ref={ref} position={[w.x, w.y, w.z]}>
      {shape}
    </group>
  );
}

export function LootView() {
  const items = useRogue((s) => s.items);
  const discoveredRev = useRogue((s) => s.discoveredRev);
  void discoveredRev;
  const discovered = useRogue.getState().discovered;
  return (
    <>
      {items
        .filter((i) => discovered.has(cellKey(i.pos)))
        .map((i) => (
          <ItemMesh key={i.id} g={i} />
        ))}
    </>
  );
}
