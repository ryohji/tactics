import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { Leva } from 'leva';
import { Scene } from './render/Scene';
import { Controls } from './ui/Controls';
import { GameHud } from './ui/GameHud';
import { unlock } from './audio/sfx';

// it-6 合成点。Canvas 内は <Scene/>（空気感・地形・ユニット・エフェクト・カメラ）。
// Canvas 外に <GameHud/>（ゲーム操作の DOM オーバーレイ）と <Controls/>（leva デバッグ、畳んで置く）。
// 効果音の AudioContext は自動再生制限のため初回 pointerdown で unlock する。
export function App() {
  useEffect(() => {
    const onDown = () => unlock();
    window.addEventListener('pointerdown', onDown, { once: true });
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);

  return (
    <>
      <Canvas camera={{ position: [40, 30, 40], fov: 42 }}>
        <Scene />
      </Canvas>
      <GameHud />
      <Leva collapsed titleBar={{ title: 'デバッグ' }} />
      <Controls />
    </>
  );
}
