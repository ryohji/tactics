// ユニット描画（it-6）。クラス別のプリミティブ合成フィギュア + HP バー + 選択リング。
// 位置は unitAnim の補間値（経路移動・降着が滑らかに見える）。飛行ユニットは浮遊ボブ+羽ばたき。
// クリック/ホバーはゲーム入力へ（クリックはドラッグ直後抑制を共有）。
//
// 造形方針: 外部アセットなし。シルエットで職業が読める最小合成
// （魔女=とんがり帽子 / 有翼人・ガーゴイル=翼 / 騎士=兜と盾 / 弓兵=弓 / 僧侶=光輪 /
//   死霊王・大魔女=王冠 / 骸骨=白い痩身）。陣営色は青/赤。

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { worldPos } from '../model/fcc';
import { CLASSES, isFlying, isLeader, type Unit } from '../model/units';
import { useStore } from '../state/store';
import { useGame } from '../state/game';
import { currentUnitGrid } from '../state/unitAnim';
import { consumeSuppressedClick } from '../input/pick';

const PLAYER_COLOR = '#4f83e8';
const ENEMY_COLOR = '#d64545';

/** クラスごとのアクセント色。 */
const ACCENT: Record<Unit['cls'], string> = {
  grandWitch: '#f5d90a',
  witch: '#8b5cf6',
  winged: '#e2e8f0',
  knight: '#94a3b8',
  archer: '#a3e635',
  cleric: '#fef3c7',
  lich: '#22d3ee',
  warlock: '#a21caf',
  gargoyle: '#78716c',
  skeleton: '#e7e5e4',
};

function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex).multiplyScalar(f);
  return `#${c.getHexString()}`;
}

interface BodyColors {
  main: string; // 陣営色（行動済みは減光）
  accent: string;
  skin: string;
}

