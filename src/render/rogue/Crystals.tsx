// 洞窟クリスタル(rogue-5)。訪れた広間の床near付近に生える発光鉱石の装飾。
// ゲーム性には関与しない。配置は seed と広間 id から決定的に導出する
// (状態には持たない。visitedChambers の増分は exploreRev で追う)。
// 発光はブルームで「にじむ光」になり、部屋ごとの色味が空間の記憶にもなる。

import { useMemo } from 'react';
import * as THREE from 'three';
import { keyToCell, worldPos, type Cell } from '../../model/fcc';
import { lcg } from '../../model/dungeon';
import { useRogue, ROGUE_S } from '../../state/rogue';
import { glowTexture } from './glowTexture';

const S = ROGUE_S;
const PALETTE = ['#7ce7ff', '#b28dff', '#ffd479', '#8affc1'];

interface Shard {
  key: string;
  pos: THREE.Vector3;
  color: string;
  scale: [number, number, number];
  rot: [number, number, number];
}

export function Crystals() {
  const seed = useRogue((s) => s.seed);
  const exploreRev = useRogue((s) => s.exploreRev);
  void exploreRev; // visitedChambers/dungeon は in-place 更新なので rev で再評価させる
  const { dungeon, visitedChambers } = useRogue.getState();
  const glowMap = useMemo(() => glowTexture(), []);

  const shards = useMemo(() => {
    const out: Shard[] = [];
    for (const id of visitedChambers) {
      const ch = dungeon.chambers[id];
      if (!ch) continue;
      const rng = lcg(((seed * 31 + id * 9973) ^ 0x5bd1e995) >>> 0);
      // 広間の下寄りのセルから決定的に数個選ぶ(床に生えているように見せる)。
      const cells = ch.cells.map((k) => keyToCell(k));
      const ys = cells.map((c: Cell) => worldPos(c[0], c[1], c[2], S).y).sort((a, b) => a - b);
      const yCut = ys[Math.floor(ys.length * 0.3)] ?? Infinity;
      const floor = cells.filter((c: Cell) => worldPos(c[0], c[1], c[2], S).y <= yCut);
      const n = 2 + Math.floor(rng() * 2);
      for (let i = 0; i < n && floor.length > 0; i++) {
        const c = floor[Math.floor(rng() * floor.length)];
        const w = worldPos(c[0], c[1], c[2], S);
        const color = PALETTE[Math.floor(rng() * PALETTE.length)];
        const r = (0.09 + rng() * 0.08) * S;
        out.push({
          key: `${id}:${i}`,
          pos: new THREE.Vector3(w.x + (rng() - 0.5) * 0.5 * S, w.y - 0.28 * S, w.z + (rng() - 0.5) * 0.5 * S),
          color,
          scale: [r, r * (1.6 + rng() * 0.9), r],
          rot: [(rng() - 0.5) * 0.5, rng() * Math.PI, (rng() - 0.5) * 0.5],
        });
      }
    }
    return out;
  }, [seed, exploreRev, dungeon, visitedChambers]);

  return (
    <>
      {shards.map((sh) => (
        <group key={sh.key} position={sh.pos}>
          <mesh rotation={sh.rot} scale={sh.scale}>
            <octahedronGeometry args={[1, 0]} />
            <meshStandardMaterial
              color={sh.color}
              emissive={sh.color}
              emissiveIntensity={1.4}
              roughness={0.25}
            />
          </mesh>
          <sprite position={[0, 0.1 * S, 0]} scale={[0.8 * S, 0.8 * S, 1]}>
            <spriteMaterial
              map={glowMap}
              color={sh.color}
              transparent
              opacity={0.28}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </sprite>
        </group>
      ))}
    </>
  );
}
