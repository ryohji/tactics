// シーン合成（W5 統合担当 / DESIGN §8「ファイル衝突の注意」）。
// Canvas 内のすべてをここに集約する: ライト + 地形(W6) + マーカー(W5) + 領域(F2) + カメラ(W7)。
//
// 各 W は自前の独立コンポーネントを別ファイルで提供し、差し込みは本ファイルに集約する
// （他 W は Scene を直接編集しない）。
//
// it-2: 旧 showAdjEdges/AdjRing（水平ヘックスのリング）は撤去し、Region の
// 菱形十二面体の稜線（showRegionEdges）に統合した。

import { TerrainView } from './Terrain';
import { Markers } from './Markers';
import { Region } from './Region';
import { CameraRig } from './CameraRig';

export function Scene() {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} />
      <directionalLight position={[-8, 4, -6]} intensity={0.3} />

      <TerrainView />
      <Markers />
      <Region />
      <CameraRig />
    </>
  );
}
