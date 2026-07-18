// スキルノードのデータ表(render/beastModels.ts と同じデータ表分離の流儀)。
// マスタリー「四道」・ノード id・効果定義・解禁要件(deed)を一元管理する
// (rogue-35: マスタリー v3「四道」— 7系統×Lv の二軸から、4道×ノード単位 deed へ再編)。
//
// rogue-27 の「系統Lv → unlockLevels」は廃止。ノードは道(bu/mamori/kage/waza)に属し、
// 各ノードは自分の deed(行い1つのカウンタ+ランクごとの閾値 at)で個別に解禁される
// (根ノード=at[0]===0 は counter0でも常時解禁。wanaAmi・kenPunch が該当)。
//
// 廃止 id(rogue-35): kensan(研鑽)・kenMigaru(身軽)・hiShobo(消灯→心眼へ吸収)・
// ukekaeshi 相当(盾術II内蔵の反撃・身軽IIの見切り→返しへ統合)。
// rogue-27 までの廃止 id: ukekaeshi・kenMikiri・shinKehai・wanaTsuyoka/wanaKaishu/wanaRensa。

/** マスタリーの道(rogue-35: 四道)。 */
export type Road = 'bu' | 'mamori' | 'kage' | 'waza';

/** 道の名前(ログ・UI表示用)。 */
export const ROAD_NAME: Record<Road, string> = {
  bu: '武の道',
  mamori: '守の道',
  kage: '影の道',
  waza: '技の道',
};

/**
 * MasteryCounters(mastery.ts)のキー列。SkillNode.deed.counter の型に使う
 * (mastery.ts → skillNodes.ts の既存の一方向依存を保つため、Record のキー列を
 * ここで文字列合併として持ち、mastery.ts の MasteryCounters はこれを基に定義する)。
 */
export type MasteryCounterKey =
  | 'fistKills'
  | 'evades'
  | 'absorbed'
  | 'stealthStrikes'
  | 'trapKills'
  | 'oneHandFreeKills'
  | 'twoHandKills'
  | 'unhurtKills'
  | 'lowHpKills'
  | 'darkKills'
  | 'knifeKills';

/** カウンタの育て方(ノードのツールチップ・deed 進捗表示用)。 */
export const DEED_LABEL: Record<MasteryCounterKey, string> = {
  fistKills: '素手での討伐',
  evades: '回避成功',
  absorbed: '障壁が吸収した累計ダメージ',
  stealthStrikes: '未覚醒の敵への攻撃命中',
  trapKills: '罠での討伐',
  oneHandFreeKills: '片手武器かつ盾なしでの討伐',
  twoHandKills: '両手武器での討伐',
  unhurtKills: 'HP満タンでの討伐',
  lowHpKills: 'HP25%以下での討伐',
  darkKills: '「絞る」以下の明かりでの討伐',
  knifeKills: '投げナイフでの討伐',
};

/** スキルノード id(rogue-35: 四道25個)。 */
export type NodeId =
  // --- bu(武の道) ---
  | 'kenPunch'
  | 'kenMuku'
  | 'kenHaisui'
  | 'rengeki'
  | 'ryote'
  | 'katate'
  | 'nitoryu'
  | 'tosshin'
  // --- mamori(守の道) ---
  | 'jutsu'
  | 'tateKakage'
  | 'kaeshi'
  | 'kouka'
  | 'tenka'
  | 'hiKagari'
  | 'tateuchi'
  // --- kage(影の道) ---
  | 'shinShinobi'
  | 'shinMekiki'
  | 'keikai'
  | 'shinSegiri'
  | 'hiShibori'
  | 'shingan'
  | 'kawarimi'
  // --- waza(技の道) ---
  | 'wanaAmi'
  | 'knifeRico'
  | 'hiEnjin';

