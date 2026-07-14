// スキルノードのデータ表(render/beastModels.ts と同じデータ表分離の流儀)。
// マスタリー系統・ノード id・効果定義・解禁要件を一元管理する。

/** マスタリー系統。 */
export type MasterySystem = 'arms' | 'guard' | 'carapace' | 'fist' | 'stealth' | 'trapper' | 'light';

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

/** スキルノード id(rogue-23 の7個 + rogue-24 の18個 = 25個)。 */
export type NodeId =
  | 'kensan'
  | 'ryote'
  | 'katate'
  | 'jutsu'
  | 'ukekaeshi'
  | 'kouka'
  | 'tenka'
  // rogue-24: 拳闘(fist)
  | 'kenPunch'
  | 'kenMigaru'
  | 'kenMikiri'
  | 'kenMuku'
  | 'kenHaisui'
  // rogue-24: 隠密(stealth)
  | 'shinShinobi'
  | 'shinMekiki'
  | 'shinSegiri'
  | 'shinKehai'
  // rogue-24: 罠師(trapper)
  | 'wanaTsuyoka'
  | 'wanaKaishu'
  | 'wanaRensa'
  | 'knifeRico'
  // rogue-24: 灯火(light)
  | 'hiShibori'
  | 'hiKagari'
  | 'hiShobo'
  | 'hiEnjin'
  // rogue-24: 盾(guard)
  | 'tateKakage';

export const NODE_IDS: NodeId[] = [
  'kensan',
  'ryote',
  'katate',
  'jutsu',
  'ukekaeshi',
  'kouka',
  'tenka',
  'kenPunch',
  'kenMigaru',
  'kenMikiri',
  'kenMuku',
  'kenHaisui',
  'shinShinobi',
  'shinMekiki',
  'shinSegiri',
  'shinKehai',
  'wanaTsuyoka',
  'wanaKaishu',
  'wanaRensa',
  'knifeRico',
  'hiShibori',
  'hiKagari',
  'hiShobo',
  'hiEnjin',
  'tateKakage',
];

export interface SkillNode {
  id: NodeId;
  system: MasterySystem;
  /** 解禁に要るその系統のマスタリーレベル。 */
  unlockLevel: number;
  /** スロットコスト(1〜3)。 */
  cost: number;
  name: string;
  /** 効果の1行説明(UI表示用)。 */
  desc: string;
}

