// 効果音(it-6 で導入、rogue で使用)。外部アセットなしの WebAudio 合成。
// AudioContext はブラウザでの初回ユーザ操作時に生成/resume する（自動再生制限対応）。
// テスト/Node 環境では AudioContext が無いので全 API が no-op になる。
//
// 使い方: play('select') のように名前で鳴らす。setMuted(true) で全消音。

export type SfxName =
  | 'select' // ユニット選択
  | 'cursor' // マーカー/対象ホバー（小さなカーソル音）
  | 'cancel' // キャンセル・戻る
  | 'place' // 配置（デプロイ）確定
  | 'land' // 降着（浮遊切れ）
  | 'melee' // 近接攻撃（打撃）
  | 'arrow' // 弓（風切り）
  | 'magic' // 魔法（ザップ）
  | 'hit' // 命中（衝撃）
  | 'heal' // 回復（チャイム）
  | 'death' // 撃破（下降）
  | 'defeat' // 敗北
  | 'step' // 足音(rogue)
  | 'pickup' // 拾得(rogue)
  | 'alert'; // 敵が気づく(rogue)

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

const MASTER_GAIN = 0.22;

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_GAIN;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** 初回ユーザ操作で呼ぶ（App がグローバル pointerdown で1度呼ぶ）。 */
export function unlock(): void {
  ensureCtx();
}

/** BGM など他モジュールが同じ AudioContext を共有するための取得口。 */
export function audioContext(): AudioContext | null {
  return ensureCtx();
}

export function setMuted(v: boolean): void {
  muted = v;
  if (master) master.gain.value = v ? 0 : MASTER_GAIN;
}

export function isMuted(): boolean {
  return muted;
}

// --- 合成ヘルパ -----------------------------------------------------------------

/** 単音: オシレータ + 減衰エンベロープ（+ 任意の周波数スイープ）。 */
function tone(
  freq: number,
  dur: number,
  opts: {
    type?: OscillatorType;
    gain?: number;
    sweepTo?: number;
    delay?: number;
  } = {},
): void {
  const c = ensureCtx();
  if (!c || !master) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const osc = c.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.sweepTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.sweepTo), t0 + dur);
  const g = c.createGain();
  const peak = opts.gain ?? 0.8;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** ノイズバースト（打撃・風切り）。lowpass/highpass でキャラクタを変える。 */
function noise(
  dur: number,
  opts: { filter?: 'lowpass' | 'highpass' | 'bandpass'; freq?: number; sweepTo?: number; gain?: number; delay?: number } = {},
): void {
  const c = ensureCtx();
  if (!c || !master) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = opts.filter ?? 'lowpass';
  f.frequency.setValueAtTime(opts.freq ?? 1200, t0);
  if (opts.sweepTo !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(1, opts.sweepTo), t0 + dur);
  const g = c.createGain();
  const peak = opts.gain ?? 0.7;
  g.gain.setValueAtTime(peak, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

// --- 効果音の定義(データ表。「何を鳴らすか」と「どう合成するか」を分離) -----------

interface ToneLayer {
  kind: 'tone';
  freq: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  sweepTo?: number;
  delay?: number;
}
interface NoiseLayer {
  kind: 'noise';
  dur: number;
  filter?: 'lowpass' | 'highpass' | 'bandpass';
  freq?: number;
  sweepTo?: number;
  gain?: number;
  delay?: number;
}
type SfxLayer = ToneLayer | NoiseLayer;

const DEFEAT_SEQ: SfxLayer[] = [440, 415, 349, 262].map((freq, i) => ({
  kind: 'tone',
  freq,
  dur: 0.4,
  type: 'triangle',
  gain: 0.4,
  delay: i * 0.22,
}));

const SFX: Record<SfxName, SfxLayer[]> = {
  select: [{ kind: 'tone', freq: 660, dur: 0.07, type: 'square', gain: 0.35 }],
  cursor: [{ kind: 'tone', freq: 1180, dur: 0.035, type: 'sine', gain: 0.14 }],
  cancel: [{ kind: 'tone', freq: 440, dur: 0.12, type: 'square', gain: 0.3, sweepTo: 220 }],
  place: [
    { kind: 'noise', dur: 0.08, filter: 'lowpass', freq: 700, gain: 0.45 },
    { kind: 'tone', freq: 520, dur: 0.1, type: 'triangle', gain: 0.35 },
    { kind: 'tone', freq: 780, dur: 0.14, type: 'triangle', gain: 0.3, delay: 0.07 },
  ],
  land: [
    { kind: 'noise', dur: 0.16, filter: 'lowpass', freq: 420, gain: 0.6 },
    { kind: 'tone', freq: 95, dur: 0.2, type: 'sine', gain: 0.7, sweepTo: 55 },
  ],
  melee: [
    { kind: 'noise', dur: 0.12, filter: 'lowpass', freq: 900, gain: 0.9 },
    { kind: 'tone', freq: 120, dur: 0.16, type: 'sine', gain: 0.9, sweepTo: 60 },
  ],
  arrow: [{ kind: 'noise', dur: 0.18, filter: 'highpass', freq: 1800, sweepTo: 600, gain: 0.5 }],
  magic: [
    { kind: 'tone', freq: 300, dur: 0.25, type: 'sawtooth', gain: 0.4, sweepTo: 950 },
    { kind: 'tone', freq: 600, dur: 0.25, type: 'sine', gain: 0.25, sweepTo: 1900 },
  ],
  hit: [
    { kind: 'noise', dur: 0.14, filter: 'lowpass', freq: 1400, gain: 0.9 },
    { kind: 'tone', freq: 200, dur: 0.2, type: 'triangle', gain: 0.7, sweepTo: 90 },
  ],
  heal: [
    { kind: 'tone', freq: 523, dur: 0.16, gain: 0.4 },
    { kind: 'tone', freq: 659, dur: 0.16, gain: 0.4, delay: 0.09 },
    { kind: 'tone', freq: 784, dur: 0.28, gain: 0.4, delay: 0.18 },
  ],
  death: [
    { kind: 'tone', freq: 280, dur: 0.5, type: 'sawtooth', gain: 0.5, sweepTo: 70 },
    { kind: 'noise', dur: 0.35, filter: 'lowpass', freq: 700, sweepTo: 120, gain: 0.5 },
  ],
  defeat: DEFEAT_SEQ,
  step: [{ kind: 'noise', dur: 0.05, filter: 'lowpass', freq: 480, gain: 0.28 }],
  pickup: [
    { kind: 'tone', freq: 880, dur: 0.07, type: 'triangle', gain: 0.3 },
    { kind: 'tone', freq: 1320, dur: 0.09, type: 'triangle', gain: 0.25, delay: 0.06 },
  ],
  alert: [{ kind: 'tone', freq: 950, dur: 0.12, type: 'square', gain: 0.35, sweepTo: 1250 }],
};

function playLayer(l: SfxLayer): void {
  if (l.kind === 'tone') tone(l.freq, l.dur, l);
  else noise(l.dur, l);
}

/** 名前で鳴らす。Audio 不可環境では静かに何もしない。 */
export function play(name: SfxName): void {
  try {
    for (const l of SFX[name]) playLayer(l);
  } catch {
    // Audio 環境の問題でゲームを止めない
  }
}
