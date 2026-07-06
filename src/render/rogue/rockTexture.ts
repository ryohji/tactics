// 岩肌ノイズテクスチャ(rogue-13)。外部アセットなしで canvas から生成する
// タイル化 FBM(周期格子の値ノイズ×5オクターブ)。グレースケール1枚を
// トライプレーナーの色ムラ・擬似バンプ・粗さ変調に共用する(遅延生成・共有)。

import * as THREE from 'three';

let tex: THREE.CanvasTexture | null = null;

export function rockTexture(): THREE.CanvasTexture {
  if (tex) return tex;
  const size = 256;
  const period = 8; // 基本格子の周期(2の冪でオクターブも周期化 → シームレス)
  const octaves = 5;

  // seed 固定の LCG(生成のたびに同じ模様)。
  let s = 0x1234abcd;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const lattices: Float32Array[] = [];
  for (let o = 0; o < octaves; o++) {
    const n = period << o;
    const g = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) g[i] = rand();
    lattices.push(g);
  }
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const sample = (o: number, x: number, y: number) => {
    const n = period << o;
    const g = lattices[o];
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const x0 = ((xi % n) + n) % n;
    const y0 = ((yi % n) + n) % n;
    const x1 = (x0 + 1) % n;
    const y1 = (y0 + 1) % n;
    const a = g[y0 * n + x0];
    const b = g[y0 * n + x1];
    const c = g[y1 * n + x0];
    const d = g[y1 * n + x1];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };

  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g2d = cv.getContext('2d')!;
  const img = g2d.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 1;
      let tot = 0;
      for (let o = 0; o < octaves; o++) {
        const n = period << o;
        v += sample(o, (x / size) * n, (y / size) * n) * amp;
        tot += amp;
        amp *= 0.55;
      }
      v /= tot;
      v = Math.min(1, Math.max(0, (v - 0.5) * 1.7 + 0.5)); // 斑を立てる
      const p = (y * size + x) * 4;
      const b = Math.round(v * 255);
      img.data[p] = b;
      img.data[p + 1] = b;
      img.data[p + 2] = b;
      img.data[p + 3] = 255;
    }
  }
  g2d.putImageData(img, 0, 0);
  tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace; // 高さデータとして扱う(色空間変換しない)
  return tex;
}