/** クラス別の身体（unit スケール空間: 高さ ~1.0）。 */
function Body({ cls, c }: { cls: Unit['cls']; c: BodyColors }) {
  switch (cls) {
    case 'grandWitch':
    case 'witch': {
      const grand = cls === 'grandWitch';
      return (
        <>
          {/* ローブ */}
          <mesh position={[0, 0.34, 0]}>
            <coneGeometry args={[0.3, 0.68, 10]} />
            <meshStandardMaterial color={c.main} roughness={0.7} />
          </mesh>
          {/* 頭 */}
          <mesh position={[0, 0.76, 0]}>
            <sphereGeometry args={[0.15, 12, 12]} />
            <meshStandardMaterial color={c.skin} roughness={0.6} />
          </mesh>
          {/* 帽子（つば+とんがり。少し傾ける） */}
          <group position={[0, 0.88, 0]} rotation={[0, 0, 0.16]}>
            <mesh>
              <cylinderGeometry args={[0.26, 0.26, 0.03, 12]} />
              <meshStandardMaterial color={c.accent} roughness={0.6} />
            </mesh>
            <mesh position={[0, 0.19, 0]}>
              <coneGeometry args={[0.15, 0.38, 10]} />
              <meshStandardMaterial color={c.accent} roughness={0.6} />
            </mesh>
          </group>
          {grand && (
            <mesh position={[0, 1.16, 0]} rotation={[Math.PI / 2, 0, 0.16]}>
              <torusGeometry args={[0.1, 0.025, 8, 16]} />
              <meshStandardMaterial color="#fbbf24" emissive="#8a6508" emissiveIntensity={0.6} metalness={0.7} roughness={0.3} />
            </mesh>
          )}
        </>
      );
    }
    case 'winged':
      return (
        <>
          <mesh position={[0, 0.42, 0]}>
            <capsuleGeometry args={[0.16, 0.4, 4, 10]} />
            <meshStandardMaterial color={c.main} roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.82, 0]}>
            <sphereGeometry args={[0.13, 12, 12]} />
            <meshStandardMaterial color={c.skin} roughness={0.6} />
          </mesh>
        </>
      );
    case 'knight':
      return (
        <>
          <mesh position={[0, 0.36, 0]}>
            <cylinderGeometry args={[0.2, 0.26, 0.56, 10]} />
            <meshStandardMaterial color={c.main} metalness={0.4} roughness={0.5} />
          </mesh>
          {/* 兜 */}
          <mesh position={[0, 0.74, 0]}>
            <sphereGeometry args={[0.15, 12, 12]} />
            <meshStandardMaterial color={c.accent} metalness={0.6} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.9, 0]}>
            <coneGeometry args={[0.04, 0.16, 8]} />
            <meshStandardMaterial color={c.accent} metalness={0.6} roughness={0.35} />
          </mesh>
          {/* 盾 */}
          <mesh position={[0.26, 0.42, 0]} rotation={[0, 0, -0.1]}>
            <boxGeometry args={[0.06, 0.34, 0.26]} />
            <meshStandardMaterial color={c.accent} metalness={0.5} roughness={0.4} />
          </mesh>
        </>
      );
    case 'archer':
      return (
        <>
          <mesh position={[0, 0.38, 0]}>
            <cylinderGeometry args={[0.14, 0.2, 0.6, 10]} />
            <meshStandardMaterial color={c.main} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.78, 0]}>
            <sphereGeometry args={[0.13, 12, 12]} />
            <meshStandardMaterial color={c.skin} roughness={0.6} />
          </mesh>
          {/* 弓（円弧） */}
          <mesh position={[0.24, 0.5, 0]} rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[0.26, 0.02, 6, 16, Math.PI * 0.9]} />
            <meshStandardMaterial color={c.accent} roughness={0.5} />
          </mesh>
        </>
      );
    case 'cleric':
      return (
        <>
          <mesh position={[0, 0.36, 0]}>
            <coneGeometry args={[0.28, 0.66, 10]} />
            <meshStandardMaterial color={c.accent} roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.76, 0]}>
            <sphereGeometry args={[0.14, 12, 12]} />
            <meshStandardMaterial color={c.skin} roughness={0.6} />
          </mesh>
          {/* 光輪 */}
          <mesh position={[0, 0.98, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.12, 0.018, 8, 20]} />
            <meshStandardMaterial color="#fde047" emissive="#a58a12" emissiveIntensity={0.9} />
          </mesh>
          {/* 帯（陣営色） */}
          <mesh position={[0, 0.4, 0]}>
            <cylinderGeometry args={[0.2, 0.22, 0.08, 10]} />
            <meshStandardMaterial color={c.main} roughness={0.7} />
          </mesh>
        </>
      );
    case 'lich':
      return (
        <>
          <mesh position={[0, 0.42, 0]}>
            <coneGeometry args={[0.32, 0.84, 10]} />
            <meshStandardMaterial color={shade(c.main, 0.55)} roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.9, 0]}>
            <sphereGeometry args={[0.14, 12, 12]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.5} />
          </mesh>
          {/* 王冠 */}
          <mesh position={[0, 1.04, 0]}>
            <cylinderGeometry args={[0.13, 0.11, 0.1, 6, 1, true]} />
            <meshStandardMaterial color="#fbbf24" emissive="#7a5a06" emissiveIntensity={0.7} metalness={0.8} roughness={0.3} side={THREE.DoubleSide} />
          </mesh>
          {/* 冷光の目 */}
          <mesh position={[0.05, 0.9, 0.11]}>
            <sphereGeometry args={[0.02, 6, 6]} />
            <meshStandardMaterial color={c.accent} emissive={c.accent} emissiveIntensity={2} />
          </mesh>
          <mesh position={[-0.05, 0.9, 0.11]}>
            <sphereGeometry args={[0.02, 6, 6]} />
            <meshStandardMaterial color={c.accent} emissive={c.accent} emissiveIntensity={2} />
          </mesh>
        </>
      );
    case 'warlock':
      return (
        <>
          <mesh position={[0, 0.36, 0]}>
            <coneGeometry args={[0.28, 0.7, 10]} />
            <meshStandardMaterial color={shade(c.main, 0.75)} roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.78, 0]}>
            <sphereGeometry args={[0.14, 12, 12]} />
            <meshStandardMaterial color={c.skin} roughness={0.6} />
          </mesh>
          {/* 角 */}
          <mesh position={[0.09, 0.92, 0]} rotation={[0, 0, -0.5]}>
            <coneGeometry args={[0.03, 0.16, 6]} />
            <meshStandardMaterial color={c.accent} roughness={0.5} />
          </mesh>
          <mesh position={[-0.09, 0.92, 0]} rotation={[0, 0, 0.5]}>
            <coneGeometry args={[0.03, 0.16, 6]} />
            <meshStandardMaterial color={c.accent} roughness={0.5} />
          </mesh>
        </>
      );
    case 'gargoyle':
      return (
        <>
          {/* うずくまる胴体 */}
          <mesh position={[0, 0.3, 0]}>
            <sphereGeometry args={[0.24, 10, 10]} />
            <meshStandardMaterial color={c.accent} roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.58, 0.06]}>
            <sphereGeometry args={[0.13, 10, 10]} />
            <meshStandardMaterial color={c.accent} roughness={0.9} />
          </mesh>
          {/* 角 */}
          <mesh position={[0.07, 0.72, 0.06]} rotation={[0, 0, -0.4]}>
            <coneGeometry args={[0.03, 0.12, 6]} />
            <meshStandardMaterial color={shade(c.accent, 0.7)} roughness={0.8} />
          </mesh>
          <mesh position={[-0.07, 0.72, 0.06]} rotation={[0, 0, 0.4]}>
            <coneGeometry args={[0.03, 0.12, 6]} />
            <meshStandardMaterial color={shade(c.accent, 0.7)} roughness={0.8} />
          </mesh>
          {/* 陣営マーカー（胸元） */}
          <mesh position={[0, 0.36, 0.2]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshStandardMaterial color={c.main} emissive={c.main} emissiveIntensity={0.5} />
          </mesh>
        </>
      );
    case 'skeleton':
      return (
        <>
          <mesh position={[0, 0.38, 0]}>
            <cylinderGeometry args={[0.1, 0.14, 0.6, 8]} />
            <meshStandardMaterial color={c.accent} roughness={0.6} />
          </mesh>
          {/* 肋骨感 */}
          <mesh position={[0, 0.52, 0]}>
            <cylinderGeometry args={[0.15, 0.15, 0.05, 8]} />
            <meshStandardMaterial color={shade(c.accent, 0.85)} roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.4, 0]}>
            <cylinderGeometry args={[0.14, 0.14, 0.05, 8]} />
            <meshStandardMaterial color={shade(c.accent, 0.85)} roughness={0.6} />
          </mesh>
          {/* 頭蓋 */}
          <mesh position={[0, 0.78, 0]}>
            <sphereGeometry args={[0.13, 10, 10]} />
            <meshStandardMaterial color={c.accent} roughness={0.5} />
          </mesh>
          {/* 得物（錆びた剣） */}
          <mesh position={[0.2, 0.5, 0]} rotation={[0, 0, -0.3]}>
            <boxGeometry args={[0.03, 0.4, 0.03]} />
            <meshStandardMaterial color={c.main} roughness={0.6} />
          </mesh>
        </>
      );
  }
}

