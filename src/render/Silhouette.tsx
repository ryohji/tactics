// フォーカス中の敵のシルエット(rogue-14)。プロシージャル種のみ対象
// (glTF 種は骨アニメと同期しないため BeastsView 側の発光パルスで代替)。
// Body をもう1組描画し、マウント後に全メッシュのマテリアルを金色に差し替える
// (反転ハル)。ポストエフェクト非依存(✨オフでも表示される)。

import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Beast } from '../state/rogue';
import { ProceduralBody } from './ProceduralBodies';

// rim: 拡大した裏面ゴールド — 本体の輪郭の外周だけが見える。
// xray: 深度無視の淡いゴースト — 壁や岩の陰でも居場所が読める。
export const SIL_RIM = new THREE.MeshBasicMaterial({
  color: '#ffd75e',
  side: THREE.BackSide,
  toneMapped: false,
});
export const SIL_XRAY = new THREE.MeshBasicMaterial({
  color: '#ffd75e',
  transparent: true,
  opacity: 0.18,
  depthTest: false,
  depthWrite: false,
  side: THREE.BackSide,
  toneMapped: false,
});

/**
 * Body の useFrame は同じ b・同じ位相で動くので、羽ばたき等のモーションにも
 * ぴったり重なる。
 */
export function Silhouette({ b, mat, scale }: { b: Beast; mat: THREE.Material; scale: number }) {
  const g = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    g.current?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = mat;
        m.renderOrder = 3; // 断面キャップ(2)より後に
      }
    });
  }, [b.kind, mat]);
  return (
    <group ref={g} scale={scale}>
      <ProceduralBody b={b} />
    </group>
  );
}
