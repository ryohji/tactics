// 岩肌マテリアル(rogue-13/17)。標準材質に onBeforeCompile でトライプレーナーの
// ノイズを注入する: UV の無い結合メッシュでも、世界座標の3軸投影を面法線で
// ブレンドしてサンプリングできる。頂点カラー(深度・訪問ティント)には乗算で
// 重なる。ノイズ1枚を 色ムラ(2スケール)/擬似バンプ/粗さ変調 に共用。

import * as THREE from 'three';
import { ROGUE_S } from '../../state/rogue';
import { rockTexture } from './rockTexture';

export function makeRockMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.02,
    flatShading: true,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.rockMap = { value: rockTexture() };
    shader.uniforms.rockScale = { value: 0.21 / ROGUE_S }; // 世界座標 → UV
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
varying vec3 vRockPos;
float rockTri(vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(3.0));
  w /= (w.x + w.y + w.z);
  return texture2D(rockMap, p.zy * rockScale).r * w.x
       + texture2D(rockMap, p.xz * rockScale).r * w.y
       + texture2D(rockMap, p.xy * rockScale).r * w.z;
}`,
      )
      // 色ムラ: 粗いスケール(岩の縞)+細かいスケール(粒)を乗算。
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
{
  vec3 fn = normalize(cross(dFdx(vRockPos), dFdy(vRockPos)));
  float h1 = rockTri(vRockPos, fn);
  float h2 = rockTri(vRockPos * 3.1 + 17.3, fn);
  diffuseColor.rgb *= mix(0.72, 1.24, h1) * mix(0.88, 1.09, h2);
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
