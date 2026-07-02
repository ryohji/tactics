// オフライン地形プレビュー（it-5）。terrain.ts が Three 非依存な点を使い、
// Node で Terrain.mesh() を焼き、自前ソフトレンダラ（zバッファ + Lambert）で
// 複数アングルの PNG に落とす。ブラウザ/WebGL 不要で地形のシルエットを反復確認できる。
//   実行: npm run preview:terrain [presetKey]   （引数なしで全プリセット）
//   出力: docs/qa/preview/<presetKey>/*.png
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCathedral, PRESETS, vaultCrownOf, type CathedralSpec } from '../src/model/cathedral';
import type { Terrain } from '../src/model/terrain';
import { buildArena } from '../src/model/fcc';

const SQRT2 = Math.SQRT2, SQRT3 = Math.sqrt(3), SQRT6 = Math.sqrt(6);
function toFrame(p: number[]): [number, number, number] {
  const [x, y, z] = p;
  return [(x - y) / SQRT2, (x + y + z) / SQRT3, (x + y - 2 * z) / SQRT6];
}

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

interface Scene { verts: V3[]; I: Uint32Array; center: V3; lo: V3; hi: V3; }

function toScene(terrain: Terrain, res: number): Scene {
  const mesh = terrain.mesh(res);
  const P = mesh.positions, I = mesh.indices;
  const verts: V3[] = [];
  for (let i = 0; i < P.length; i += 3) verts.push(toFrame([P[i], P[i + 1], P[i + 2]]));
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  const center: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  return { verts, I, center, lo, hi };
}

function render(sc: Scene, out: string, az: number, el: number, W = 640, H = 480) {
  const { verts, I, center, lo, hi } = sc;
  const ce = Math.cos(el), se = Math.sin(el);
  const eye: V3 = norm([ce * Math.sin(az), se, ce * Math.cos(az)]);
  const right = norm(cross([0, 1, 0], eye));
  const up = cross(eye, right);
  const light = norm([0.4 * Math.sin(az + 0.6) + 0.3, 0.8, 0.4 * Math.cos(az + 0.6)]);

  let rad = 0;
  for (const v of verts) rad = Math.max(rad, Math.hypot(v[0] - center[0], v[1] - center[1], v[2] - center[2]));
  const scale = (Math.min(W, H) * 0.46) / (rad || 1);

  const zbuf = new Float64Array(W * H).fill(-Infinity);
  const img = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 3; const t = y / H;
    img[o] = 18 + t * 14; img[o + 1] = 20 + t * 16; img[o + 2] = 28 + t * 20;
  }
  const proj = (v: V3): V3 => { const c = sub(v, center); return [dot(c, right) * scale + W / 2, -dot(c, up) * scale + H / 2, dot(c, eye)]; };

  for (let t = 0; t < I.length; t += 3) {
    const a = verts[I[t]], b = verts[I[t + 1]], c = verts[I[t + 2]];
    const n = norm(cross(sub(b, a), sub(c, a)));
    const shade = 0.22 + 0.78 * Math.abs(dot(n, light));
    const hgt = (a[1] + b[1] + c[1]) / 3;
    const tt = Math.max(0, Math.min(1, (hgt - lo[1]) / ((hi[1] - lo[1]) || 1)));
    const col: V3 = [(165 - tt * 35) * shade, (150 - tt * 30) * shade, (135 - tt * 20) * shade];
    const pa = proj(a), pb = proj(b), pc = proj(c);
    const minX = Math.max(0, Math.floor(Math.min(pa[0], pb[0], pc[0])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(pa[0], pb[0], pc[0])));
    const minY = Math.max(0, Math.floor(Math.min(pa[1], pb[1], pc[1])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(pa[1], pb[1], pc[1])));
    const area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const w0 = ((pb[0] - x) * (pc[1] - y) - (pb[1] - y) * (pc[0] - x)) / area;
      const w1 = ((pc[0] - x) * (pa[1] - y) - (pc[1] - y) * (pa[0] - x)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * pa[2] + w1 * pb[2] + w2 * pc[2];
      const di = y * W + x;
      if (z <= zbuf[di]) continue;
      zbuf[di] = z;
      const o = di * 3;
      img[o] = Math.min(255, col[0]); img[o + 1] = Math.min(255, col[1]); img[o + 2] = Math.min(255, col[2]);
    }
  }
  writePNG(out, W, H, img);
}

function writePNG(path: string, W: number, H: number, rgb: Uint8Array) {
  const raw = Buffer.alloc(H * (W * 3 + 1));
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; rgb.subarray(y * W * 3, (y + 1) * W * 3).forEach((v, i) => { raw[y * (W * 3 + 1) + 1 + i] = v; }); }
  const idat = deflateSync(raw);
  const crcTab = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const v of b) c = crcTab[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]));
}

const D = Math.PI / 180;
const ANGLES: ReadonlyArray<readonly [string, number, number]> = [
  ['collapse', -55 * D, 22 * D], // 南崩落から3/4
  ['intact', 125 * D, 22 * D],   // 北・後陣から3/4
  ['top', 0, 86 * D],            // 真上（平面図）
  ['nave', -90 * D, 8 * D],      // 西正面から内部を覗く
];

function previewPreset(key: string, spec: CathedralSpec, arena: { Hmax: number; Lmin: number; Lmax: number }, res: number) {
  const dir = resolve(process.cwd(), 'docs/qa/preview', key);
  mkdirSync(dir, { recursive: true });
  const terrain = buildCathedral(spec);
  const sc = toScene(terrain, res);
  const cells = buildArena(arena).size;
  const crown = vaultCrownOf(spec);
  console.log(`[${key}] 身廊長 ${spec.naveHalfLen * 2} / 幅 ${(spec.aisles ? spec.aisleHalfWidth : spec.naveHalfWidth) * 2} / 高 ${crown.toFixed(1)} セル, ` +
    `arena Hmax=${arena.Hmax} L=${arena.Lmin}..${arena.Lmax} → ${cells} セル, mesh ${sc.I.length / 3} tris`);
  for (const [name, az, el] of ANGLES) render(sc, resolve(dir, `cath_${name}.png`), az, el);
  console.log(`  → ${dir}`);
}

const arg = process.argv[2];
const keys = arg ? [arg] : Object.keys(PRESETS);
for (const k of keys) {
  const p = PRESETS[k];
  if (!p) { console.error(`unknown preset: ${k}（${Object.keys(PRESETS).join(', ')}）`); continue; }
  // 巨大プリセットは解像度を少し上げて細部を保つ。
  previewPreset(k, p.spec, p.arena, k === 'sistine' ? 150 : 120);
}
