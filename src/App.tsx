import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { RogueScene } from './render/RogueScene';
import { RogueHud } from './ui/RogueHud';
import { TitleOverlay } from './ui/TitleOverlay';
import { useRogue } from './state/rogue';
import { installKeys } from './input/keys';
import { installTouchFlag } from './input/touch';
import { unlock } from './audio/sfx';
import { startBgm } from './audio/bgm';

// rogue-1 合成点。Canvas 内は <RogueScene/>(洞窟・敵・宝・マーカー・カメラ)。
// tactics(it-6)の Scene/GameHud/Controls は温存してあるが、このブランチでは配線しない。
// 効果音の unlock は毎 pointerdown で呼ぶ(once にしない)。AudioContext は
// ブラウザ都合で随時 suspended に戻りうる(タブ非表示・dev の HMR での作り直し等)ため、
// クリックのたびに resume を試みて自己回復させる。BGM も同じ操作で開始する
// (startBgm は冪等。初回はタイトルの「潜る」クリックがその操作になる)。
export function App() {
  useEffect(() => {
    // QA専用: ?qa のときだけストアを window に公開(ディザ調整のSelenium操作用。本番は無効)。
    if (new URLSearchParams(location.search).has('qa')) (window as unknown as { __rogue: typeof useRogue }).__rogue = useRogue;
    const onDown = () => {
      unlock();
      startBgm();
      // 歩行中の画面タップ/クリックはファストトラベルの中断(travelTo を起こす
      // マーカーのクリックは click で、busy 化はその後。この pointerdown が先に
      // 走る時点ではまだ非歩行なので、開始操作を誤って打ち切ることはない)。
      useRogue.getState().cancelTravel();
    };
    window.addEventListener('pointerdown', onDown);
    installTouchFlag();
    installKeys({
      onCycle: (dir) => useRogue.getState().cycleTarget(dir),
      onToggleMap: () => useRogue.getState().toggleMap(),
      onEscape: () => {
        const s = useRogue.getState();
        if (s.busy) s.cancelTravel();
        else if (s.uiMode !== 'walk') s.cancelThrow();
        else if (s.mapMode) s.toggleMap();
      },
    });
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);

  return (
    <>
      {/* stencil: カットアウェイの断面キャップ用(three r163+ は既定 off)。
          WebGL コンテキストは canvas 生成時にしか属性を変えられないため、key で
          強制的に作り直す(HMR で生き残った stencil 無しの古いコンテキスト対策。
          key を変えれば開きっぱなしのタブでも新コンテキストになる)。 */}
      <Canvas key="gl-stencil-1" gl={{ stencil: true }} camera={{ position: [24, 18, 24], fov: 46 }}>
        <RogueScene />
      </Canvas>
      <RogueHud />
      <TitleOverlay />
    </>
  );
}
