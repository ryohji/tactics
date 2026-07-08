// glTF の敵ボディ(rogue-15/17)。スキン付きモデルはインスタンスごとに
// SkeletonUtils で複製し、マテリアルも複製する(フォーカス発光が他個体へ波及しないように)。
// アニメ: 移動中=move / 停止=idle(警戒で等速・まどろみは低速)。
// フォーカス中は発光パルス(骨アニメと同期しない反転ハルの代替)。

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { ROGUE_S, type Beast } from '../state/rogue';
import { isUnitMoving } from '../state/unitAnim';
import type { BeastModelCfg } from './beastModels';

const S = ROGUE_S;
const FOCUS_EMISSIVE = new THREE.Color('#c79215');

export function GltfBeastBody({ b, cfg, focused }: { b: Beast; cfg: BeastModelCfg; focused: boolean }) {
  const { scene, animations } = useGLTF(cfg.url);
  const clone = useMemo(() => {
    const c = SkeletonUtils.clone(scene);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.frustumCulled = false; // スキン境界はボーン更新前に不定なので誤カリングを避ける
        m.material = Array.isArray(m.material)
          ? m.material.map((x) => x.clone())
          : m.material.clone();
        // 色調(影: 暗い青紫の半透明へ寄せる)。
        if (cfg.tint) {
          for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
            const sm = mat as THREE.MeshStandardMaterial;
            if (sm.color) sm.color.lerp(new THREE.Color(cfg.tint.color), 0.55);
            sm.transparent = true;
            sm.opacity = cfg.tint.opacity;
            sm.depthWrite = false;
          }
        }
      }
    });
    return c;
  }, [scene, cfg]);
  const group = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, group);
  const cur = useRef('');
  const wasFocused = useRef(false);

  const mats = useMemo(() => {
    const out: THREE.MeshStandardMaterial[] = [];
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
            out.push(mat as THREE.MeshStandardMaterial);
          }
        }
      }
    });
    return out;
  }, [clone]);

  const { scale, off } = useMemo(() => {
    // Box3.setFromObject はスキン付きメッシュでスキニング込みの境界を計算するが、
    // 描画前はボーン行列が単位行列のため境界が暴発する(Quaternius 系は armature に
    // ×100 スケールがあり、実寸の百倍近い値になる → scale がほぼ0で見えなくなる)。
    // そこでバインドポーズのジオメトリ境界(ノード変換のみ)から正規化する。
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        tmp.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
        box.union(tmp);
      }
    });
    const h = Math.max(0.01, box.max.y - box.min.y);
    const scale = (cfg.h * S) / h;
    // 足元を接地させ、x/z はモデル原点のずれ(Ant は大きい)を中心合わせで打ち消す。
    const off = new THREE.Vector3(
      -(box.min.x + box.max.x) * 0.5 * scale,
      -box.min.y * scale,
      -(box.min.z + box.max.z) * 0.5 * scale,
    );
    return { scale, off };
  }, [clone, cfg.h]);

  const findClip = (pats: string[]): string | undefined => {
    for (const p of pats) {
      const n = names.find((x) => x.toLowerCase().includes(p));
      if (n) return n;
    }
    return names[0];
  };

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const moving = isUnitMoving(b.id);
    if (names.length > 0) {
      const want = findClip(moving ? cfg.move : cfg.idle);
      if (want && want !== cur.current) {
        actions[cur.current]?.fadeOut(0.2);
        actions[want]?.reset().fadeIn(0.2).play();
        cur.current = want;
      }
      const a = actions[cur.current];
      if (a) a.timeScale = moving ? 1.2 : b.awake ? 1 : 0.45;
    } else {
      // アニメ無しの静材: 手続きモーションで補う(回転・移動ボブ)。
      // clone はラッパで scale されるため、ワールド量はスケールで割って与える。
      if (cfg.spin) clone.rotation.y += cfg.spin * dt * (b.awake ? 1.6 : 1);
      clone.position.y = moving ? (Math.abs(Math.sin(t * 11 + b.id)) * 0.05 * S) / scale : 0;
      clone.rotation.z = moving ? 0.06 * Math.sin(t * 11 + b.id) : 0;
    }
    // フォーカス発光(金) > 常時発光(鬼火) > なし。
    if (focused) {
      const p = 0.45 + 0.3 * Math.sin(t * 6);
      for (const m of mats) {
        m.emissive.copy(FOCUS_EMISSIVE);
        m.emissiveIntensity = p;
      }
      wasFocused.current = true;
    } else if (cfg.glow) {
      const p = 0.8 + 0.5 * Math.sin(t * (b.awake ? 5.5 : 1.6) + b.id);
      for (const m of mats) {
        m.emissive.set(cfg.glow);
        m.emissiveIntensity = p;
      }
      wasFocused.current = false;
    } else if (wasFocused.current) {
      for (const m of mats) m.emissiveIntensity = 0;
      wasFocused.current = false;
    }
  });

  return (
    <group ref={group}>
      <group position={[off.x, off.y + (cfg.lift - 0.4) * S, off.z]} scale={scale}>
        <primitive object={clone} />
      </group>
    </group>
  );
}
