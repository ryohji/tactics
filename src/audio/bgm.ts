// BGM(rogue-5 / rogue-12 で深度連動に拡張)。外部アセットなしの WebAudio 生成アンビエント。
// 「洞窟の環境音楽」を層の足し引きで組む。基本4層は常時:
//   drone: 低いうなり(デチューンした三角波のペア。ごく遅い LFO で息をさせる)
//   pad:   ゆっくり移り変わる和音(D エオリアの4和音を順に。長い AR エンベロープ)
//   drip:  ときどき落ちる水滴(高い正弦のピング + フィードバックディレイの残響)
//   wind:  奥から届く風(ループするノイズ + 揺れるバンドパス)
// 深度で徐々に加わる層(setBgmDepth。ゲームがターンごとに通知):
//   rhythm(3〜): 遠い太鼓の鼓動と石を打つ音。深いほど強く・複雑に
//   water (6〜): 流れる水のせせらぎ(帯域ノイズ2本の揺らぎ)
//   hum  (10〜): 女声ハミング風の旋律(フォルマントフィルタ+ビブラート。まれに歌う)
// 水滴は深いほど頻度が増え、風は深いほど低く強く唸る。
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

// ハミングの旋律(D ドリアンのペンタ寄り。フレーズはここからランダムウォーク)。
const HUM_NOTES = [57, 60, 62, 64, 65, 67, 69]; // A3 C4 D4 E4 F4 G4 A4

let started = false;
let muted = false;
let scene: BgmScene = 'game';
let depth = 0; // 現在深度(ゲームから setBgmDepth で通知)

let ctx: AudioContext | null = null;
let master: GainNode | null = null; // シーン音量 × ミュートの合成先
let color: BiquadFilterNode | null = null; // シーンのローパス
let dripBus: GainNode | null = null; // 水滴 → ディレイ残響の入口
let windBp: BiquadFilterNode | null = null; // 風の帯域(深度で低く)
let windGain: GainNode | null = null; // 風の強さ(深度で増す)
let rhythmGain: GainNode | null = null; // リズム層(深度3〜)
let waterGain: GainNode | null = null; // 流水層(深度6〜)
let humGain: GainNode | null = null; // ハミング層(深度10〜)
let timer: ReturnType<typeof setInterval> | null = null;
let chordIdx = 0;
let nextPad = 0;
let nextDrip = 0;
let nextBeat = 0;
let nextHum = 0;
let humNote = 62; // 旋律のランダムウォーク位置

/** 0..1 のフェード係数(from から span 深度かけて立ち上がる)。 */
function fade(from: number, span: number): number {
  return Math.max(0, Math.min(1, (depth - from) / span));
}

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

