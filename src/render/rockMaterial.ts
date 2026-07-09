// 岩肌マテリアル(rogue-13/17)。標準材質に onBeforeCompile でトライプレーナーの
// ノイズを注入する: UV の無い結合メッシュでも、世界座標の3軸投影を面法線で
// ブレンドしてサンプリングできる。頂点カラー(深度・訪問ティント)には乗算で
// 重なる。ノイズ1枚を 色ムラ(2スケール)/擬似バンプ/粗さ変調 に共用。

import * as THREE from 'three';
import { ROGUE_S } from '../state/rogue';
import { rockTexture } from './rockTexture';

/**
 * プレイヤー中心ディザ透過の uniform 群。DungeonShell が毎フレーム uPlayerPos を更新する。
 * iter2: 砂嵐状の粒(discard ディザ)が気になるとのフィードバックを受け、
 * uDitherMode で discard ディザ/alpha半透明/ハイブリッドを切り替えられるようにした。
 * alpha を使うモード(1・2)では material.transparent=true が必須(呼び出し側で設定)。
 */
export interface RockDitherUniforms {
  uPlayerPos: { value: THREE.Vector3 };
  uFadeInner: { value: number };
  uFadeOuter: { value: number };
  uFadeMax: { value: number };
  /** 0=ディザ(discard)のみ / 1=alpha半透明のみ / 2=ハイブリッド(内側alpha+外周を軽くディザ)。 */
  uDitherMode: { value: number };
  /** iter3: 1=カメラ側半球のみフェード(既定) / 0=全球フェード(QA比較用、旧挙動)。 */
  uHemiOn: { value: number };
}

export function makeRockMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.02,
    flatShading: true,
  });
  const dither: RockDitherUniforms = {
    uPlayerPos: { value: new THREE.Vector3() },
    uFadeInner: { value: 0.6 * ROGUE_S },
    uFadeOuter: { value: 3.2 * ROGUE_S },
    uFadeMax: { value: 0.85 },
    uDitherMode: { value: 1 }, // 既定=alpha 半透明(DungeonShell が毎フレーム上書き)
    uHemiOn: { value: 1 }, // 既定=カメラ側半球のみフェード
  };
  m.userData.dither = dither;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.rockMap = { value: rockTexture() };
    shader.uniforms.rockScale = { value: 0.21 / ROGUE_S }; // 世界座標 → UV
    Object.assign(shader.uniforms, dither);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockPos;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvRockPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform sampler2D rockMap;
uniform float rockScale;
uniform vec3 uPlayerPos;
uniform float uFadeInner;
uniform float uFadeOuter;
uniform float uFadeMax;
uniform float uDitherMode;
uniform float uHemiOn;
varying vec3 vRockPos;
// clipping 直後で決めたフェード量(0..1)を color_fragment 側の alpha 計算へ橋渡しする
// ファイルスコープ変数(main() 内の別ブロックからも参照できるよう、ネストした{}の外に置く)。
float gFadeP;
float rockTri(vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(3.0));
  w /= (w.x + w.y + w.z);
  return texture2D(rockMap, p.zy * rockScale).r * w.x
       + texture2D(rockMap, p.xz * rockScale).r * w.y
       + texture2D(rockMap, p.xy * rockScale).r * w.z;
}`,
      )
      // プレイヤー中心の距離フェード。近い壁ほど gFadeP が大きくなる。
      // iter3: 「背後の壁まで抜けて見える」というフィードバックを受け、フェードを
      // カメラ側の半球だけに限定する。cameraPosition は three 組み込みのワールド座標
      // uniform(追加宣言不要)。frontness はプレイヤーから見て「フラグメント方向」と
      // 「カメラ方向」のなす角の cos(1=カメラ真正面、-1=真後ろ)。赤道(frontness=0)付近を
      // smoothstep で滑らかに閉じ、背後(frontness が負)はフェードを完全に切る。
      // モード0: スクリーンドア discard で間引く(iter1)。
      // モード1: discard せず gFadeP を color_fragment で alpha に反映(半透明)。
      // モード2: 内側は alpha 任せ、不透明に戻る境目だけ軽く discard してバンディングを隠す。
      .replace(
        '#include <clipping_planes_fragment>',
        /* glsl */ `#include <clipping_planes_fragment>
{
  float d = distance(vRockPos, uPlayerPos);
  vec3 toFrag = vRockPos - uPlayerPos;
  vec3 toCam = cameraPosition - uPlayerPos;
  float frontness = (length(toFrag) > 1e-4 && length(toCam) > 1e-4)
    ? dot(normalize(toFrag), normalize(toCam))
    : 0.0;
  gFadeP = uFadeMax * (1.0 - smoothstep(uFadeInner, uFadeOuter, d));
  float hemiT = mix(1.0, smoothstep(-0.15, 0.25, frontness), uHemiOn); // QA: uHemiOn=0 で全球(旧挙動)に戻せる
  gFadeP *= hemiT;
  float bayer = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  if (uDitherMode < 0.5) {
    if (bayer < gFadeP) discard;
  } else if (uDitherMode > 1.5) {
    float edgeDiscardP = (1.0 - smoothstep(0.0, 0.2, gFadeP)) * 0.4;
    if (bayer < edgeDiscardP) discard;
  }
}`,
      )
      // 色ムラ: 粗いスケール(岩の縞)+細かいスケール(粒)を乗算。alpha モードはここで
      // diffuseColor.a を距離フェードに応じて下げる(discard を伴わない滑らかな透過)。
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
{
  vec3 fn = normalize(cross(dFdx(vRockPos), dFdy(vRockPos)));
  float h1 = rockTri(vRockPos, fn);
  float h2 = rockTri(vRockPos * 3.1 + 17.3, fn);
  diffuseColor.rgb *= mix(0.72, 1.24, h1) * mix(0.88, 1.09, h2);
  if (uDitherMode > 0.5) {
    diffuseColor.a *= (1.0 - gFadeP);
  }
}`,
      )
      // 粗さ変調: 明るい斑をわずかに滑らかに(濡れた鉱物面の気配)。
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
{
  vec3 fnR = normalize(cross(dFdx(vRockPos), dFdy(vRockPos)));
  roughnessFactor = clamp(roughnessFactor * mix(1.05, 0.78, rockTri(vRockPos * 1.3 + 7.7, fnR)), 0.1, 1.0);
}`,
      )
      // 擬似バンプ: 高さのスクリーン微分で法線を曲げる(three の bumpmap と同じ手法)。
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
{
  float hb = rockTri(vRockPos * 1.9 + 31.7, normal);
  vec2 dH = vec2(dFdx(hb), dFdy(hb)) * 0.85;
  vec3 sX = dFdx(-vViewPosition);
  vec3 sY = dFdy(-vViewPosition);
  vec3 r1 = cross(sY, normal);
  vec3 r2 = cross(normal, sX);
  float det = dot(sX, r1);
  det *= float(gl_FrontFacing) * 2.0 - 1.0;
  vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
  normal = normalize(abs(det) * normal - grad);
}`,
      );
  };
  return m;
}
