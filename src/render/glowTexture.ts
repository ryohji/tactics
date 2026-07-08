// 放射グラデーションのグローテクスチャ(rogue-5)。外部アセットなしで
// canvas から生成し、加算合成スプライトの「にじむ光」に使う(遅延生成・共有)。

import * as THREE from 'three';

let tex: THREE.CanvasTexture | null = null;

export function glowTexture(): THREE.CanvasTexture {
  if (tex) return tex;
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.16)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  tex = new THREE.CanvasTexture(cv);
  return tex;
}
