import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { RogueScene } from './render/rogue/RogueScene';
import { RogueHud } from './ui/RogueHud';
import { unlock } from './audio/sfx';

// rogue-1 合成点。Canvas 内は <RogueScene/>(洞窟・敵・宝・マーカー・カメラ)。
// tactics(it-6)の Scene/GameHud/Controls は温存してあるが、このブランチでは配線しない。
// 効果音の AudioContext は自動再生制限のため初回 pointerdown で unlock する。
export function App() {
  useEffect(() => {
    const onDown = () => unlock();
    window.addEventListener('pointerdown', onDown, { once: true });
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);

  return (
    <>
      {/* stencil: カットアウェイの断面キャップ用(three r163+ は既定 off) */}
      <Canvas gl={{ stencil: true }} camera={{ position: [24, 18, 24], fov: 46 }}>
        <RogueScene />
      </Canvas>
      <RogueHud />
    </>
  );
}
