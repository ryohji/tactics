// 洞窟装飾(rogue-13)。訪れた広間に 鍾乳石(天井)と光るキノコ(床)を生やす。
// Crystals と同型: ゲーム性に関与しない見た目だけの要素で、配置は seed と
// 広間 id から決定的に導出する(状態に持たない。visitedChambers は exploreRev で追う)。

import { useMemo } from 'react';
import * as THREE from 'three';
import { keyToCell, worldPos, type Cell } from '../model/fcc';
import { lcg } from '../model/dungeon';
import { useRogue, ROGUE_S } from '../state/rogue';
import { glowTexture } from './glowTexture';

const S = ROGUE_S;
const STONE = '#4a4038';
const MUSH_COLORS = ['#7ee0a0', '#8fd7e8', '#d9b8f0'];

interface Stalactite {
  key: string;
  pos: THREE.Vector3;
  len: number;
  r: number;
}
interface Mushroom {
  key: string;
  pos: THREE.Vector3;
  color: string;
  scale: number;
  tilt: number;
}

export function Decor() {
  const seed = useRogue((s) => s.seed);
  const exploreRev = useRogue((s) => s.exploreRev);
  void exploreRev; // visitedChambers/dungeon は in-place 更新なので rev で再評価させる
  const { dungeon, visitedChambers } = useRogue.getState();
  const glowMap = useMemo(() => glowTexture(), []);

  const { stalactites, mushrooms } = useMemo(() => {
    const stalactites: Stalactite[] = [];
    const mushrooms: Mushroom[] = [];
    for (const id of visitedChambers) {
      const ch = dungeon.chambers[id];
      if (!ch) continue;
      const rng = lcg(((seed * 17 + id * 7919) ^ 0x27d4eb2f) >>> 0);
      const cells = ch.cells.map((k) => keyToCell(k));
      const ys = cells.map((c: Cell) => worldPos(c[0], c[1], c[2], S).y).sort((a, b) => a - b);
      if (ys.length < 4) continue;
      const yLow = ys[Math.floor(ys.length * 0.25)];
      const yHigh = ys[Math.floor(ys.length * 0.75)];
      const floor = cells.filter((c: Cell) => worldPos(c[0], c[1], c[2], S).y <= yLow);
      const ceil = cells.filter((c: Cell) => worldPos(c[0], c[1], c[2], S).y >= yHigh);
      // 鍾乳石: 天井セルから下へ 2〜4本。
      const nSt = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < nSt && ceil.length > 0; i++) {
        const c = ceil[Math.floor(rng() * ceil.length)];
        const w = worldPos(c[0], c[1], c[2], S);
        stalactites.push({
          key: `s${id}:${i}`,
          pos: new THREE.Vector3(
            w.x + (rng() - 0.5) * 0.6 * S,
            w.y + 0.42 * S,
            w.z + (rng() - 0.5) * 0.6 * S,
          ),
          len: (0.35 + rng() * 0.45) * S,
          r: (0.05 + rng() * 0.05) * S,
        });
      }
      // 光るキノコ: 床セルに 1〜2 株(それぞれ 2〜3 本の群生)。
      const nMu = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < nMu && floor.length > 0; i++) {
        const c = floor[Math.floor(rng() * floor.length)];
        const w = worldPos(c[0], c[1], c[2], S);
        const color = MUSH_COLORS[Math.floor(rng() * MUSH_COLORS.length)];
        const count = 2 + Math.floor(rng() * 2);
        for (let k = 0; k < count; k++) {
          mushrooms.push({
            key: `m${id}:${i}:${k}`,
            pos: new THREE.Vector3(
              w.x + (rng() - 0.5) * 0.55 * S,
              w.y - 0.3 * S,
              w.z + (rng() - 0.5) * 0.55 * S,
            ),
            color,
            scale: 0.5 + rng() * 0.7,
            tilt: (rng() - 0.5) * 0.5,
          });
        }
      }
    }
    return { stalactites, mushrooms };
  }, [seed, exploreRev, dungeon, visitedChambers]);

  return (
    <>
      {stalactites.map((st) => (
        <mesh key={st.key} position={st.pos} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[st.r, st.len, 6]} />
          <meshStandardMaterial color={STONE} roughness={0.95} flatShading />
        </mesh>
      ))}
      {mushrooms.map((m) => (
        <group key={m.key} position={m.pos} rotation={[m.tilt, 0, m.tilt * 0.7]} scale={m.scale}>
          {/* 柄 */}
          <mesh position={[0, 0.05 * S, 0]}>
            <cylinderGeometry args={[0.018 * S, 0.028 * S, 0.12 * S, 6]} />
            <meshStandardMaterial color="#cfc7ae" roughness={0.8} />
          </mesh>
          {/* 傘(発光) */}
          <mesh position={[0, 0.12 * S, 0]} scale={[1, 0.62, 1]}>
            <sphereGeometry args={[0.06 * S, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial
              color={m.color}
              emissive={m.color}
              emissiveIntensity={1.3}
              roughness={0.4}
              side={THREE.DoubleSide}
            />
          </mesh>
          <sprite position={[0, 0.14 * S, 0]} scale={[0.45 * S, 0.45 * S, 1]}>
            <spriteMaterial
              map={glowMap}
              color={m.color}
              transparent
              opacity={0.22}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </sprite>
        </group>
      ))}
    </>
  );
}
