// ポストエフェクト(rogue-5)。ブルームで炎・クリスタル・魔法を発光させ、
// ビネットで洞窟の「視界の閉じ」を作る。
// 注意: カットアウェイの断面キャップはステンシルに依存するため、コンポーザの
// フレームバッファにも stencilBuffer が必要(無いとキャップが全面に出る)。
// HDR パイプラインでは既定でトーンマッピングが外れるので ToneMapping を最後に足し、
// 素の描画(postFx オフ時)と見た目を揃える。重い環境向けに ✨ ボタンで切れる。

import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useRogue } from '../../state/rogue';

export function RoguePostFx() {
  const postFx = useRogue((s) => s.postFx);
  const mapMode = useRogue((s) => s.mapMode);
  if (!postFx) return null;
  return (
    <EffectComposer stencilBuffer multisampling={4}>
      <Bloom
        mipmapBlur
        intensity={mapMode ? 0.45 : 0.95}
        luminanceThreshold={0.55}
        luminanceSmoothing={0.3}
      />
      <Vignette eskil={false} offset={0.26} darkness={mapMode ? 0.5 : 0.72} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
