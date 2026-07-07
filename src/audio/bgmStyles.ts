// BGM スタイル定義(rogue-16)。エンジン(bgmEngine.ts)に食わせるデータ。
// ゲーム本編は「洞窟」のみ。他は bgm.html の試聴ページで聴ける試作:
// ヨーロッパから外れた雰囲気の探求(ケルトは例外的に欧州だが依頼に含まれる)。
// 音階は MIDI ノート番号(小数で四分音 — アラブのマカームで使う)。

import type { BgmStyle } from './bgmEngine';

/** 洞窟(ゲーム本編)。D エオリア/ドリアンの生成アンビエント。 */
export const CAVE: BgmStyle = {
  id: 'cave',
  label: '洞窟',
  desc: '本編の BGM。低いドローンと移ろう和音、深むほど太鼓・流水・女声ハミングが加わる。',
  chords: [
    [50, 57, 62, 64], // Dm9  (D3 A3 D4 E4)
    [46, 53, 58, 65], // B♭maj7(B♭2 F3 B♭3 F4)
    [43, 50, 58, 62], // Gm   (G2 D3 B♭3 D4)
    [45, 52, 57, 60], // Asus♭6(A2 E3 A3 C4)
  ],
  drone: [38, 33], // D2 + A1
  melody: {
    notes: [57, 60, 62, 64, 65, 67, 69], // D ドリアンのペンタ寄り
    voice: 'hum',
    from: 10,
    span: 5,
    level: 0.55,
  },
  rhythm: {
    period: 2.4,
    pattern: [
      { at: 0, kind: 'thump', peak: 0.75 },
      { at: 1.65, kind: 'thump', peak: 0.4, minDepth: 7 },
      { at: 1.2, kind: 'knock', peak: 0.07, minDepth: 5, prob: 0.6 },
      { at: 2.0, kind: 'knock', peak: 0.05, minDepth: 12, prob: 0.5, jitter: 0.2 },
    ],
    from: 3,
    span: 7,
    level: 0.5,
  },
  ambience: { wind: 1, water: 1, drip: 1 },
  layers: [
    { from: 3, label: '太鼓の鼓動' },
    { from: 4, label: '風が低く強くなる' },
    { from: 5, label: '石を打つ音' },
    { from: 6, label: '流水のせせらぎ' },
    { from: 10, label: '女声ハミングの旋律' },
  ],
};

/** アイリッシュ/ケルティック。D ミクソリディア、バウロンのジグ、ホイッスル。 */
const CELTIC: BgmStyle = {
  id: 'celtic',
  label: 'ケルト',
  desc: 'D ミクソリディアの明るい陰り。6/8 のバウロンとティンホイッスル(カット装飾)。',
  chords: [
    [50, 57, 62, 66], // D  (D3 A3 D4 F#4)
    [48, 55, 60, 64], // C  (C3 G3 C4 E4)
    [43, 50, 59, 62], // G  (G2 D3 B3 D4)
    [50, 57, 62, 64], // Dsus2
  ],
  drone: [38, 45], // D2 + A2(パイプのドローン)
  melody: {
    notes: [62, 64, 66, 67, 69, 71, 72, 74, 76], // D ミクソリディア(C ナチュラル)
    voice: 'whistle',
    from: 6,
    span: 5,
    level: 0.5,
    ornament: true,
  },
  rhythm: {
    period: 1.8, // ジグ(6/8)。付点4分 = 0.9秒
    pattern: [
      { at: 0, kind: 'frame', peak: 0.6 },
      { at: 0.9, kind: 'frame', peak: 0.45 },
      { at: 0.6, kind: 'frame', peak: 0.3, minDepth: 3 },
      { at: 1.2, kind: 'frame', peak: 0.3, minDepth: 3 },
      { at: 0.3, kind: 'knock', peak: 0.1, minDepth: 5, prob: 0.8 },
      { at: 1.5, kind: 'knock', peak: 0.08, minDepth: 8, prob: 0.7 },
    ],
    from: 2,
    span: 6,
    level: 0.5,
  },
  ambience: { wind: 1.2, water: 0.9, drip: 0.6 },
  layers: [
    { from: 2, label: 'バウロン(枠太鼓)のジグ' },
    { from: 3, label: '裏拍が埋まる' },
    { from: 5, label: 'スティックの刻み' },
    { from: 6, label: 'ティンホイッスルの旋律' },
  ],
};