/** 翼（有翼人・ガーゴイル・浮遊中の視覚補助はしない）。flapRef で羽ばたく。 */
function Wings({ color, refL, refR, y }: { color: string; refL: React.RefObject<THREE.Group>; refR: React.RefObject<THREE.Group>; y: number }) {
  return (
    <>
      <group ref={refL} position={[0.14, y, -0.05]}>
        <mesh position={[0.22, 0.06, 0]} rotation={[0.2, 0.35, 0.5]}>
          <boxGeometry args={[0.44, 0.16, 0.03]} />
          <meshStandardMaterial color={color} roughness={0.6} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <group ref={refR} position={[-0.14, y, -0.05]}>
        <mesh position={[-0.22, 0.06, 0]} rotation={[0.2, -0.35, -0.5]}>
          <boxGeometry args={[0.44, 0.16, 0.03]} />
          <meshStandardMaterial color={color} roughness={0.6} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </>
  );
}

const WINGED_CLASSES = new Set<Unit['cls']>(['winged', 'gargoyle']);

function UnitFigure({ unit }: { unit: Unit }) {
  const S = useStore((s) => s.params.S);
  const selectedId = useGame((s) => s.selectedId);
  const phase = useGame((s) => s.phase);
  const clickUnit = useGame((s) => s.clickUnit);
  const hoverUnit = useGame((s) => s.hoverUnit);

  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const levRef = useRef<THREE.Mesh>(null);
  const wingL = useRef<THREE.Group>(null);
  const wingR = useRef<THREE.Group>(null);
  const hpRef = useRef<THREE.Mesh>(null);

  const cls = CLASSES[unit.cls];
  const selected = selectedId === unit.id;
  const dimmed = unit.acted && phase === 'player' && unit.side === 'player';
  const flying = isFlying(unit);

  const colors: BodyColors = useMemo(() => {
    const f = dimmed ? 0.45 : 1;
    return {
      main: shade(unit.side === 'player' ? PLAYER_COLOR : ENEMY_COLOR, f),
      accent: shade(ACCENT[unit.cls], f),
      skin: shade('#e8c39e', f),
    };
  }, [unit.side, unit.cls, dimmed]);

  const hpRatio = unit.hp / cls.hp;
  const hpColor = hpRatio > 0.5 ? '#22c55e' : hpRatio > 0.25 ? '#f59e0b' : '#ef4444';

  useFrame(({ clock }) => {
    const g = groupRef.current;
    if (!g) return;
    const t = clock.elapsedTime;
    const p = currentUnitGrid(unit.id, unit.pos);
    const w = worldPos(p[0], p[1], p[2], S);
    g.position.set(w.x, w.y, w.z);
    // 浮遊ボブ（飛行中のみ）。足元基準はセル中心の少し下。
    const bob = flying ? Math.sin(t * 2 + unit.id) * 0.05 : 0;
    if (bodyRef.current) bodyRef.current.position.y = -0.45 + bob;
    // 羽ばたき。
    const flap = Math.sin(t * 7 + unit.id) * 0.35;
    if (wingL.current) wingL.current.rotation.z = flap;
    if (wingR.current) wingR.current.rotation.z = -flap;
    // 選択リング回転・浮遊リング回転。
    if (ringRef.current) ringRef.current.rotation.z = t * 1.5;
    if (levRef.current) levRef.current.rotation.z = -t * 2;
    // HP バーの伸縮。
    if (hpRef.current) {
      hpRef.current.scale.x = Math.max(0.001, hpRatio);
      hpRef.current.position.x = -0.35 * (1 - hpRatio);
    }
  });

  if (!unit.alive) return null;

  return (
    <group
      ref={groupRef}
      scale={[S, S, S]}
      onClick={(e) => {
        e.stopPropagation();
        if (consumeSuppressedClick()) return;
        clickUnit(unit.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        hoverUnit(unit.id);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        hoverUnit(null);
        document.body.style.cursor = 'auto';
      }}
    >
      {/* 身体（足元 y=-0.45 がセル中心の少し下） */}
      <group ref={bodyRef} position={[0, -0.45, 0]}>
        <Body cls={unit.cls} c={colors} />
        {WINGED_CLASSES.has(unit.cls) && <Wings color={colors.accent} refL={wingL} refR={wingR} y={0.55} />}
        {/* 陣営ベースリング */}
        <mesh position={[0, 0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.3, 0.025, 8, 24]} />
          <meshStandardMaterial
            color={colors.main}
            emissive={colors.main}
            emissiveIntensity={dimmed ? 0.1 : 0.45}
          />
        </mesh>
        {/* リーダーの金環 */}
        {isLeader(unit) && (
          <mesh position={[0, 0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.36, 0.015, 8, 24]} />
            <meshStandardMaterial color="#fbbf24" emissive="#8a6508" emissiveIntensity={0.8} />
          </mesh>
        )}
        {/* 浮遊付与の紫リング */}
        {unit.levitate > 0 && !cls.fly && (
          <mesh ref={levRef} position={[0, -0.06, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.34, 0.02, 8, 24]} />
            <meshStandardMaterial color="#c084fc" emissive="#7e22ce" emissiveIntensity={1.2} transparent opacity={0.85} />
          </mesh>
        )}
        {/* 選択リング */}
        {selected && (
          <mesh ref={ringRef} position={[0, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.42, 0.02, 8, 32]} />
            <meshStandardMaterial color="#fde047" emissive="#a58a12" emissiveIntensity={1.4} />
          </mesh>
        )}
      </group>

      {/* HP バー（ビルボード） */}
      <Billboard position={[0, 0.75, 0]}>
        <mesh>
          <planeGeometry args={[0.74, 0.1]} />
          <meshBasicMaterial color="#0f172a" transparent opacity={0.75} />
        </mesh>
        <mesh ref={hpRef} position={[0, 0, 0.001]}>
          <planeGeometry args={[0.7, 0.06]} />
          <meshBasicMaterial color={hpColor} />
        </mesh>
      </Billboard>
    </group>
  );
}

export function Units() {
  const units = useGame((s) => s.units);
  return (
    <>
      {units.map((u) => (
        <UnitFigure key={u.id} unit={u} />
      ))}
    </>
  );
}
