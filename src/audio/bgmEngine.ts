// BGM 生成エンジン(rogue-16 で bgm.ts から切り出し)。
// 音階・和音・音色・リズム型を BgmStyle のデータとして受け取り、WebAudio で層を組む。
// 層構成は bgm.ts 時代と同じ発想:
//   常時: drone(またはタンプーラ) / pad(和音) / drip(水滴) / wind(風)
//   深度でフェードイン: rhythm(打楽器) / water(流水) / melody(旋律)
// ゲームは bgm.ts のラッパ経由で「洞窟」スタイルを使い、bgm.html の試聴ページは
// 全スタイルを直接生成・破棄する。Node/テスト環境では audioContext() が null を
// 返すので createBgmEngine は null を返す(呼び出し側はすべて no-op になる)。

import { audioContext } from './sfx';

export type BgmScene = 'game' | 'map' | 'dead';

export type RhythmKind = 'thump' | 'knock' | 'frame' | 'dum' | 'tek' | 'baya' | 'tabla';

/** リズム1打。at は周期内の位置(秒)。 */
export type RhythmHit = {
  at: number;
  kind: RhythmKind;
  peak: number;
  minDepth?: number; // この深度に達してから鳴る(深いほどパターンが埋まる)
  prob?: number; // 毎周期の発音確率(揺らぎ)
  jitter?: number; // at のランダムな揺らぎ(秒)
};

export type MelodyVoice = 'hum' | 'whistle' | 'ney' | 'pluck';

export type BgmStyle = {
  id: string;
  label: string;
  desc: string;
  /** パッド和音の循環(MIDI。小数で四分音を表せる)。空配列なら無し。 */
  chords: number[][];
  /** ドローン(MIDI)。先頭音にはデチューンした影が重なりうなりを作る。空なら無し。 */
  drone: number[];
  /** タンプーラ(周期的な爪弾きの循環)。インド風のドローン代替。 */
  tanpura?: { notes: number[]; step: number };
  melody: {
    notes: number[]; // ランダムウォークする音域(MIDI。小数=四分音可)
    voice: MelodyVoice;
    from: number; // この深度からフェードイン
    span: number; // フェードインに要する深度幅
    level: number;
    ornament?: boolean; // 装飾音(ホイッスルのカット)
    glide?: boolean; // 音間を滑らかに繋ぐ(シタールのミーンド)
  };
  rhythm: {
    period: number; // 1周期(秒)
    pattern: RhythmHit[];
    from: number;
    span: number;
    level: number;
  };
  /** 環境層(風・流水・水滴)の係数。洞窟=1。 */
  ambience: { wind: number; water: number; drip: number };
  /** UI 表示用: 深度で加わる層の説明。 */
  layers: { from: number; label: string }[];
};

const MASTER = 0.13;
/** シーンごとの音量係数とローパスの明るさ。 */
const SCENE: Record<BgmScene, { gain: number; cutoff: number }> = {
  game: { gain: 1.0, cutoff: 14000 },
  map: { gain: 0.75, cutoff: 850 },
  dead: { gain: 0.45, cutoff: 420 },
};

/** MIDI ノート番号 → 周波数(小数を許すので四分音も表せる)。 */
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

export type BgmEngine = {
  setDepth(d: number): void;
  setScene(s: BgmScene): void;
  setMuted(v: boolean): void;
  dispose(): void;
};

