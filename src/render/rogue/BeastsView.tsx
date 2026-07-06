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

// --- 種族別の身体(rogue-13: アイドル/警戒モーション付き) --------------------------
// どれも「まどろみ=ゆっくり」「警戒=速く大きく」。位相は id でずらして群れの同期を防ぐ。

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

function Body({ b }: { b: Beast }) {
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
