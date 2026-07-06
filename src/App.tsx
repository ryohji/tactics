import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { RogueScene } from './render/rogue/RogueScene';
import { RogueHud } from './ui/RogueHud';
import { useRogue } from './state/rogue';
import { installKeys } from './input/keys';
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
    const onDown = () => {
      unlock();
      startBgm();
    };
    window.addEventListener('pointerdown', onDown);
    installKeys({
      onCycle: () => useRogue.getState().cycleTarget(),
      onToggleMap: () => useRogue.getState().toggleMap(),
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

/** 初回だけのタイトル画面。「潜る」クリックが音の自動再生制限の解除も兼ねる。 */
function TitleOverlay() {
  const [entered, setEntered] = useState(false);
  if (entered) return null;
  return (
    <div className="hud-title">
      <div className="hud-title-inner">
        <div className="hud-title-sub">FCC ROGUE</div>
        <h1>蟻巣迷宮</h1>
        <p>
          面心立方の巣を、たいまつひとつで潜る。
          <br />
          明かりを広げれば癒えるが、目立つ。どこまで深く行けるか。
        </p>
        <button
          className="primary"
          onClick={() => {
            unlock();
            startBgm();
            setEntered(true);
          }}
        >
          潜る
        </button>
        <div className="hud-title-hint">ドラッグ=視点 / 青マーカー=移動 / M=マップ / TAB=敵に視線</div>
      </div>
    </div>
  );
}
