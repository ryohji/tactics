// 敵の描画(rogue)。発見済みセルにいる敵だけ見える。
// モデル定義は beastModels.ts、本体は GltfBeastBody.tsx / ProceduralBodies.tsx、
// フォーカスシルエットは Silhouette.tsx。ここは配置・向き・クリック処理のみ。
// 目(赤い点)は覚醒で光る。HP が減っていたら頭上に小さな HP バー(Billboard)。
// クリック: 通常=隣接なら近接攻撃 / 投擲モード=射程内なら投げナイフ。
// 投擲モード中は射程内の敵に白いリングを出す。

import { Suspense, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { cellKey, worldPos } from '../model/fcc';
import { distW } from '../model/dungeon';
import { BEASTS } from '../model/beasts';
import { ITEMS } from '../model/loot';
import { useRogue, ROGUE_S, type Beast } from '../state/rogue';
import { currentUnitGrid } from '../state/unitAnim';
import { consumeSuppressedClick } from '../input/suppress';
import { tapAction } from '../input/touch';
import { BEAST_MODELS } from './beastModels';
import { GltfBeastBody } from './GltfBeastBody';
import { ProceduralBody } from './ProceduralBodies';
import { Silhouette, SIL_RIM, SIL_XRAY } from './Silhouette';

const S = ROGUE_S;

/** 足元リング(視認性対策)。松明圏外でも種族色の細い輪で「そこに居る」を示す。
    ホバー中は不透明度を上げ、半径をわずかに脈動させて強調する。 */
function FootRing({ color, focused }: { color: string; focused: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = focused ? 0.9 : 0.45;
    if (mesh.current) {
      const pulse = focused ? 1 + 0.08 * Math.sin(clock.elapsedTime * 5) : 1;
      mesh.current.scale.setScalar(pulse);
    }
  });
  return (
    <mesh ref={mesh} position={[0, 0.015 * S, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.34 * S, 0.42 * S, 24]} />
      <meshBasicMaterial
        ref={mat}
        color={color}
        transparent
        opacity={0.45}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function Body({ b, focused = false }: { b: Beast; focused?: boolean }) {
  const cfg = BEAST_MODELS[b.kind];
  if (cfg) {
    return (
      <Suspense fallback={<ProceduralBody b={b} />}>
        <GltfBeastBody b={b} cfg={cfg} focused={focused} />
      </Suspense>
    );
  }
  return <ProceduralBody b={b} />;
}

function BeastItem({ b }: { b: Beast }) {
  const ref = useRef<THREE.Group>(null);
  const clickBeast = useRogue((s) => s.clickBeast);
  const hoverBeast = useRogue((s) => s.hoverBeast);
  const uiMode = useRogue((s) => s.uiMode);
  const playerPos = useRogue((s) => s.player.pos);
  const focused = useRogue((s) => s.hoverBeastId === b.id);
  const def = BEASTS[b.kind];

  const inThrowRange =
    uiMode === 'throw' && distW(playerPos, b.pos) <= (ITEMS.knife.range ?? 0);
  const isModel = !!BEAST_MODELS[b.kind];
  const bodyRef = useRef<THREE.Group>(null);
  const lastPos = useRef(new THREE.Vector3(1e9, 0, 0));
  const yaw = useRef(0);

  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const gp = currentUnitGrid(b.id, b.pos);
    const w = worldPos(gp[0], gp[1], gp[2], S);
    const hover = b.kind === 'bat' || b.kind === 'wisp' ? 0.08 * S * Math.sin(clock.elapsedTime * 3 + b.id) : 0;
    g.position.set(w.x, w.y + hover, w.z);
    // 向き: 移動中=進行方向 / 覚醒して停止中=プレイヤーの方(短弧補間)。
    const dx = w.x - lastPos.current.x;
    const dz = w.z - lastPos.current.z;
    let target: number | null = null;
    if (lastPos.current.x < 1e8 && dx * dx + dz * dz > 1e-6) {
      target = Math.atan2(dx, dz);
    } else if (b.awake) {
      const pw = worldPos(playerPos[0], playerPos[1], playerPos[2], S);
      const px = pw.x - w.x;
      const pz = pw.z - w.z;
      if (px * px + pz * pz > 1e-6) target = Math.atan2(px, pz);
    }
    if (target !== null) {
      let d = target - yaw.current;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw.current += d * 0.18;
    }
    lastPos.current.set(w.x, w.y, w.z);
    if (bodyRef.current) bodyRef.current.rotation.y = yaw.current;
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
      {/* 当たり判定用の不可視球: 小さい敵(蝙蝠・蜘蛛等)はモデル自体のヒットボックスが
          細く、カーソルオーバー/クリックを拾い損ねやすい。opacity=0 でも visible なら
          raycast されるので、group のイベントハンドラをこの球でも発火させて底上げする
          (モデルの当たり判定も引き続き有効。半径は隣セルに大きくはみ出さない値)。 */}
      <mesh position={[0, 0.3 * S, 0]}>
        <sphereGeometry args={[0.45 * S, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <FootRing color={def.color} focused={focused} />
      <group ref={bodyRef}>
        {/* フォーカス中のシルエット: プロシージャル種は反転ハル(縁取り+壁越しゴースト)。
            glTF 種は骨アニメと同期しないため Body 側の発光パルスで示す。 */}
        {focused && !isModel && (
          <>
            <Silhouette b={b} mat={SIL_RIM} scale={1.08} />
            <Silhouette b={b} mat={SIL_XRAY} scale={1.0} />
          </>
        )}
        <Body b={b} focused={focused} />
        {/* 目: 覚醒で赤く光る(モデル種は顔があるので不要) */}
        {!isModel && (
          <>
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
          </>
        )}
      </group>
      {/* HP バー(rogue-36: 分母は maxHp・障壁ありは満タンでも表示し、上縁にシアンの障壁帯) */}
      {(b.hp < b.maxHp || b.barrier > 0) && (
        <Billboard position={[0, 0.72 * S, 0]}>
          <mesh>
            <planeGeometry args={[0.5 * S, 0.06 * S]} />
            <meshBasicMaterial color="#1e293b" />
          </mesh>
          <mesh position={[(-0.25 + 0.25 * (b.hp / b.maxHp)) * S, 0, 0.001]}>
            <planeGeometry args={[0.5 * S * (b.hp / b.maxHp), 0.05 * S]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
          {b.barrier > 0 &&
            (() => {
              const bf = Math.min(b.barrier, b.maxHp) / b.maxHp;
              return (
                <mesh position={[(-0.25 + 0.25 * bf) * S, 0.02 * S, 0.002]}>
                  <planeGeometry args={[0.5 * S * bf, 0.02 * S]} />
                  <meshBasicMaterial color="#22d3ee" />
                </mesh>
              );
            })()}
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