export const NODE_IDS: NodeId[] = [
  'kenPunch',
  'kenMuku',
  'kenHaisui',
  'rengeki',
  'ryote',
  'katate',
  'nitoryu',
  'tosshin',
  'jutsu',
  'tateKakage',
  'kaeshi',
  'kouka',
  'tenka',
  'hiKagari',
  'tateuchi',
  'shinShinobi',
  'shinMekiki',
  'keikai',
  'shinSegiri',
  'hiShibori',
  'shingan',
  'kawarimi',
  'wanaAmi',
  'knifeRico',
  'hiEnjin',
];

/** ノードの解禁要件(rogue-35): 単一カウンタの値がランクごとの閾値 at[] 以上か。 */
export interface NodeDeed {
  counter: MasteryCounterKey;
  /** ランク r の解禁に要るカウンタ値(length===maxRank)。at[0]===0 なら根ノード(常時ランクI解禁)。 */
  at: number[];
}

export interface SkillNode {
  id: NodeId;
  road: Road;
  name: string;
  deed: NodeDeed;
  /** ランク r までの累計コスト(単発は長さ1)。ライン=[1,2,3]。 */
  costs: number[];
  /** ランクごとの効果1行(UI と図鑑で使う)。 */
  descs: string[];
}

export const SKILL_NODES: Record<NodeId, SkillNode> = {
  // --- bu(武の道) -----------------------------------------------------------------
  kenPunch: {
    id: 'kenPunch',
    road: 'bu',
    name: '拳打',
    deed: { counter: 'fistKills', at: [0, 5, 15] },
    costs: [1, 2, 3],
    descs: ['素手時、攻撃+3', '素手時、攻撃+5', '素手時、攻撃+7'],
  },
  kenMuku: {
    id: 'kenMuku',
    road: 'bu',
    name: '無傷の型',
    deed: { counter: 'unhurtKills', at: [10] },
    costs: [2],
    descs: ['HP満タンで攻撃+2'],
  },
  kenHaisui: {
    id: 'kenHaisui',
    road: 'bu',
    name: '背水',
    deed: { counter: 'lowHpKills', at: [3] },
    costs: [3],
    descs: ['HP25%以下かつ障壁0のとき、回避+25%・攻撃+3'],
  },
  rengeki: {
    id: 'rengeki',
    road: 'bu',
    name: '連撃',
    deed: { counter: 'fistKills', at: [15] },
    costs: [2],
    descs: ['発動して隣接の敵へ素手で2連撃(1ターン)。装填6ターン'],
  },
  ryote: {
    id: 'ryote',
    road: 'bu',
    name: '両手保持',
    deed: { counter: 'oneHandFreeKills', at: [15] },
    costs: [2],
    descs: ['片手武器を装備し盾スロットが空のとき攻撃+3'],
  },
  katate: {
    id: 'katate',
    road: 'bu',
    name: '片手扱い',
    deed: { counter: 'twoHandKills', at: [15] },
    costs: [2],
    // 命中制はまだ無いので攻撃減で代替する(将来、命中率を導入したら命中−へ置換する)。
    descs: ['両手武器でも盾を装備できる(その間、攻撃−2)'],
  },
  nitoryu: {
    id: 'nitoryu',
    road: 'bu',
    name: '二刀流',
    deed: { counter: 'fistKills', at: [40] },
    costs: [3],
    descs: ['左手(盾スロット)に片手武器を持てる。近接命中後、同じ対象へ左手の攻の半分の追撃'],
  },
  tosshin: {
    id: 'tosshin',
    road: 'bu',
    name: '突進',
    deed: { counter: 'twoHandKills', at: [10] },
    costs: [2],
    descs: [
      '発動: 直線に最大2マス移動し(通過・終点は空セルのみ)、終点で隣接する敵1体へ通常近接攻撃(当てず移動だけでも可)。装填6ターン',
    ],
  },

  // --- mamori(守の道) -------------------------------------------------------------
  jutsu: {
    id: 'jutsu',
    road: 'mamori',
    name: '盾術',
    deed: { counter: 'evades', at: [5, 15, 40] },
    costs: [1, 2, 3],
    descs: ['盾装備中の回避+8%', '回避+12%', '回避+16%'],
  },
  tateKakage: {
    id: 'tateKakage',
    road: 'mamori',
    name: '掲盾',
    deed: { counter: 'evades', at: [15] },
    costs: [1],
    descs: ['盾装備中、遠隔攻撃への回避+20%(近接には効かない)'],
  },
  kaeshi: {
    id: 'kaeshi',
    road: 'mamori',
    name: '返し',
    deed: { counter: 'evades', at: [10, 25, 50] },
    costs: [1, 2, 3],
    descs: [
      '回避成功時、隣接の攻撃者へ攻の1/3の固定反撃(盾でも素手でも発動)',
      '反撃は攻の1/2',
      '反撃は攻の3/4',
    ],
  },
  kouka: {
    id: 'kouka',
    road: 'mamori',
    name: '硬化',
    deed: { counter: 'absorbed', at: [30, 100, 300] },
    costs: [1, 2, 3],
    descs: [
      '障壁が1以上ある間、被ダメージ−1(最低1)',
      '被ダメージ−2(最低1)',
      'さらに砕殻: 障壁が砕けた瞬間、隣接の敵へ攻の半分の固定ダメージ',
    ],
  },
  tenka: {
    id: 'tenka',
    road: 'mamori',
    name: '転化',
    deed: { counter: 'absorbed', at: [100] },
    costs: [2],
    descs: ['HP満タン時の自然回復ティックが障壁+1に変わる(上限24)'],
  },
  hiKagari: {
    id: 'hiKagari',
    road: 'mamori',
    name: '篝火',
    deed: { counter: 'absorbed', at: [30] },
    costs: [1],
    descs: ['「広げる」中の自然回復間隔−1ターン(最低2)'],
  },
  tateuchi: {
    id: 'tateuchi',
    road: 'mamori',
    name: '盾打ち',
    deed: { counter: 'evades', at: [25] },
    costs: [2],
    descs: [
      '発動: 隣接する敵1体を反対方向へ1歩ノックバック+固定3+盾品質ダメージ' +
        '(押し先が塞がっていれば押せずダメージのみ)。盾装備中のみ。装填6ターン',
    ],
  },

  // --- kage(影の道) ---------------------------------------------------------------
  shinShinobi: {
    id: 'shinShinobi',
    road: 'kage',
    name: '忍び足',
    deed: { counter: 'stealthStrikes', at: [5, 15, 40] },
    costs: [1, 2, 3],
    descs: [
      '敵の気づく距離−20%',
      'さらに追跡を諦める距離−25%',
      '気づく距離−35%・諦める距離−40%',
    ],
  },
  shinMekiki: {
    id: 'shinMekiki',
    road: 'kage',
    name: '目利き',
    deed: { counter: 'stealthStrikes', at: [5] },
    costs: [1],
    descs: ['敵ホバーの情報に持ち物を表示する'],
  },
  keikai: {
    id: 'keikai',
    road: 'kage',
    name: '警戒',
    deed: { counter: 'stealthStrikes', at: [15] },
    costs: [1],
    descs: ['遠隔攻撃への回避+10%(盾不要・掲盾と加算)'],
  },
  shinSegiri: {
    id: 'shinSegiri',
    road: 'kage',
    name: '背討ち',
    deed: { counter: 'stealthStrikes', at: [15] },
    costs: [2],
    descs: ['未覚醒の敵への近接攻撃ダメージ×2(気配感知の敵には無効)'],
  },
  hiShibori: {
    id: 'hiShibori',
    road: 'kage',
    name: '絞り撃ち',
    deed: { counter: 'darkKills', at: [3] },
    costs: [1],
    descs: ['「絞る」以下の明かりで攻撃+2'],
  },
  shingan: {
    id: 'shingan',
    road: 'kage',
    name: '心眼',
    deed: { counter: 'darkKills', at: [10] },
    costs: [3],
    descs: [
      '明かりの4段階目「消す」を解禁する(視界2・回復なし・気づかれにくい)。' +
        '「絞る」以下の明かりでは視界+1',
    ],
  },
  kawarimi: {
    id: 'kawarimi',
    road: 'kage',
    name: '替り身',
    deed: { counter: 'stealthStrikes', at: [25] },
    costs: [2],
    descs: [
      '発動: 隣接する敵1体と場所を入れ替える(攻撃なし)。疑似同士討ち: 旧位置に隣接する' +
        '覚醒中の近接敵(入れ替えた本人を除く)の一撃が入れ替わった敵に落ちる。装填8ターン',
    ],
  },

  // --- waza(技の道) ---------------------------------------------------------------
  wanaAmi: {
    id: 'wanaAmi',
    road: 'waza',
    name: '罠編み',
    deed: { counter: 'trapKills', at: [0, 5, 15] },
    costs: [1, 2, 3],
    descs: [
      '棘の罠を編める(威力8・装填10ターン・同時1)',
      '威力10・装填8・同時2・回収=即時再装填',
      '威力12・装填6・同時3・連鎖誘爆・遠隔起爆',
    ],
  },
  knifeRico: {
    id: 'knifeRico',
    road: 'waza',
    name: '跳弾',
    deed: { counter: 'knifeKills', at: [5] },
    costs: [2],
    descs: ['投げナイフ命中時、対象に隣接する敵1体へ半分ダメージ'],
  },
  hiEnjin: {
    id: 'hiEnjin',
    road: 'waza',
    name: '延焼の刃',
    deed: { counter: 'trapKills', at: [5] },
    costs: [2],
    descs: ['近接攻撃の命中時30%で敵を延焼させる(2ターン)'],
  },
};