/** アラブ(イスラミック)。マカーム・ラースト(四分音)、マクスーム、ネイ。 */
const MAQAM: BgmStyle = {
  id: 'maqam',
  label: 'アラブ',
  desc: 'マカーム・ラースト(第3・7音が四分音)。ダラブッカのマクスームと葦笛ネイ。',
  chords: [
    [50, 57, 62], // D-A-D(和音は避けドローン中心)
    [50, 57, 64], // D-A-E
  ],
  drone: [38, 33],
  melody: {
    notes: [62, 64, 65.5, 67, 69, 71, 72.5, 74], // ラースト on D(65.5, 72.5 が四分音)
    voice: 'ney',
    from: 5,
    span: 5,
    level: 0.6,
  },
  rhythm: {
    period: 2.0, // マクスーム(4/4)。8分 = 0.25秒
    pattern: [
      { at: 0, kind: 'dum', peak: 0.7 },
      { at: 0.25, kind: 'tek', peak: 0.35 },
      { at: 0.75, kind: 'tek', peak: 0.35 },
      { at: 1.0, kind: 'dum', peak: 0.55 },
      { at: 1.5, kind: 'tek', peak: 0.4 },
      { at: 1.75, kind: 'tek', peak: 0.22, minDepth: 8, prob: 0.7 },
    ],
    from: 2,
    span: 6,
    level: 0.55,
  },
  ambience: { wind: 1.0, water: 0.5, drip: 0.8 },
  layers: [
    { from: 2, label: 'ダラブッカ(マクスーム)' },
    { from: 5, label: 'ネイの旋律(四分音)' },
    { from: 8, label: '縁打ちが埋まる' },
  ],
};

/** エジプシャン。マカーム・ヒジャーズ、バラディ、ウード。 */
const EGYPT: BgmStyle = {
  id: 'egypt',
  label: 'エジプト',
  desc: 'ヒジャーズ(増2度の音階)の妖しさ。バラディのリズムと撥弦ウード。乾いた空気。',
  chords: [
    [50, 57, 62], // D-A-D
    [50, 57, 63], // D-A-E♭(ヒジャーズの色)
    [50, 57, 62, 66], // D-A-D-F#
    [50, 57, 63],
  ],
  drone: [38, 33],
  melody: {
    notes: [62, 63, 66, 67, 69, 70, 72, 74], // ヒジャーズ on D(E♭ と F# の増2度)
    voice: 'pluck',
    from: 5,
    span: 5,
    level: 0.55,
  },
  rhythm: {
    period: 2.0, // バラディ(4/4)
    pattern: [
      { at: 0, kind: 'dum', peak: 0.7 },
      { at: 0.25, kind: 'dum', peak: 0.55 },
      { at: 0.75, kind: 'tek', peak: 0.35 },
      { at: 1.0, kind: 'dum', peak: 0.5 },
      { at: 1.5, kind: 'tek', peak: 0.4 },
      { at: 1.25, kind: 'tek', peak: 0.2, minDepth: 8, prob: 0.6 },
    ],
    from: 2,
    span: 6,
    level: 0.55,
  },
  ambience: { wind: 0.9, water: 0.35, drip: 0.6 },
  layers: [
    { from: 2, label: 'バラディのリズム' },
    { from: 5, label: 'ウードの旋律(ヒジャーズ)' },
    { from: 8, label: '縁打ちが埋まる' },
  ],
};

/** インド。ラーガ・バイラヴ、タンプーラ、ケヘルワのタブラー、シタール。 */
const INDIA: BgmStyle = {
  id: 'india',
  label: 'インド',
  desc: 'タンプーラの持続音の上に、ケヘルワ(8拍)のタブラーとシタール(ミーンド=引弦)。',
  chords: [], // 和声は使わずタンプーラが支配する
  drone: [],
  tanpura: { notes: [45, 50, 50, 38], step: 0.875 }, // A2 D3 D3 D2 の循環
  melody: {
    notes: [62, 63, 66, 67, 69, 70, 73, 74], // ラーガ・バイラヴ on D(♭2 と ♭6、#7)
    voice: 'pluck',
    from: 4,
    span: 5,
    level: 0.6,
    glide: true, // ミーンド(音間を弦で繋ぐ)
  },
  rhythm: {
    period: 2.2, // ケヘルワ(8拍)。8分 = 0.275秒
    pattern: [
      { at: 0, kind: 'baya', peak: 0.65 },
      { at: 0.275, kind: 'tabla', peak: 0.3 },
      { at: 0.55, kind: 'tabla', peak: 0.35 },
      { at: 0.825, kind: 'tabla', peak: 0.28, prob: 0.85 },
      { at: 1.1, kind: 'tabla', peak: 0.35 },
      { at: 1.375, kind: 'tabla', peak: 0.25, minDepth: 7, prob: 0.8 },
      { at: 1.65, kind: 'baya', peak: 0.55 },
      { at: 1.925, kind: 'tabla', peak: 0.3 },
    ],
    from: 2,
    span: 6,
    level: 0.5,
  },
  ambience: { wind: 0.7, water: 0.6, drip: 0.5 },
  layers: [
    { from: 0, label: 'タンプーラの持続音' },
    { from: 2, label: 'タブラー(ケヘルワ)' },
    { from: 4, label: 'シタールの旋律(ミーンド)' },
    { from: 7, label: '刻みが埋まる' },
  ],
};

export const BGM_STYLES: BgmStyle[] = [CAVE, CELTIC, MAQAM, EGYPT, INDIA];
