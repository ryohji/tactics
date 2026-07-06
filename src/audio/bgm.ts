// BGM(rogue-5)。外部アセットなしの WebAudio 生成アンビエント。
// 拍もメロディも持たない「洞窟の環境音楽」を4層で鳴らし続ける:
//   drone: 低いうなり(デチューンした三角波のペア。ごく遅い LFO で息をさせる)
//   pad:   ゆっくり移り変わる和音(D エオリアの4和音を順に。長い AR エンベロープ)
//   drip:  ときどき落ちる水滴(高い正弦のピング + フィードバックディレイの残響)
//   wind:  奥から届く風(ループするノイズ + 揺れるバンドパス)
// AudioContext は sfx と共有(自動再生制限の unlock も共通)。
// scene で質感を変える: map=ローパスでこもらせる(俯瞰の距離感) / dead=沈める。
// Node/テスト環境では audioContext() が null を返すので全 API が no-op。

import { audioContext } from './sfx';

export type BgmScene = 'game' | 'map' | 'dead';

const MASTER = 0.13;
/** シーンごとの音量係数とローパスの明るさ。 */
const SCENE: Record<BgmScene, { gain: number; cutoff: number }> = {
  game: { gain: 1.0, cutoff: 14000 },
  map: { gain: 0.75, cutoff: 850 },
  dead: { gain: 0.45, cutoff: 420 },
};

/** MIDI ノート番号 → 周波数。 */
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

// D エオリアから拾った4和音の循環。重心を行き来させて「潜っていく」空気に。
const CHORDS: number[][] = [
  [50, 57, 62, 64], // Dm9  (D3 A3 D4 E4)
  [46, 53, 58, 65], // B♭maj7(B♭2 F3 B♭3 F4)
  [43, 50, 58, 62], // Gm   (G2 D3 B♭3 D4)
  [45, 52, 57, 60], // Asus♭6(A2 E3 A3 C4)
];

let started = false;
let muted = false;
let scene: BgmScene = 'game';

let ctx: AudioContext | null = null;
let master: GainNode | null = null; // シーン音量 × ミュートの合成先
let color: BiquadFilterNode | null = null; // シーンのローパス
let dripBus: GainNode | null = null; // 水滴 → ディレイ残響の入口
let timer: ReturnType<typeof setInterval> | null = null;
let chordIdx = 0;
let nextPad = 0;
let nextDrip = 0;

function applyScene(ramp = 1.2): void {
  if (!ctx || !master || !color) return;
  const t = ctx.currentTime;
  const g = muted ? 0 : MASTER * SCENE[scene].gain;
  master.gain.cancelScheduledValues(t);
  master.gain.setTargetAtTime(g, t, ramp * 0.25);
  color.frequency.cancelScheduledValues(t);
  color.frequency.setTargetAtTime(SCENE[scene].cutoff, t, ramp * 0.3);
}

/** 低音ドローン(常時)。デチューンのうなり + 超低速 LFO の呼吸。 */
function startDrone(): void {
  if (!ctx || !color) return;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 260;
  const g = ctx.createGain();
  g.gain.value = 0.5;
  // LFO(0.06Hz)でドローン全体をゆっくり明滅させる。
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.06;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.18;
  lfo.connect(lfoGain).connect(g.gain);
  lfo.start();
  for (const f of [hz(38), hz(38) * 1.007, hz(45) * 0.5]) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    o.connect(lp);
    o.start();
  }
  lp.connect(g).connect(color);
}

/** 風(常時)。ループノイズ + 揺れるバンドパス。 */
function startWind(): void {
  if (!ctx || !color) return;
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 420;
  bp.Q.value = 1.6;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.05;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 180;
  lfo.connect(lfoGain).connect(bp.frequency);
  lfo.start();
  const g = ctx.createGain();
  g.gain.value = 0.055;
  src.connect(bp).connect(g).connect(color);
  src.start();
}

/** 水滴の残響ディレイ(共有)。drip はここへ送る。 */
function buildDripBus(): void {
  if (!ctx || !color) return;
  dripBus = ctx.createGain();
  dripBus.gain.value = 1;
  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = 0.34;
  const fb = ctx.createGain();
  fb.gain.value = 0.42;
  const wet = ctx.createGain();
  wet.gain.value = 0.6;
  dripBus.connect(color); // 直接音
  dripBus.connect(delay);
  delay.connect(fb).connect(delay); // フィードバック
  delay.connect(wet).connect(color);
}

/** 和音1回分をスケジュールする(長い山なりのエンベロープ)。 */
function schedulePad(t0: number, notes: number[]): void {
  if (!ctx || !color) return;
  const dur = 14;
  for (const [i, m] of notes.entries()) {
    // 各声部に本体 + わずかにずらした影を重ねてコーラス感を出す。
    for (const det of [1, 1.004]) {
      const o = ctx.createOscillator();
      o.type = i === notes.length - 1 ? 'sine' : 'triangle';
      o.frequency.value = hz(m) * det;
      const g = ctx.createGain();
      const peak = (0.05 + 0.012 * i) * (det === 1 ? 1 : 0.6);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + 4.5);
      g.gain.setValueAtTime(peak, t0 + dur - 6);
      g.gain.linearRampToValueAtTime(0, t0 + dur);
      o.connect(g).connect(color);
      o.start(t0);
      o.stop(t0 + dur + 0.1);
    }
  }
}

/** 水滴1粒。 */
function scheduleDrip(t0: number): void {
  if (!ctx || !dripBus) return;
  const f = 1300 + Math.random() * 1500;
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(f, t0);
  o.frequency.exponentialRampToValueAtTime(f * 0.55, t0 + 0.09);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.10 + Math.random() * 0.05, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.12);
  o.connect(g).connect(dripBus);
  o.start(t0);
  o.stop(t0 + 0.15);
}

/** 先読みスケジューラ(1秒おきに2秒先まで埋める)。 */
function tick(): void {
  if (!ctx) return;
  const ahead = ctx.currentTime + 2;
  while (nextPad < ahead) {
    schedulePad(Math.max(nextPad, ctx.currentTime + 0.05), CHORDS[chordIdx]);
    chordIdx = (chordIdx + 1) % CHORDS.length;
    nextPad += 10; // 14秒の和音を10秒間隔で(クロスフェード)
  }
  while (nextDrip < ahead) {
    scheduleDrip(Math.max(nextDrip, ctx.currentTime + 0.05));
    nextDrip += 2.5 + Math.random() * 6;
  }
}

/** 初回ユーザ操作の後に呼ぶ(何度呼んでもよい)。 */
export function startBgm(): void {
  if (started) return;
  ctx = audioContext();
  if (!ctx) return;
  started = true;
  master = ctx.createGain();
  master.gain.value = 0; // applyScene でフェードイン
  master.connect(ctx.destination);
  color = ctx.createBiquadFilter();
  color.type = 'lowpass';
  color.frequency.value = SCENE.game.cutoff;
  color.connect(master);
  buildDripBus();
  startDrone();
  startWind();
  nextPad = ctx.currentTime + 0.3;
  nextDrip = ctx.currentTime + 2;
  timer = setInterval(tick, 1000);
  tick();
  applyScene(2.5);
}

export function setBgmMuted(v: boolean): void {
  muted = v;
  applyScene(0.5);
}

export function setBgmScene(s: BgmScene): void {
  scene = s;
  applyScene();
}

/** テスト・HMR 用の停止。 */
export function stopBgm(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  if (master && ctx) master.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
  started = false;
  master = null;
  color = null;
  dripBus = null;
}
