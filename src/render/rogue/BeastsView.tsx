// 敵の描画(rogue)。発見済みセルにいる敵だけ見える。種族ごとに簡素な造形。
// 目(赤い点)は覚醒で光る。HP が減っていたら頭上に小さな HP バー(Billboard)。
// クリック: 通常=隣接なら近接攻撃 / 投擲モード=射程内なら投げナイフ。
// 投擲モード中は射程内の敵に白いリングを出す。

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { cellKey, worldPos } from '../../model/fcc';
import { distW } from '../../model/dungeon';
import { BEASTS } from '../../model/beasts';
import { ITEMS } from '../../model/loot';
import { useRogue, ROGUE_S, type Beast } from '../../state/rogue';
import { currentUnitGrid } from '../../state/unitAnim';
import { consumeSuppressedClick } from '../../input/suppress';
import { tapAction } from '../../input/touch';

const S = ROGUE_S;

function Body({ b }: { b: Beast }) {
  const def = BEASTS[b.kind];
  switch (b.kind) {
    case 'bat':
      return (
        <>
          <mesh position={[0, 0.3 * S, 0]}>
            <sphereGeometry args={[0.14 * S, 10, 10]} />
            <meshStandardMaterial color={def.color} roughness={0.7} />
          </mesh>
          <mesh position={[0.16 * S, 0.32 * S, 0]} rotation={[0, 0, -0.5]}>
            <coneGeometry args={[0.1 * S, 0.26 * S, 4]} />
            <meshStandardMaterial color={def.color} roughness={0.8} />
          </mesh>
          <mesh position={[-0.16 * S, 0.32 * S, 0]} rotation={[0, 0, 0.5]}>
            <coneGeometry args={[0.1 * S, 0.26 * S, 4]} />
            <meshStandardMaterial color={def.color} roughness={0.8} />
          </mesh>
        </>
      );
    case 'spider':
      return (
        <mesh position={[0, 0.12 * S, 0]} scale={[1.3, 0.6, 1.3]}>
          <sphereGeometry args={[0.18 * S, 10, 10]} />
          <meshStandardMaterial color={def.color} roughness={0.85} />
        </mesh>
      );
    case 'ghoul':
      return (
        <mesh position={[0, 0.22 * S, 0]}>
          <capsuleGeometry args={[0.15 * S, 0.34 * S, 4, 10]} />
          <meshStandardMaterial color={def.color} roughness={0.9} />
        </mesh>
      );
    case 'wisp':
      return (
        <mesh position={[0, 0.32 * S, 0]}>
          <sphereGeometry args={[0.15 * S, 12, 12]} />
          <meshStandardMaterial
            color={def.color}
            emissive={def.color}
            emissiveIntensity={2.2}
            transparent
            opacity={0.85}
          />
        </mesh>
      );
    case 'soldier':
      // 兵隊蟻: 二節の胴体+大顎。
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
          <mesh position={[0.07 * S, 0.18 * S, 0.28 * S]} rotation={[0.4, 0, 0]}>
            <coneGeometry args={[0.03 * S, 0.14 * S, 4]} />
            <meshStandardMaterial color="#3a2418" roughness={0.6} />
          </mesh>
          <mesh position={[-0.07 * S, 0.18 * S, 0.28 * S]} rotation={[0.4, 0, 0]}>
            <coneGeometry args={[0.03 * S, 0.14 * S, 4]} />
            <meshStandardMaterial color="#3a2418" roughness={0.6} />
          </mesh>
        </>
      );
    case 'shade':
      // 深淵の影: 揺らめく半透明の錐体(発光は控えめ)。
      return (
        <mesh position={[0, 0.28 * S, 0]}>
          <coneGeometry args={[0.2 * S, 0.55 * S, 8]} />
          <meshStandardMaterial
            color={def.color}
            emissive={def.color}
            emissiveIntensity={0.9}
            transparent
            opacity={0.7}
            depthWrite={false}
          />
        </mesh>
      );
    case 'drake':
      return (
        <>
          <mesh position={[0, 0.2 * S, 0]} scale={[1, 0.8, 1.5]}>
            <sphereGeometry args={[0.24 * S, 10, 10]} />
            <meshStandardMaterial color={def.color} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.42 * S, 0.28 * S]}>
            <coneGeometry args={[0.1 * S, 0.24 * S, 6]} />
            <meshStandardMaterial color={def.color} roughness={0.7} />
          </mesh>
        </>
      );
    case 'colossus':
      // 岩窟の巨人: 大きな胴体+頭石。ずんぐりと威圧感を出す。
      return (
        <>
          <mesh position={[0, 0.28 * S, 0]} scale={[1.2, 1, 1]}>
            <dodecahedronGeometry args={[0.3 * S, 0]} />
            <meshStandardMaterial color={def.color} roughness={0.95} flatShading />
          </mesh>
          <mesh position={[0, 0.62 * S, 0]}>
            <dodecahedronGeometry args={[0.15 * S, 0]} />
            <meshStandardMaterial color={def.color} roughness={0.95} flatShading />
          </mesh>
        </>
      );
  }
}