/** ループする白色ノイズ源を作る。 */
function noiseLoop(seconds = 2): AudioBufferSourceNode | null {
  if (!ctx) return null;
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

/** 風(常時)。ループノイズ + 揺れるバンドパス。深度で低く・強く(applyDepth)。 */
function startWind(): void {
  if (!ctx || !color) return;
  const src = noiseLoop(2);
  if (!src) return;
  windBp = ctx.createBiquadFilter();
  windBp.type = 'bandpass';
  windBp.frequency.value = 420;
  windBp.Q.value = 1.6;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.05;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 180;
  lfo.connect(lfoGain).connect(windBp.frequency);
  lfo.start();
  windGain = ctx.createGain();
  windGain.gain.value = 0.055;
  src.connect(windBp).connect(windGain).connect(color);
  src.start();
}

/** 流水(深度6〜)。帯域ノイズ2本のせせらぎ。振幅と帯域を別々の LFO で揺らす。 */
function startWater(): void {
  if (!ctx || !color) return;
  waterGain = ctx.createGain();
  waterGain.gain.value = 0; // applyDepth で開く
  for (const [freq, q, lfoF, lfoAmt, g0] of [
    [700, 2.5, 0.9, 220, 0.5],
    [1600, 4.0, 1.7, 500, 0.3],
  ] as const) {
    const src = noiseLoop(2.3);
    if (!src) return;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const fLfo = ctx.createOscillator();
    fLfo.frequency.value = lfoF;
    const fAmt = ctx.createGain();
    fAmt.gain.value = lfoAmt;
    fLfo.connect(fAmt).connect(bp.frequency);
    fLfo.start();
    const g = ctx.createGain();
    g.gain.value = g0;
    // 振幅も小さく揺らす(水面のちらつき)。
    const aLfo = ctx.createOscillator();
    aLfo.frequency.value = lfoF * 0.37;
    const aAmt = ctx.createGain();
    aAmt.gain.value = g0 * 0.35;
    aLfo.connect(aAmt).connect(g.gain);
    aLfo.start();
    src.connect(bp).connect(g).connect(waterGain);
    src.start();
  }
  waterGain.connect(color);
}

/** リズム層のバス(深度3〜)。中身は tick() が拍をスケジュールする。 */
function buildRhythmBus(): void {
  if (!ctx || !color) return;
  rhythmGain = ctx.createGain();
  rhythmGain.gain.value = 0;
  rhythmGain.connect(color);
}

/** ハミング層のバス(深度10〜)。残響(dripBus のディレイ)にも送る。 */
function buildHumBus(): void {
  if (!ctx || !color || !dripBus) return;
  humGain = ctx.createGain();
  humGain.gain.value = 0;
  humGain.connect(color);
  const wet = ctx.createGain();
  wet.gain.value = 0.8;
  humGain.connect(wet).connect(dripBus);
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

/** リズム1周期(2.4秒)。遠い太鼓の鼓動 + 深層では石を打つ音が混ざる。 */
function scheduleBeat(t0: number): void {
  if (!ctx || !rhythmGain) return;
  const thump = (t: number, peak: number) => {
    if (!ctx || !rhythmGain) return;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(58, t);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g).connect(rhythmGain);
    o.start(t);
    o.stop(t + 0.55);
  };
  const knock = (t: number, peak: number) => {
    if (!ctx || !rhythmGain) return;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(950 + Math.random() * 250, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    o.connect(g).connect(rhythmGain);
    o.start(t);
    o.stop(t + 0.08);
  };
  thump(t0, 0.75);
  // 深いほど裏拍と石音が加わる(判定はスケジュール時の深度)。
  if (depth >= 7) thump(t0 + 1.65, 0.4);
  if (depth >= 5 && Math.random() < 0.6) knock(t0 + 1.2, 0.05 + 0.03 * fade(5, 8));
  if (depth >= 12 && Math.random() < 0.5) knock(t0 + 2.0 + Math.random() * 0.2, 0.05);
}

/** ハミング1フレーズ(4〜7音のランダムウォーク)。声帯=三角波、口=フォルマント帯域。 */
function scheduleHum(t0: number): number {
  if (!ctx || !humGain) return 8;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  // ビブラート(5.3Hz・浅め)で「歌っている」気配を出す。
  const vib = ctx.createOscillator();
  vib.frequency.value = 5.3;
  const vibAmt = ctx.createGain();
  vib.connect(vibAmt).connect(o.frequency);
  vib.start(t0);
  // 閉口ハミングのフォルマント: 低い帯域が主、鼻腔の中域をわずかに。
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = 320;
  f1.Q.value = 4;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.frequency.value = 1150;
  f2.Q.value = 9;
  const f2g = ctx.createGain();
  f2g.gain.value = 0.25;
  const env = ctx.createGain();
  env.gain.value = 0;
  o.connect(f1).connect(env);
  o.connect(f2).connect(f2g).connect(env);
  env.connect(humGain);
  // フレーズ: 現在音からペンタ内を1〜2歩ずつ歩く。レガート(グライド)。
  const n = 4 + Math.floor(Math.random() * 4);
  let t = t0;
  o.frequency.setValueAtTime(hz(humNote), t);
  vibAmt.gain.setValueAtTime(0, t);
  for (let i = 0; i < n; i++) {
    const idx = HUM_NOTES.indexOf(humNote);
    const step = Math.floor(Math.random() * 5) - 2; // -2..+2
    humNote = HUM_NOTES[Math.max(0, Math.min(HUM_NOTES.length - 1, idx + step))];
    const dur = 1.1 + Math.random() * 1.3;
    o.frequency.setTargetAtTime(hz(humNote), t, 0.09); // なめらかに移る
    vibAmt.gain.setTargetAtTime(hz(humNote) * 0.006, t + 0.25, 0.3);
    t += dur;
  }
  const total = t - t0;
  env.gain.linearRampToValueAtTime(0.16, t0 + 1.4); // ゆっくり歌い出す
  env.gain.setValueAtTime(0.16, t0 + total - 1.2);
  env.gain.linearRampToValueAtTime(0, t0 + total);
  o.start(t0);
  o.stop(t0 + total + 0.2);
  vib.stop(t0 + total + 0.2);
  return total;
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
    // 深いほど水滴が増える(半分程度まで)。
    nextDrip += (2.5 + Math.random() * 6) / (1 + 0.6 * fade(2, 10));
  }
  while (nextBeat < ahead) {
    if (depth >= 3) scheduleBeat(Math.max(nextBeat, ctx.currentTime + 0.05));
    nextBeat += 2.4; // 深度が浅い間も刻みだけ進める(潜った瞬間から拍が合う)
  }
  while (nextHum < ahead) {
    if (depth >= 10 && Math.random() < 0.75) {
      const dur = scheduleHum(Math.max(nextHum, ctx.currentTime + 0.05));
      nextHum += dur + 10 + Math.random() * 18; // 歌い終わってしばらく沈黙
    } else {
      nextHum += 6; // まだ歌わない(次の判定まで少し待つ)
    }
  }
}

/** 深度に応じた層のバランスを適用する(なめらかに追従)。 */
function applyDepth(): void {
  if (!ctx) return;
  const t = ctx.currentTime;
  const ramp = 2.0;
  if (rhythmGain) rhythmGain.gain.setTargetAtTime(0.5 * fade(3, 7), t, ramp);
  if (waterGain) waterGain.gain.setTargetAtTime(0.05 * fade(6, 6), t, ramp * 1.5);
  if (humGain) humGain.gain.setTargetAtTime(0.55 * fade(10, 5), t, ramp * 1.5);
  if (windGain) windGain.gain.setTargetAtTime(0.055 * (1 + 0.9 * fade(4, 12)), t, ramp);
  if (windBp) windBp.frequency.setTargetAtTime(420 - 200 * fade(4, 12), t, ramp);
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
  buildRhythmBus();
  buildHumBus();
  startDrone();
  startWind();
  startWater();
  nextPad = ctx.currentTime + 0.3;
  nextDrip = ctx.currentTime + 2;
  nextBeat = ctx.currentTime + 1.2;
  nextHum = ctx.currentTime + 12;
  timer = setInterval(tick, 1000);
  tick();
  applyScene(2.5);
  applyDepth();
}

export function setBgmMuted(v: boolean): void {
  muted = v;
  applyScene(0.5);
}

export function setBgmScene(s: BgmScene): void {
  scene = s;
  applyScene();
}

/** 現在深度の通知(ゲームがターンごとに呼ぶ)。層のバランスがなめらかに追従する。 */
export function setBgmDepth(d: number): void {
  if (d === depth) return;
  depth = d;
  applyDepth();
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
  windBp = null;
  windGain = null;
  rhythmGain = null;
  waterGain = null;
  humGain = null;
}