export function createBgmEngine(
  style: BgmStyle,
  init?: { depth?: number; scene?: BgmScene; muted?: boolean },
): BgmEngine | null {
  const ac = audioContext();
  if (!ac) return null;
  const ctx: AudioContext = ac; // 以降のクロージャでも non-null を保つ

  let depth = init?.depth ?? 0;
  let scene: BgmScene = init?.scene ?? 'game';
  let muted = init?.muted ?? false;

  // 破棄時に止める常駐ソース(オシレータ・ループノイズ・LFO)。
  const live: AudioScheduledSourceNode[] = [];

  const master = ctx.createGain();
  master.gain.value = 0; // applyScene でフェードイン
  master.connect(ctx.destination);
  const color = ctx.createBiquadFilter();
  color.type = 'lowpass';
  color.frequency.value = SCENE[scene].cutoff;
  color.connect(master);

  let dripBus: GainNode | null = null;
  let windBp: BiquadFilterNode | null = null;
  let windGain: GainNode | null = null;
  let rhythmGain: GainNode | null = null;
  let waterGain: GainNode | null = null;
  let melGain: GainNode | null = null;

  let chordIdx = 0;
  let tanpuraIdx = 0;
  let nextPad = 0;
  let nextDrip = 0;
  let nextBeat = 0;
  let nextMel = 0;
  let nextTanpura = 0;
  let melNote = style.melody.notes[Math.floor(style.melody.notes.length / 2)];

  /** 0..1 のフェード係数(from から span 深度かけて立ち上がる)。 */
  const fade = (from: number, span: number) =>
    Math.max(0, Math.min(1, (depth - from) / span));

  function applyScene(ramp = 1.2): void {
    const t = ctx.currentTime;
    const g = muted ? 0 : MASTER * SCENE[scene].gain;
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(g, t, ramp * 0.25);
    color.frequency.cancelScheduledValues(t);
    color.frequency.setTargetAtTime(SCENE[scene].cutoff, t, ramp * 0.3);
  }

  /** 深度に応じた層のバランスを適用する(なめらかに追従)。 */
  function applyDepth(): void {
    const t = ctx.currentTime;
    const ramp = 2.0;
    const r = style.rhythm;
    const m = style.melody;
    if (rhythmGain) rhythmGain.gain.setTargetAtTime(r.level * fade(r.from, r.span), t, ramp);
    if (waterGain)
      waterGain.gain.setTargetAtTime(0.05 * style.ambience.water * fade(6, 6), t, ramp * 1.5);
    if (melGain) melGain.gain.setTargetAtTime(m.level * fade(m.from, m.span), t, ramp * 1.5);
    if (windGain)
      windGain.gain.setTargetAtTime(
        0.055 * style.ambience.wind * (1 + 0.9 * fade(4, 12)),
        t,
        ramp,
      );
    if (windBp) windBp.frequency.setTargetAtTime(420 - 200 * fade(4, 12), t, ramp);
  }

  /** 低音ドローン。デチューンのうなり + 超低速 LFO の呼吸。 */
  function startDrone(): void {
    if (style.drone.length === 0) return;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.18;
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();
    live.push(lfo);
    const freqs = style.drone.map(hz);
    freqs.splice(1, 0, freqs[0] * 1.007); // 先頭音の影(うなり)
    for (const f of freqs) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.connect(lp);
      o.start();
      live.push(o);
    }
    lp.connect(g).connect(color);
  }

  /** ループする白色ノイズ源。 */
  function noiseLoop(seconds = 2): AudioBufferSourceNode {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  // tek 用の短いノイズバースト素材(共有)。
  const burstBuf = (() => {
    const len = Math.floor(ctx.sampleRate * 0.1);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    return buf;
  })();

  /** 風(常時)。ループノイズ + 揺れるバンドパス。深度で低く・強く(applyDepth)。 */
  function startWind(): void {
    const src = noiseLoop(2);
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
    live.push(lfo);
    windGain = ctx.createGain();
    windGain.gain.value = 0.055 * style.ambience.wind;
    src.connect(windBp).connect(windGain).connect(color);
    src.start();
    live.push(src);
  }

  /** 流水(深度6〜)。帯域ノイズ2本のせせらぎ。 */
  function startWater(): void {
    waterGain = ctx.createGain();
    waterGain.gain.value = 0; // applyDepth で開く
    for (const [freq, q, lfoF, lfoAmt, g0] of [
      [700, 2.5, 0.9, 220, 0.5],
      [1600, 4.0, 1.7, 500, 0.3],
    ] as const) {
      const src = noiseLoop(2.3);
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
      live.push(fLfo);
      const g = ctx.createGain();
      g.gain.value = g0;
      const aLfo = ctx.createOscillator();
      aLfo.frequency.value = lfoF * 0.37;
      const aAmt = ctx.createGain();
      aAmt.gain.value = g0 * 0.35;
      aLfo.connect(aAmt).connect(g.gain);
      aLfo.start();
      live.push(aLfo);
      src.connect(bp).connect(g).connect(waterGain);
      src.start();
      live.push(src);
    }
    waterGain.connect(color);
  }

  /** 水滴の残響ディレイ(共有)。drip と旋律のウェットはここへ送る。 */
  function buildDripBus(): void {
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

  function buildBuses(): void {
    rhythmGain = ctx.createGain();
    rhythmGain.gain.value = 0;
    rhythmGain.connect(color);
    melGain = ctx.createGain();
    melGain.gain.value = 0;
    melGain.connect(color);
    if (dripBus) {
      const wet = ctx.createGain();
      wet.gain.value = 0.8;
      melGain.connect(wet).connect(dripBus);
    }
  }

  /** 和音1回分(長い山なりのエンベロープ)。 */
  function schedulePad(t0: number, notes: number[]): void {
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
    if (!dripBus) return;
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

  /** リズム1打を種類別に合成する。 */
  function hitNote(kind: RhythmKind, t: number, peak: number): void {
    if (!rhythmGain) return;
    const out = rhythmGain;
    const tone = (
      type: OscillatorType,
      f0: number,
      f1: number | null,
      dur: number,
      p: number,
      bend = 'exp' as 'exp' | 'lin',
    ) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== null) {
        if (bend === 'exp') o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
        else o.frequency.linearRampToValueAtTime(f1, t + dur * 0.6);
      }
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(p, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    switch (kind) {
      case 'thump': // 遠い太鼓の鼓動(洞窟)
        tone('sine', 58, 36, 0.5, peak);
        break;
      case 'knock': // 石を打つ音
        tone('triangle', 950 + Math.random() * 250, null, 0.055, peak);
        break;
      case 'frame': // バウロン(枠太鼓)の中低音
        tone('sine', 115, 68, 0.26, peak);
        break;
      case 'dum': // ダラブッカの低音
        tone('sine', 175, 72, 0.3, peak);
        break;
      case 'tek': {
        // ダラブッカの縁打ち: ノイズバースト + 高い短音
        const src = ctx.createBufferSource();
        src.buffer = burstBuf;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 3200;
        const g = ctx.createGain();
        g.gain.setValueAtTime(peak, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        src.connect(hp).connect(g).connect(out);
        src.start(t);
        src.stop(t + 0.08);
        tone('triangle', 2300, null, 0.03, peak * 0.5);
        break;
      }
      case 'baya': // タブラーの左手(音程がせり上がる)
        tone('sine', 82, 118, 0.38, peak, 'lin');
        break;
      case 'tabla': // タブラーの右手(澄んだ響き)
        tone('sine', 545, null, 0.14, peak);
        tone('sine', 1090, null, 0.08, peak * 0.35);
        break;
    }
  }

  /** リズム1周期分をパターンから鳴らす。深度で打点が増える。 */
  function scheduleBar(t0: number): void {
    for (const h of style.rhythm.pattern) {
      if (h.minDepth !== undefined && depth < h.minDepth) continue;
      if (h.prob !== undefined && Math.random() >= h.prob) continue;
      hitNote(h.kind, t0 + h.at + (h.jitter ? Math.random() * h.jitter : 0), h.peak);
    }
  }

  /** タンプーラ1音。ローパスの開閉でジャワリ(倍音のうねり)を模す。 */
  function scheduleTanpura(t0: number): void {
    const tp = style.tanpura;
    if (!tp) return;
    const f = hz(tp.notes[tanpuraIdx]);
    tanpuraIdx = (tanpuraIdx + 1) % tp.notes.length;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(f * 2, t0);
    lp.frequency.linearRampToValueAtTime(f * 9, t0 + 0.5);
    lp.frequency.exponentialRampToValueAtTime(f * 2, t0 + 2.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.05, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 2.6);
    o.connect(lp).connect(g).connect(color);
    o.start(t0);
    o.stop(t0 + 2.7);
  }

  /** 旋律のランダムウォークを1歩進める。 */
  function walk(maxStep = 2): number {
    const pool = style.melody.notes;
    const idx = pool.indexOf(melNote);
    const step = Math.floor(Math.random() * (maxStep * 2 + 1)) - maxStep;
    melNote = pool[Math.max(0, Math.min(pool.length - 1, idx + step))];
    return melNote;
  }

  /** ハミング1フレーズ。声帯=三角波、口=フォルマント帯域(閉口)。 */
  function scheduleHum(t0: number): number {
    if (!melGain) return 8;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.3;
    const vibAmt = ctx.createGain();
    vib.connect(vibAmt).connect(o.frequency);
    vib.start(t0);
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
    env.connect(melGain);
    const n = 4 + Math.floor(Math.random() * 4);
    let t = t0;
    o.frequency.setValueAtTime(hz(melNote), t);
    vibAmt.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const m = walk();
      const dur = 1.1 + Math.random() * 1.3;
      o.frequency.setTargetAtTime(hz(m), t, 0.09); // なめらかに移る
      vibAmt.gain.setTargetAtTime(hz(m) * 0.006, t + 0.25, 0.3);
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

  /** ティンホイッスル風1フレーズ。速い運指とカット(装飾音)。 */
  function scheduleWhistle(t0: number): number {
    if (!melGain) return 8;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.6;
    const vibAmt = ctx.createGain();
    vib.connect(vibAmt).connect(o.frequency);
    vib.start(t0);
    const env = ctx.createGain();
    env.gain.value = 0;
    o.connect(env).connect(melGain);
    const pool = style.melody.notes;
    const n = 6 + Math.floor(Math.random() * 5);
    let t = t0;
    o.frequency.setValueAtTime(hz(melNote), t);
    vibAmt.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const m = walk();
      const dur = 0.35 + Math.random() * 0.5;
      if (style.melody.ornament && Math.random() < 0.35) {
        // カット: すぐ上の音を一瞬挟んでから目的音へ
        const cut = pool[Math.min(pool.length - 1, pool.indexOf(m) + 1)];
        o.frequency.setTargetAtTime(hz(cut), t, 0.012);
        o.frequency.setTargetAtTime(hz(m), t + 0.07, 0.015);
      } else {
        o.frequency.setTargetAtTime(hz(m), t, 0.02);
      }
      vibAmt.gain.setTargetAtTime(hz(m) * 0.004, t + 0.3, 0.2);
      t += dur;
    }
    const total = t - t0;
    env.gain.linearRampToValueAtTime(0.13, t0 + 0.35);
    env.gain.setValueAtTime(0.13, t0 + total - 0.5);
    env.gain.linearRampToValueAtTime(0, t0 + total);
    o.start(t0);
    o.stop(t0 + total + 0.2);
    vib.stop(t0 + total + 0.2);
    return total;
  }

  /** ネイ(葦笛)風1フレーズ。息のノイズと深いポルタメント。 */
  function scheduleNey(t0: number): number {
    if (!melGain) return 8;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.2;
    const vibAmt = ctx.createGain();
    vib.connect(vibAmt).connect(o.frequency);
    vib.start(t0);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const env = ctx.createGain();
    env.gain.value = 0;
    o.connect(lp).connect(env);
    // 息: 帯域ノイズをうっすら重ねる
    const breath = noiseLoop(1.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 1.2;
    const bg = ctx.createGain();
    bg.gain.value = 0.05;
    breath.connect(bp).connect(bg).connect(env);
    env.connect(melGain);
    const n = 3 + Math.floor(Math.random() * 4);
    let t = t0;
    o.frequency.setValueAtTime(hz(melNote), t);
    vibAmt.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const m = walk();
      const dur = 0.9 + Math.random() * 1.4;
      o.frequency.setTargetAtTime(hz(m), t, 0.13); // 深いポルタメント
      vibAmt.gain.setTargetAtTime(hz(m) * 0.009, t + 0.4, 0.35);
      t += dur;
    }
    const total = t - t0;
    env.gain.linearRampToValueAtTime(0.17, t0 + 0.9);
    env.gain.setValueAtTime(0.17, t0 + total - 0.9);
    env.gain.linearRampToValueAtTime(0, t0 + total);
    breath.start(t0);
    breath.stop(t0 + total + 0.2);
    o.start(t0);
    o.stop(t0 + total + 0.2);
    vib.stop(t0 + total + 0.2);
    return total;
  }

  /** 撥弦(シタール/ウード)風1フレーズ。1音ごとに減衰する弦。 */
  function schedulePluck(t0: number): number {
    if (!melGain) return 8;
    const sitar = style.melody.glide === true;
    const decay = sitar ? 1.5 : 0.8;
    const n = 5 + Math.floor(Math.random() * 5);
    let t = t0;
    let prev = melNote;
    for (let i = 0; i < n; i++) {
      const m = walk();
      const f = hz(m);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      if (sitar) {
        // ミーンド: 前の音から弦を引っぱり上げるように届く
        o.frequency.setValueAtTime(hz(prev), t);
        o.frequency.setTargetAtTime(f, t, 0.06);
      } else {
        o.frequency.setValueAtTime(f, t);
      }
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = sitar ? 4 : 1.5; // ジャワリの鳴り / ウードの丸さ
      lp.frequency.setValueAtTime(f * 6, t);
      lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + decay);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + decay);
      o.connect(lp).connect(g).connect(melGain);
      o.start(t);
      o.stop(t + decay + 0.05);
      prev = m;
      t += 0.45 + Math.random() * 0.7;
    }
    return t - t0 + decay;
  }

  function scheduleMelody(t0: number): number {
    switch (style.melody.voice) {
      case 'hum':
        return scheduleHum(t0);
      case 'whistle':
        return scheduleWhistle(t0);
      case 'ney':
        return scheduleNey(t0);
      case 'pluck':
        return schedulePluck(t0);
    }
  }

  /** 先読みスケジューラ(1秒おきに2秒先まで埋める)。 */
  function tick(): void {
    const ahead = ctx.currentTime + 2;
    while (nextPad < ahead) {
      if (style.chords.length > 0) {
        schedulePad(Math.max(nextPad, ctx.currentTime + 0.05), style.chords[chordIdx]);
        chordIdx = (chordIdx + 1) % style.chords.length;
      }
      nextPad += 10; // 14秒の和音を10秒間隔で(クロスフェード)
    }
    while (nextDrip < ahead) {
      if (style.ambience.drip > 0) scheduleDrip(Math.max(nextDrip, ctx.currentTime + 0.05));
      // 深いほど水滴が増える(半分程度まで)。
      nextDrip +=
        (2.5 + Math.random() * 6) / (Math.max(0.1, style.ambience.drip) * (1 + 0.6 * fade(2, 10)));
    }
    while (nextBeat < ahead) {
      if (depth >= style.rhythm.from)
        scheduleBar(Math.max(nextBeat, ctx.currentTime + 0.05));
      nextBeat += style.rhythm.period; // 浅い間も刻みだけ進める(潜った瞬間から拍が合う)
    }
    while (nextTanpura < ahead) {
      if (style.tanpura) scheduleTanpura(Math.max(nextTanpura, ctx.currentTime + 0.05));
      nextTanpura += style.tanpura?.step ?? 4;
    }
    while (nextMel < ahead) {
      if (depth >= style.melody.from && Math.random() < 0.75) {
        const dur = scheduleMelody(Math.max(nextMel, ctx.currentTime + 0.05));
        nextMel += dur + 10 + Math.random() * 18; // 歌い終わってしばらく沈黙
      } else {
        nextMel += 6; // まだ歌わない(次の判定まで少し待つ)
      }
    }
  }

  buildDripBus();
  buildBuses();
  startDrone();
  startWind();
  startWater();
  nextPad = ctx.currentTime + 0.3;
  nextDrip = ctx.currentTime + 2;
  nextBeat = ctx.currentTime + 1.2;
  nextTanpura = ctx.currentTime + 0.6;
  nextMel = ctx.currentTime + 12;
  const timer = setInterval(tick, 1000);
  tick();
  applyScene(2.5);
  applyDepth();

  return {
    setDepth(d: number): void {
      if (d === depth) return;
      depth = d;
      applyDepth();
    },
    setScene(s: BgmScene): void {
      scene = s;
      applyScene();
    },
    setMuted(v: boolean): void {
      muted = v;
      applyScene(0.5);
    },
    dispose(): void {
      clearInterval(timer);
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(0, t, 0.15);
      for (const s of live) {
        try {
          s.stop(t + 0.8);
        } catch {
          // 既に停止済みなら無視
        }
      }
      setTimeout(() => master.disconnect(), 1200);
    },
  };
}
