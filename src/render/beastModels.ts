// 敵種 → glTF モデルの対応表(rogue-15/17)。poly.pizza 経由(出典は credits.json)。
// データのみ。読み込み・描画ロジックは GltfBeastBody.tsx。
// クリップ名はモデルごとに揺れるため、部分一致の候補列で解決する(GltfBeastBody 側)。
// アニメ無しの静材(Planet/Ant)は spin/移動ボブの手続きモーションで補う。

import { useGLTF } from '@react-three/drei';
import type { BeastKind } from '../model/beasts';

export interface BeastModelCfg {
  url: string;
  /** 目標の高さ(セル寸法 S 単位)。 */
  h: number;
  /** 接地オフセット(S 単位。飛行種は浮かせる)。 */
  lift: number;
  idle: string[];
  move: string[];
  /** 常時回転(rad/s)。鬼火=Planet 用。 */
  spin?: number;
  /** 常時発光の色(鬼火)。フォーカスの金パルスが優先。 */
  glow?: string;
  /** 色調(影=骸骨を暗く半透明の怪異に寄せる)。 */
  tint?: { color: string; opacity: number };
}

const MODEL_BASE = `${import.meta.env.BASE_URL}models/beasts/`;

export const BEAST_MODELS: Partial<Record<BeastKind, BeastModelCfg>> = {
  bat: { url: `${MODEL_BASE}Bat.glb`, h: 0.5, lift: 0.35, idle: ['flying'], move: ['flying'] },
  rat: { url: `${MODEL_BASE}Rat.glb`, h: 0.35, lift: 0, idle: ['idle'], move: ['run', 'walk'] },
  spider: { url: `${MODEL_BASE}Spider.glb`, h: 0.45, lift: 0, idle: ['idle'], move: ['walk', 'jump'] },
  ghoul: { url: `${MODEL_BASE}Zombie.glb`, h: 0.85, lift: 0, idle: ['idle'], move: ['walk', 'run'] },
  snake: { url: `${MODEL_BASE}Snake.glb`, h: 0.4, lift: 0, idle: ['idle'], move: ['walk'] },
  slime: { url: `${MODEL_BASE}Slime.glb`, h: 0.55, lift: 0, idle: ['idle'], move: ['walk'] },
  mushnub: { url: `${MODEL_BASE}Mushnub.glb`, h: 0.6, lift: 0, idle: ['idle'], move: ['walk'] },
  soldier: { url: `${MODEL_BASE}Ant.glb`, h: 0.5, lift: 0, idle: [], move: [] },
  wisp: { url: `${MODEL_BASE}Planet.glb`, h: 0.42, lift: 0.4, idle: [], move: [], spin: 2.2, glow: '#67d3e0' },
  shade: {
    url: `${MODEL_BASE}Skeleton.glb`,
    h: 0.9,
    lift: 0,
    idle: ['idle'],
    move: ['running', 'walk'],
    tint: { color: '#8a7ddb', opacity: 0.72 },
  },
  drake: { url: `${MODEL_BASE}Dragon.glb`, h: 0.9, lift: 0.15, idle: ['flying_idle', 'idle'], move: ['fast_flying', 'flying'] },
  colossus: { url: `${MODEL_BASE}Golem.glb`, h: 1.15, lift: 0, idle: ['flying_idle', 'idle'], move: ['fast_flying', 'walk'] },
};

for (const cfg of Object.values(BEAST_MODELS)) useGLTF.preload(cfg.url);
