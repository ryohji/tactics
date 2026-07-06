// rogue のシーン合成。洞窟なので背景は闇・霧は近め・環境光は最小限にし、
// プレイヤーのたいまつ(PlayerView 内のポイントライト)が主光源になる。
// マップモード(M): カット無しで巣全体を俯瞰する。ゲーム用のマーカー・バブル・
// アイテム・敵は隠し、可視表面(発見済み空洞の内表面)だけを明るめの照明で見せる。

import * as THREE from 'three';
import { useRogue, ROGUE_S } from '../../state/rogue';
import { DungeonShell } from './DungeonShell';
import { LevelFloor } from './LevelFloor';
import { DevicesView } from './DevicesView';
import { PlayerView } from './PlayerView';
import { BeastsView } from './BeastsView';
import { LootView } from './LootView';
import { MoveMarkers } from './MoveMarkers';
import { Bubbles } from './Bubbles';
import { RogueEffects } from './RogueEffects';
import { RogueCamera } from './RogueCamera';
import { Motes } from './Motes';
import { Crystals } from './Crystals';
import { RoguePostFx } from './RoguePostFx';

const S = ROGUE_S;

export function RogueScene() {
  const mapMode = useRogue((s) => s.mapMode);
  return (
    <>
      {/* 暗い土色の背景・霧: 幾何が何も無い方向(未発見の岩の中)も「土」として読める。
          断面キャップの明るい土色 → 遠景の暗い土色、の層で奥行きを出す。 */}
      <color attach="background" args={['#2a1e14']} />
      {mapMode ? (
        <fog attach="fog" args={[new THREE.Color('#2a1e14'), 60 * S, 220 * S]} />
      ) : (
        <fog attach="fog" args={[new THREE.Color('#2a1e14'), 10 * S, 46 * S]} />
      )}

      {/* 全暗にはしない(輪郭が読める程度の底上げ)。主光源はたいまつ。 */}
      <ambientLight intensity={mapMode ? 0.85 : 0.3} color="#8a7fae" />
      <directionalLight position={[10, 24, 8]} intensity={mapMode ? 0.6 : 0.22} color="#a5b4fc" />
      {mapMode && <directionalLight position={[-14, -10, -8]} intensity={0.3} color="#c9b896" />}

      <DungeonShell />
      <Crystals />
      {!mapMode && <Motes />}
      {!mapMode && <LevelFloor />}
      {!mapMode && <DevicesView />}
      {!mapMode && <LootView />}
      {!mapMode && <BeastsView />}
      <PlayerView />
      {!mapMode && <MoveMarkers />}
      <Bubbles />{/* モードで内容が変わる(ゲーム=アイテム/通路、マップ=敵/アイテム+引き出し線) */}
      <RogueEffects />
      <RogueCamera />
      <RoguePostFx />
    </>
  );
}