/** 装着中スキル。rank は 1..maxRank(id)。 */
export interface EquippedSkill {
  id: NodeId;
  rank: number;
}

/** ノードの最大ランク(deed.at の長さ)。 */
export function maxRank(id: NodeId): number {
  return SKILL_NODES[id].deed.at.length;
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
export type KnotId =
  | 'yamiuchi'
  | 'kagearuki'
  | 'seisui'
  | 'shouha'
  | 'yagaeshi'
  | 'rentetsu'
  | 'kouken'
  | 'kakei'
  | 'nemuriito';

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
      ['shingan', 1],
    ],
  },
  kagearuki: {
    id: 'kagearuki',
    name: '影歩き',
    desc: '消灯中、敵が追跡を諦める距離をさらに半減する',
    parents: [
      ['shingan', 1],
      ['shinShinobi', 1],
    ],
  },
  seisui: {
    id: 'seisui',
    name: '静水',
    desc: '回避成功時、次の自分の近接攻撃+2(1回で消費)',
    parents: [
      ['keikai', 1],
      ['kaeshi', 1],
    ],
  },
  shouha: {
    id: 'shouha',
    name: '衝波',
    desc: '盾打ちのノックバックが2マスになる(押し先が塞がっていたら+2ダメージ)',
    parents: [
      ['tateuchi', 1],
      ['kouka', 1],
    ],
  },
  yagaeshi: {
    id: 'yagaeshi',
    name: '矢返し',
    desc: '遠隔攻撃の回避成功時、離れた射手にも返しが届く',
    parents: [
      ['tateKakage', 1],
      ['kaeshi', 2],
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
};

/** 結びが発動中か(両親を所定ランク以上で装着中)。 */
export function knotActive(eq: readonly EquippedSkill[], id: KnotId): boolean {
  const [[a, aMin], [b, bMin]] = KNOTS[id].parents;
  return rankOf(eq, a) >= aMin && rankOf(eq, b) >= bMin;
}

/** 排他: 両方を所定ランク以上で装着することはできない(rogue-35: 反撃排他は返し統合で消滅)。 */
export const EXCLUDES: readonly (readonly [readonly [NodeId, number], readonly [NodeId, number]])[] = [
  [
    ['kenMuku', 1],
    ['kenHaisui', 1],
  ], // 完璧主義 vs 捨て身
];
