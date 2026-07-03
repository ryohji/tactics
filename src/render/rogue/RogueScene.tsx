// rogue のシーン合成。洞窟なので背景は闇・霧は近め・環境光は最小限にし、
// プレイヤーのたいまつ(PlayerView 内のポイントライト)が主光源になる。

import * as THREE from 'three';
import { ROGUE_S } from '../../state/rogue';
import { DungeonShell } from './DungeonShell';
import { PlayerView } from './PlayerView';
import { BeastsView } from './BeastsView';
import { LootView } from './LootView';
import { MoveMarkers } from './MoveMarkers';
import { RogueEffects } from './RogueEffects';
import { RogueCamera } from './RogueCamera';

const S = ROGUE_S;

export function RogueScene() {
  return (
    <>
      {/* 土色寄りの闇: カットアウェイの切り口の外=「まだ岩の中」を示唆する */}
      <color attach="background" args={['#0d0a07']} />
      <fog attach="fog" args={[new THREE.Color('#0d0a07'), 10 * S, 46 * S]} />

      {/* 全暗にはしない(輪郭が読める程度の底上げ)。主光源はたいまつ。 */}
      <ambientLight intensity={0.3} color="#8a7fae" />
      <directionalLight position={[10, 24, 8]} intensity={0.22} color="#a5b4fc" />

      <DungeonShell />
      <LootView />
      <BeastsView />
      <PlayerView />
      <MoveMarkers />
      <RogueEffects />
      <RogueCamera />
    </>
  );
}
