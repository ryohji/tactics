// ポストエフェクト(rogue-5 / rogue-13 で SSAO 追加)。
//   N8AO: 岩の凹凸・装飾の接地に環境遮蔽の陰影(halfRes+performance でモバイル配慮)
//   Bloom: 炎・クリスタル・魔法の発光 / Vignette: 洞窟の「視界の閉じ」
// 注意: カットアウェイの断面キャップはステンシルに依存するため、コンポーザの
// フレームバッファにも stencilBuffer が必要(無いとキャップが全面に出る)。
// HDR パイプラインでは既定でトーンマッピングが外れるので ToneMapping を最後に足し、
// 素の描画(postFx オフ時)と見た目を揃える。重い環境向けに ✨ ボタンで切れる。

import { EffectComposer, N8AO, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useRogue, ROGUE_S } from '../state/rogue';

export function RoguePostFx() {
  const postFx = useRogue((s) => s.postFx);
  const mapMode = useRogue((s) => s.mapMode);
  if (!postFx) return null;
  return (
    <EffectComposer stencilBuffer multisampling={4}>
      <N8AO
        halfRes
        quality="performance"
        aoRadius={1.1 * ROGUE_S}
        intensity={2.6}
        distanceFalloff={0.6 * ROGUE_S}
      />
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