export const SKILL_NODES: Record<NodeId, SkillNode> = {
  kensan: {
    id: 'kensan',
    system: 'arms',
    unlockLevel: 1,
    cost: 1,
    name: '研鑽',
    desc: '武器の攻撃+1',
  },
  ryote: {
    id: 'ryote',
    system: 'arms',
    unlockLevel: 2,
    cost: 2,
    name: '両手保持',
    desc: '片手武器を装備し盾スロットが空のとき攻撃+2',
  },
  katate: {
    id: 'katate',
    system: 'arms',
    unlockLevel: 3,
    cost: 2,
    name: '片手扱い',
    // 命中制はまだ無いので攻撃減で代替する(将来、命中率を導入したら命中−へ置換する)。
    desc: '両手武器でも盾を装備できる(その間、攻撃−2)',
  },
  jutsu: {
    id: 'jutsu',
    system: 'guard',
    unlockLevel: 1,
    cost: 1,
    name: '盾術',
    desc: '盾装備中の回避+5%',
  },
  ukekaeshi: {
    id: 'ukekaeshi',
    system: 'guard',
    unlockLevel: 2,
    cost: 2,
    name: '受け反撃',
    // 反撃自体は乱数を引かない固定値(戦闘の乱数列を守るため)。反撃系(kenMikiri)と排他。
    desc: '回避成功時、攻撃者へ攻撃力半分の固定反撃(見切りと同時装着不可)',
  },
  kouka: {
    id: 'kouka',
    system: 'carapace',
    unlockLevel: 1,
    cost: 1,
    name: '硬化',
    desc: '障壁が1以上ある間、被ダメージ−1(最低1)',
  },
  tenka: {
    id: 'tenka',
    system: 'carapace',
    unlockLevel: 2,
    cost: 2,
    name: '転化',
    desc: 'HP満タン時の自然回復ティックが障壁+1に変わる(上限24)',
  },

  // --- rogue-24: 拳闘(素手討伐で育つ) ---------------------------------------------
  kenPunch: {
    id: 'kenPunch',
    system: 'fist',
    unlockLevel: 1,
    cost: 1,
    name: '拳打',
    desc: '素手時、攻撃+3',
  },
  kenMigaru: {
    id: 'kenMigaru',
    system: 'fist',
    unlockLevel: 1,
    cost: 1,
    name: '身軽',
    desc: '素手時、回避+10%(盾不要)',
  },
  kenMikiri: {
    id: 'kenMikiri',
    system: 'fist',
    unlockLevel: 2,
    cost: 2,
    name: '見切り',
    desc: '素手時、回避成功で攻撃力半分の固定反撃(受け反撃と同時装着不可)',
  },
  kenMuku: {
    id: 'kenMuku',
    system: 'fist',
    unlockLevel: 2,
    cost: 2,
    name: '無傷の型',
    desc: 'HP満タンで攻撃+2',
  },
  kenHaisui: {
    id: 'kenHaisui',
    system: 'fist',
    unlockLevel: 3,
    cost: 3,
    name: '背水',
    desc: 'HP25%以下かつ障壁0のとき、回避+25%・攻撃+3',
  },

  // --- rogue-24: 隠密(未覚醒討伐で育つ) -------------------------------------------
  shinShinobi: {
    id: 'shinShinobi',
    system: 'stealth',
    unlockLevel: 1,
    cost: 1,
    name: '忍び足',
    desc: '敵の気づく距離−20%',
  },
  shinMekiki: {
    id: 'shinMekiki',
    system: 'stealth',
    unlockLevel: 1,
    cost: 1,
    name: '目利き',
    desc: '敵ホバーの情報に持ち物を表示する',
  },
  shinSegiri: {
    id: 'shinSegiri',
    system: 'stealth',
    unlockLevel: 2,
    cost: 2,
    name: '背討ち',
    desc: '未覚醒の敵への近接攻撃ダメージ×2(気配感知の敵には無効)',
  },
  shinKehai: {
    id: 'shinKehai',
    system: 'stealth',
    unlockLevel: 2,
    cost: 1,
    name: '気配遮断',
    desc: '敵が追跡を諦める距離−25%',
  },

  // --- rogue-24: 罠師(罠での討伐・発動で育つ) -------------------------------------
  wanaTsuyoka: {
    id: 'wanaTsuyoka',
    system: 'trapper',
    unlockLevel: 1,
    cost: 1,
    name: '罠強化',
    desc: '罠の威力・持続を品質+1相当で扱う',
  },
  wanaKaishu: {
    id: 'wanaKaishu',
    system: 'trapper',
    unlockLevel: 2,
    cost: 2,
    name: '遠隔回収',
    desc: '設置済みの自分の罠をクリックで回収できる(1ターン消費)',
  },
  wanaRensa: {
    id: 'wanaRensa',
    system: 'trapper',
    unlockLevel: 3,
    cost: 2,
    name: '連鎖',
    desc: '罠発動時、隣接セルの自分の罠も誘爆する',
  },
  knifeRico: {
    id: 'knifeRico',
    system: 'trapper',
    unlockLevel: 2,
    cost: 2,
    name: '跳弾',
    desc: '投げナイフ命中時、対象に隣接する敵1体へ半分ダメージ',
  },

  // --- rogue-24: 灯火(暗い明かりでの層通過で育つ) ---------------------------------
  hiShibori: {
    id: 'hiShibori',
    system: 'light',
    unlockLevel: 1,
    cost: 1,
    name: '絞り撃ち',
    desc: '「絞る」以下の明かりで攻撃+2',
  },
  hiKagari: {
    id: 'hiKagari',
    system: 'light',
    unlockLevel: 1,
    cost: 1,
    name: '篝火',
    desc: '「広げる」中の自然回復間隔−1ターン(最低2)',
  },
  hiShobo: {
    id: 'hiShobo',
    system: 'light',
    unlockLevel: 2,
    cost: 3,
    name: '消灯',
    desc: '明かりの4段階目「消す」を解禁する(視界2・回復なし・気づかれにくい)',
  },
  hiEnjin: {
    id: 'hiEnjin',
    system: 'light',
    unlockLevel: 2,
    cost: 2,
    name: '延焼の刃',
    desc: '近接攻撃の命中時30%で敵を延焼させる(2ターン)',
  },

  // --- rogue-24: 盾(対遠隔の対抗ノード) -------------------------------------------
  tateKakage: {
    id: 'tateKakage',
    system: 'guard',
    unlockLevel: 2,
    cost: 1,
    name: '掲盾',
    desc: '盾装備中、遠隔攻撃への回避+20%(近接には効かない)',
  },
};

/**
 * 反撃系ノード(同時装着不可)。ukekaeshi(受け反撃)と kenMikiri(見切り)は
 * どちらも「回避成功時に固定反撃」という同種の効果なので併用させない。
 * equipSkill(state/rogue.ts)がこの集合を見て装着UIで弾く。
 */
export const COUNTER_NODES: readonly NodeId[] = ['ukekaeshi', 'kenMikiri'];
