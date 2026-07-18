// スキルノードのデータ表(render/beastModels.ts と同じデータ表分離の流儀)。
// マスタリー系統・ノード id・効果定義・解禁要件を一元管理する(rogue-27: 体系v2)。
//
// rogue-27 でノードを「ライン」(ランクI〜III・段階的に強化)と「単発」(ランクIのみ)に
// 再編した。ライン7本(研鑽・盾術・硬化・拳打・身軽・忍び足・罠編み)は unlockLevels/costs/
// descs が長さ3、単発13本は長さ1。旧 rogue-23/24 の unlockLevel/cost(単一値)は廃止。
//
// 廃止 id(rogue-26 まで): ukekaeshi(→jutsu ランクII の受け反撃に統合)・
// kenMikiri(→kenMigaru ランクII の見切りに統合)・shinKehai(→shinShinobi ランクII の
// 追跡諦め距離強化に統合)・wanaTsuyoka/wanaKaishu/wanaRensa(→wanaAmi ランクI/II/III に統合)。

/** マスタリー系統。 */
export type MasterySystem = 'arms' | 'guard' | 'carapace' | 'fist' | 'stealth' | 'trapper' | 'light';

/** 系統の育て方(ツールチップ・UI表示用)。閾値は MASTERY_THRESHOLDS を併記して使う。 */
export const MASTERY_DEED: Record<MasterySystem, string> = {
  arms: '武器での討伐で深まる',
  guard: '盾での回避成功で深まる',
  carapace: '障壁で受け止めた累計ダメージで深まる',
  fist: '素手での討伐で深まる',
  stealth: '未覚醒の敵への攻撃で深まる',
  trapper: '罠での討伐で深まる',
  light: '「絞る」以下の明かりで関門を通過すると深まる',
};

/** 系統名(ログ・UI表示用)。 */
export const MASTERY_NAME: Record<MasterySystem, string> = {
  arms: '武技',
  guard: '盾',
  carapace: '甲殻',
  fist: '拳闘',
  stealth: '隠密',
  trapper: '罠師',
  light: '灯火',
};

/** スキルノード id(rogue-30: ライン7 + 単発15 = 22個)。 */
export type NodeId =
  // --- arms(武技) ---
  | 'kensan'
  | 'ryote'
  | 'katate'
  | 'nitoryu'
  // --- guard(盾) ---
  | 'jutsu'
  | 'tateKakage'
  // --- carapace(甲殻) ---
  | 'kouka'
  | 'tenka'
  // --- fist(拳闘) ---
  | 'kenPunch'
  | 'kenMigaru'
  | 'kenMuku'
  | 'kenHaisui'
  | 'rengeki'
  // --- stealth(隠密) ---
  | 'shinShinobi'
  | 'shinMekiki'
  | 'shinSegiri'
  // --- trapper(罠師) ---
  | 'wanaAmi'
  | 'knifeRico'
  // --- light(灯火) ---
  | 'hiShibori'
  | 'hiKagari'
  | 'hiEnjin'
  | 'hiShobo';

export const NODE_IDS: NodeId[] = [
  'kensan',
  'ryote',
  'katate',
  'nitoryu',
  'jutsu',
  'tateKakage',
  'kouka',
  'tenka',
  'kenPunch',
  'kenMigaru',
  'kenMuku',
  'kenHaisui',
  'rengeki',
  'shinShinobi',
  'shinMekiki',
  'shinSegiri',
  'wanaAmi',
  'knifeRico',
  'hiShibori',
  'hiKagari',
  'hiEnjin',
  'hiShobo',
];

export interface SkillNode {
  id: NodeId;
  system: MasterySystem;
  name: string;
  /** ランク r の解禁に要る系統Lv(単発は長さ1)。wanaAmi は [0,1,2](ランクIは Lv0=最初から)。 */
  unlockLevels: number[];
  /** ランク r までの累計コスト(単発は長さ1)。ライン=[1,2,3]。 */
  costs: number[];
  /** ランクごとの効果1行(UI と図鑑で使う)。 */
  descs: string[];
}

