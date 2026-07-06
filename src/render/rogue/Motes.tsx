// 漂う塵(rogue-5)。たいまつ圏内をゆっくり舞い上がる微光の粒子。
// プレイヤー追従のグループ内でローカル座標を毎フレーム更新する軽量 Points。
// 上昇は半径内でラップさせ、横方向は粒ごとの位相で揺らす。加算合成・深度書き込みなし。

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { worldPos } from '../../model/fcc';
import { useRogue, ROGUE_S, PLAYER_ID } from '../../state/rogue';
import { currentUnitGrid } from '../../state/unitAnim';
import { glowTexture } from './glowTexture';

const S = ROGUE_S;
const COUNT = 150;
const R = 8 * S; // 分布半径(普通の明かりの届きと同程度)

export function Motes() {
  const pos = useRogue((s) => s.player.pos);
  const ref = useRef<THREE.Group>(null);
  const ptsRef = useRef<THREE.Points>(null);
  const map = useMemo(() => glowTexture(), []);

  // 粒ごとの基準位置と位相(固定)。描画位置は毎フレームここから導出する。
  const { base, phase, geom } = useMemo(() => {
    const base = new Float32Array(COUNT * 3);
    const phase = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      // 球内一様(棄却法)。
      let x = 0, y = 0, z = 0;
      do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
      } while (x * x + y * y + z * z > 1);
      base[i * 3] = x * R;
      base[i * 3 + 1] = y * R;
      base[i * 3 + 2] = z * R;
      phase[i] = Math.random() * Math.PI * 2;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
    // グループ追従で動くので視錐台カリングは切る(境界計算も不要になる)。
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 1.5);
    return { base, phase, geom };
  }, []);

  useFrame(({ clock }) => {
    const g = ref.current;
    const pts = ptsRef.current;
    if (!g || !pts) return;
    const gp = currentUnitGrid(PLAYER_ID, pos);
    const w = worldPos(gp[0], gp[1], gp[2], S);
    g.position.set(w.x, w.y, w.z);
    const t = clock.elapsedTime;
    const attr = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      const p = phase[i];
      // ゆっくり上昇し、半径を超えたら下からラップ。
      const rise = (base[i * 3 + 1] + t * 0.14 * S + R) % (2 * R) - R;
      arr[i * 3] = base[i * 3] + Math.sin(t * 0.31 + p) * 0.35 * S;
      arr[i * 3 + 1] = rise;
      arr[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.23 + p * 1.3) * 0.35 * S;
    }
    attr.needsUpdate = true;
  });

  return (
    <group ref={ref}>
      <points ref={ptsRef} geometry={geom} frustumCulled={false}>
        <pointsMaterial
          map={map}
          color="#ffc98a"
          size={0.09 * S}
          sizeAttenuation
          transparent
          opacity={0.55}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}