function BeastItem({ b }: { b: Beast }) {
  const ref = useRef<THREE.Group>(null);
  const clickBeast = useRogue((s) => s.clickBeast);
  const hoverBeast = useRogue((s) => s.hoverBeast);
  const uiMode = useRogue((s) => s.uiMode);
  const playerPos = useRogue((s) => s.player.pos);
  const def = BEASTS[b.kind];

  const inThrowRange =
    uiMode === 'throw' && distW(playerPos, b.pos) <= (ITEMS.knife.range ?? 0);

  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const gp = currentUnitGrid(b.id, b.pos);
    const w = worldPos(gp[0], gp[1], gp[2], S);
    const hover = b.kind === 'bat' || b.kind === 'wisp' ? 0.08 * S * Math.sin(clock.elapsedTime * 3 + b.id) : 0;
    g.position.set(w.x, w.y + hover, w.z);
  });

  return (
    <group
      ref={ref}
      onClick={(e) => {
        e.stopPropagation();
        if (consumeSuppressedClick()) return;
        // タッチは2段階: 1度目=選択(情報パネル)、2度目=攻撃/投擲。
        const s = useRogue.getState();
        const key = `beast:${b.id}`;
        if (tapAction(s.armedKey, key) === 'arm') {
          s.setArmed(key);
          hoverBeast(b.id);
          return;
        }
        s.setArmed(null);
        clickBeast(b.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        hoverBeast(b.id);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        hoverBeast(null);
        document.body.style.cursor = 'auto';
      }}
    >
      <Body b={b} />
      {/* 目: 覚醒で赤く光る */}
      <mesh position={[0.06 * S, 0.34 * S, 0.11 * S]}>
        <sphereGeometry args={[0.025 * S, 6, 6]} />
        <meshStandardMaterial
          color="#f87171"
          emissive="#ef4444"
          emissiveIntensity={b.awake ? 3 : 0.2}
        />
      </mesh>
      <mesh position={[-0.06 * S, 0.34 * S, 0.11 * S]}>
        <sphereGeometry args={[0.025 * S, 6, 6]} />
        <meshStandardMaterial
          color="#f87171"
          emissive="#ef4444"
          emissiveIntensity={b.awake ? 3 : 0.2}
        />
      </mesh>
      {/* HP バー */}
      {b.hp < def.hp && (
        <Billboard position={[0, 0.72 * S, 0]}>
          <mesh>
            <planeGeometry args={[0.5 * S, 0.06 * S]} />
            <meshBasicMaterial color="#1e293b" />
          </mesh>
          <mesh position={[(-0.25 + 0.25 * (b.hp / def.hp)) * S, 0, 0.001]}>
            <planeGeometry args={[0.5 * S * (b.hp / def.hp), 0.05 * S]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
        </Billboard>
      )}
      {/* 投擲対象リング */}
      {inThrowRange && (
        <Billboard position={[0, 0.3 * S, 0]}>
          <mesh>
            <torusGeometry args={[0.42 * S, 0.03 * S, 8, 24]} />
            <meshBasicMaterial color="#f8fafc" transparent opacity={0.9} depthWrite={false} />
          </mesh>
        </Billboard>
      )}
      {/* 状態異常リング(延焼=橙 / 混乱=桃 / 恐慌=藤 / 昏睡=青) */}
      {b.status && (
        <Billboard position={[0, 0.3 * S, 0]}>
          <mesh>
            <torusGeometry args={[0.34 * S, 0.045 * S, 8, 24]} />
            <meshBasicMaterial
              color={STATUS_COLOR[b.status.kind]}
              transparent
              opacity={0.85}
              depthWrite={false}
            />
          </mesh>
        </Billboard>
      )}
    </group>
  );
}

const STATUS_COLOR: Record<string, string> = {
  burn: '#fb923c',
  confuse: '#f472b6',
  fear: '#a78bfa',
  sleep: '#60a5fa',
};

export function BeastsView() {
  const beasts = useRogue((s) => s.beasts);
  const discoveredRev = useRogue((s) => s.discoveredRev);
  void discoveredRev; // discovered は in-place 更新なので rev で再評価させる
  const discovered = useRogue.getState().discovered;
  return (
    <>
      {beasts
        .filter((b) => b.alive && discovered.has(cellKey(b.pos)))
        .map((b) => (
          <BeastItem key={b.id} b={b} />
        ))}
    </>
  );
}