export const SKILL_NODES: Record<NodeId, SkillNode> = {
  // --- arms(武技) ---------------------------------------------------------------
  kensan: {
    id: 'kensan',
    system: 'arms',
    name: '研鑽',
    unlockLevels: [1, 2, 3],
    costs: [1, 2, 3],
    descs: ['武器の攻撃+1', '攻撃+2', '攻撃+3'],
  },
  ryote: {
    id: 'ryote',
    system: 'arms',
    name: '両手保持',
    unlockLevels: [2],
    costs: [2],
    descs: ['片手武器を装備し盾スロットが空のとき攻撃+2'],
  },
  katate: {
    id: 'katate',
    system: 'arms',
    name: '片手扱い',
    unlockLevels: [3],
    costs: [2],
    // 命中制はまだ無いので攻撃減で代替する(将来、命中率を導入したら命中−へ置換する)。
    descs: ['両手武器でも盾を装備できる(その間、攻撃−2)'],
  },
  nitoryu: {
    id: 'nitoryu',
    system: 'arms',
    name: '二刀流',
    unlockLevels: [3],
    costs: [3],
    descs: ['左手(盾スロット)に片手武器を持てる。近接命中後、同じ対象へ左手の攻の半分の追撃'],
  },

  // --- guard(盾) -----------------------------------------------------------------
  jutsu: {
    id: 'jutsu',
    system: 'guard',
    name: '盾術',
    unlockLevels: [1, 2, 3],
    costs: [1, 2, 3],
    descs: [
      '盾装備中の回避+5%',
      '回避+8%・受け反撃(隣接の攻撃者へ攻の半分)',
      '回避+12%・反撃は攻の3/4',
    ],
  },
  tateKakage: {
    id: 'tateKakage',
    system: 'guard',
    name: '掲盾',
    unlockLevels: [2],
    costs: [1],
    descs: ['盾装備中、遠隔攻撃への回避+20%(近接には効かない)'],
  },

  // --- carapace(甲殻) -------------------------------------------------------------
  kouka: {
    id: 'kouka',
    system: 'carapace',
    name: '硬化',
    unlockLevels: [1, 2, 3],
    costs: [1, 2, 3],
    descs: [
      '障壁が1以上ある間、被ダメージ−1(最低1)',
      '被ダメージ−2(最低1)',
      'さらに砕殻: 障壁が砕けた瞬間、隣接の敵へ攻の半分の固定ダメージ',
    ],
  },
  tenka: {
    id: 'tenka',
    system: 'carapace',
    name: '転化',
    unlockLevels: [2],
    costs: [2],
    descs: ['HP満タン時の自然回復ティックが障壁+1に変わる(上限24)'],
  },

  // --- fist(拳闘) ------------------------------------------------------------------
  kenPunch: {
    id: 'kenPunch',
    system: 'fist',
    name: '拳打',
    unlockLevels: [1, 2, 3],
    costs: [1, 2, 3],
    descs: ['素手時、攻撃+3', '素手時、攻撃+5', '素手時、攻撃+7'],
  },
  kenMigaru: {
    id: 'kenMigaru',
    system: 'fist',
    name: '身軽',
    unlockLevels: [1, 2, 3],
    costs: [1, 2, 3],
    descs: [
      '素手時、回避+10%(盾不要)',
      'さらに見切り: 回避成功で隣接の攻撃者へ攻の半分の固定反撃',
      '回避+15%',
    ],
  },
  kenMuku: {
    id: 'kenMuku',
    system: 'fist',
    name: '無傷の型',
    unlockLevels: [2],
    costs: [2],
    descs: ['HP満タンで攻撃+2'],
  },
  kenHaisui: {
    id: 'kenHaisui',
    system: 'fist',
    name: '背水',
    unlockLevels: [3],
    costs: [3],
    descs: ['HP25%以下かつ障壁0のとき、回避+25%・攻撃+3'],
  },
  rengeki: {
    id: 'rengeki',
    system: 'fist',
    name: '連撃',
    unlockLevels: [2],
    costs: [2],
    descs: ['発動して隣接の敵へ素手で2連撃(1ターン)。装填6ターン'],
  },

  // --- stealth(隠密) ---------------------------------------------------------------
  shinShinobi: {
    id: 'shinShinobi',
    system: 'stealth',
    name: '忍び足',
    unlockLevels: [1, 2, 3],
    costs: [1, 2, 3],
    descs: [
      '敵の気づく距離−20%',
      'さらに追跡を諦める距離−25%',
      '気づく距離−35%・諦める距離−40%',
    ],
  },
  shinMekiki: {
    id: 'shinMekiki',
    system: 'stealth',
    name: '目利き',
    unlockLevels: [1],
    costs: [1],
    descs: ['敵ホバーの情報に持ち物を表示する'],
  },
  shinSegiri: {
    id: 'shinSegiri',
    system: 'stealth',
    name: '背討ち',
    unlockLevels: [2],
    costs: [2],
    descs: ['未覚醒の敵への近接攻撃ダメージ×2(気配感知の敵には無効)'],
  },

  // --- trapper(罠師) --------------------------------------------------------------
  wanaAmi: {
    id: 'wanaAmi',
    system: 'trapper',
    name: '罠編み',
    unlockLevels: [0, 1, 2],
    costs: [1, 2, 3],
    descs: [
      '棘の罠を編める(威力8・装填10ターン・同時1)',
      '威力10・装填8・同時2・回収=即時再装填',
      '威力12・装填6・同時3・連鎖誘爆・遠隔起爆',
    ],
  },
  knifeRico: {
    id: 'knifeRico',
    system: 'trapper',
    name: '跳弾',
    unlockLevels: [2],
    costs: [2],
    descs: ['投げナイフ命中時、対象に隣接する敵1体へ半分ダメージ'],
  },

  // --- light(灯火) -----------------------------------------------------------------
  hiShibori: {
    id: 'hiShibori',
    system: 'light',
    name: '絞り撃ち',
    unlockLevels: [1],
    costs: [1],
    descs: ['「絞る」以下の明かりで攻撃+2'],
  },
  hiKagari: {
    id: 'hiKagari',
    system: 'light',
    name: '篝火',
    unlockLevels: [1],
    costs: [1],
    descs: ['「広げる」中の自然回復間隔−1ターン(最低2)'],
  },
  hiEnjin: {
    id: 'hiEnjin',
    system: 'light',
    name: '延焼の刃',
    unlockLevels: [2],
    costs: [2],
    descs: ['近接攻撃の命中時30%で敵を延焼させる(2ターン)'],
  },
  hiShobo: {
    id: 'hiShobo',
    system: 'light',
    name: '消灯',
    unlockLevels: [2],
    costs: [3],
    descs: ['明かりの4段階目「消す」を解禁する(視界2・回復なし・気づかれにくい)'],
  },
};

