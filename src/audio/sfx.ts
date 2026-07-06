// 効果音（it-6）。外部アセットなしの WebAudio 合成。
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
  | 'battle' // 開戦の角笛
  | 'move' // 移動（ふわっと）
  | 'melee' // 近接攻撃（打撃）
  | 'arrow' // 弓（風切り）
  | 'magic' // 魔法（ザップ）
  | 'hit' // 命中（衝撃）
  | 'miss' // 回避（空振り）
  | 'heal' // 回復（チャイム）
  | 'levitate' // 浮遊付与（上昇シマー）
  | 'death' // 撃破（下降）
  | 'turn' // ターン交代（太鼓）
  | 'victory' // 勝利ファンファーレ
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

// --- 効果音の定義 -----------------------------------------------------------------

const SFX: Record<SfxName, () => void> = {
  select: () => tone(660, 0.07, { type: 'square', gain: 0.35 }),
  cursor: () => tone(1180, 0.035, { type: 'sine', gain: 0.14 }),
  cancel: () => tone(440, 0.12, { type: 'square', gain: 0.3, sweepTo: 220 }),
  place: () => {
    noise(0.08, { filter: 'lowpass', freq: 700, gain: 0.45 });
    tone(520, 0.1, { type: 'triangle', gain: 0.35 });
    tone(780, 0.14, { type: 'triangle', gain: 0.3, delay: 0.07 });
  },
  land: () => {
    noise(0.16, { filter: 'lowpass', freq: 420, gain: 0.6 });
    tone(95, 0.2, { type: 'sine', gain: 0.7, sweepTo: 55 });
  },
  battle: () => {
    // 角笛(完全5度)+ 太鼓。開戦の合図。
    tone(220, 0.55, { type: 'sawtooth', gain: 0.3 });
    tone(330, 0.55, { type: 'sawtooth', gain: 0.22, delay: 0.02 });
    tone(440, 0.4, { type: 'sawtooth', gain: 0.18, delay: 0.22 });
    tone(110, 0.25, { type: 'sine', gain: 0.9, sweepTo: 60, delay: 0.05 });
  },
  move: () => noise(0.28, { filter: 'bandpass', freq: 500, sweepTo: 1400, gain: 0.4 }),
  melee: () => {
    noise(0.12, { filter: 'lowpass', freq: 900, gain: 0.9 });
    tone(120, 0.16, { type: 'sine', gain: 0.9, sweepTo: 60 });
  },
  arrow: () => noise(0.18, { filter: 'highpass', freq: 1800, sweepTo: 600, gain: 0.5 }),
  magic: () => {
    tone(300, 0.25, { type: 'sawtooth', gain: 0.4, sweepTo: 950 });
    tone(600, 0.25, { type: 'sine', gain: 0.25, sweepTo: 1900 });
  },
  hit: () => {
    noise(0.14, { filter: 'lowpass', freq: 1400, gain: 0.9 });
    tone(200, 0.2, { type: 'triangle', gain: 0.7, sweepTo: 90 });
  },
  miss: () => noise(0.16, { filter: 'highpass', freq: 2500, sweepTo: 4000, gain: 0.25 }),
  heal: () => {
    tone(523, 0.16, { gain: 0.4 });
    tone(659, 0.16, { gain: 0.4, delay: 0.09 });
    tone(784, 0.28, { gain: 0.4, delay: 0.18 });
  },
  levitate: () => {
    tone(400, 0.5, { type: 'sine', gain: 0.35, sweepTo: 820 });
    tone(405, 0.5, { type: 'sine', gain: 0.2, sweepTo: 830, delay: 0.04 }); // うなりでシマー感
  },
  death: () => {
    tone(280, 0.5, { type: 'sawtooth', gain: 0.5, sweepTo: 70 });
    noise(0.35, { filter: 'lowpass', freq: 700, sweepTo: 120, gain: 0.5 });
  },
  turn: () => {
    tone(100, 0.22, { type: 'sine', gain: 0.9, sweepTo: 55 });
    tone(160, 0.18, { type: 'sine', gain: 0.6, sweepTo: 90, delay: 0.14 });
  },
  victory: () => {
    const seq = [523, 659, 784, 1047];
    seq.forEach((f, i) => tone(f, 0.22, { type: 'square', gain: 0.3, delay: i * 0.13 }));
    tone(1047, 0.5, { type: 'square', gain: 0.3, delay: seq.length * 0.13 });
  },
  defeat: () => {
    const seq = [440, 415, 349, 262];
    seq.forEach((f, i) => tone(f, 0.4, { type: 'triangle', gain: 0.4, delay: i * 0.22 }));
  },
  step: () => noise(0.05, { filter: 'lowpass', freq: 480, gain: 0.28 }),
  pickup: () => {
    tone(880, 0.07, { type: 'triangle', gain: 0.3 });
    tone(1320, 0.09, { type: 'triangle', gain: 0.25, delay: 0.06 });
  },
  alert: () => tone(950, 0.12, { type: 'square', gain: 0.35, sweepTo: 1250 }),
};

/** 名前で鳴らす。Audio 不可環境では静かに何もしない。 */
export function play(name: SfxName): void {
  try {
    SFX[name]();
  } catch {
    // Audio 環境の問題でゲームを止めない
  }
}