/** 装着中スキル。rank は 1..maxRank(id)。 */
export interface EquippedSkill {
  id: NodeId;
  rank: number;
}

/** ノードの最大ランク(unlockLevels の長さ)。 */
export function maxRank(id: NodeId): number {
  return SKILL_NODES[id].unlockLevels.length;
}

/** 装着中スキル列から id の現在ランクを引く(未装着=0)。 */
export function rankOf(eq: readonly EquippedSkill[], id: NodeId): number {
  return eq.find((e) => e.id === id)?.rank ?? 0;
}

/** クールダウン map から id のクールダウンターンを引く(未定義=0)。 */
export function cdOf(cooldowns: Partial<Record<NodeId, number>>, id: NodeId): number {
  return cooldowns[id] ?? 0;
}

/**
 * 結び: 親2ノードを(所定ランク以上で)同時装着すると自動発動する(コスト0)。
 * 効果の配線は S2(本ファイルはデータ表と knotActive のみ)。
 */
export type KnotId = 'yamiuchi' | 'kakei' | 'nemuriito' | 'rentetsu' | 'kouken' | 'yagaeshi';

export interface Knot {
  id: KnotId;
  name: string;
  desc: string;
  parents: readonly [readonly [NodeId, number], readonly [NodeId, number]];
}

export const KNOTS: Record<KnotId, Knot> = {
  yamiuchi: {
    id: 'yamiuchi',
    name: '闇討ち',
    desc: '消灯中の背討ちは一般敵を即死させる(門番・強化個体・気配感知には効かない)',
    parents: [
      ['shinSegiri', 1],
      ['hiShobo', 1],
    ],
  },
  kakei: {
    id: 'kakei',
    name: '火計',
    desc: '罠の発動が延焼(2ターン)を確定付与',
    parents: [
      ['wanaAmi', 1],
      ['hiEnjin', 1],
    ],
  },
  nemuriito: {
    id: 'nemuriito',
    name: '眠り糸',
    desc: '罠がダメージ後、生き残った敵を昏睡(2ターン)させる',
    parents: [
      ['wanaAmi', 1],
      ['shinShinobi', 1],
    ],
  },
  rentetsu: {
    id: 'rentetsu',
    name: '錬鉄の受け',
    desc: '回避成功時に障壁+1(上限24)',
    parents: [
      ['jutsu', 1],
      ['kouka', 1],
    ],
  },
  kouken: {
    id: 'kouken',
    name: '甲拳',
    desc: '障壁が1以上ある間、素手攻撃+2',
    parents: [
      ['kenPunch', 1],
      ['kouka', 1],
    ],
  },
  yagaeshi: {
    id: 'yagaeshi',
    name: '矢返し',
    desc: '遠隔攻撃の回避成功時、離れた射手にも受け反撃が届く',
    parents: [
      ['tateKakage', 1],
      ['jutsu', 2],
    ],
  },
};

/** 結びが発動中か(両親を所定ランク以上で装着中)。 */
export function knotActive(eq: readonly EquippedSkill[], id: KnotId): boolean {
  const [[a, aMin], [b, bMin]] = KNOTS[id].parents;
  return rankOf(eq, a) >= aMin && rankOf(eq, b) >= bMin;
}

/** 排他: 両方を所定ランク以上で装着することはできない。 */
export const EXCLUDES: readonly (readonly [readonly [NodeId, number], readonly [NodeId, number]])[] = [
  [
    ['jutsu', 2],
    ['kenMigaru', 2],
  ], // 反撃は1本
  [
    ['kenMuku', 1],
    ['kenHaisui', 1],
  ], // 完璧主義 vs 捨て身
];
