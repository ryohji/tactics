// マスタリー(永続メタ)とスキルノード定義(rogue-23 で武技・盾・甲殻の3系統・7ノードを
// 実装。rogue-24 で拳闘・隠密・罠師・灯火の4系統・18ノード+盾「掲盾」を追加し全系統化)。
// 「マスタリー(永続。系統ごとの使用実績)×スロット(ラン内。装着数)」の二層構造。
// 全て純データ+純関数(クラス不使用)。永続カウンタの読み書きは state/masteryStore.ts、
// スロット・ドラフトのラン内状態は state/rogue.ts が持つ。

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

/**
 * 永続カウンタ(死んでも残る。masteryStore.ts が localStorage に保存)。
 * 稼ぎプレイを避けるため、系統ごとの実績値をそのまま閾値判定に使う(離散式)。
 */
export interface MasteryCounters {
  /** 武器・素手での討伐(近接・薙ぎ払い・投げナイフ由来)。 */
  weaponKills: number;
  /** 盾の回避成功。 */
  evades: number;
  /** 障壁が吸収した累計ダメージ(absorbBarrier で実際に削れた量)。 */
  absorbed: number;
  /** 素手(武器null)討伐(rogue-24: 拳闘)。 */
  fistKills: number;
  /** 未覚醒の敵の討伐(rogue-24: 隠密)。 */
  stealthKills: number;
  /** 罠(triggerTrap 経由)での討伐(rogue-24: 罠師)。 */
  trapKills: number;
  /** 「絞る」以下の明かりで関門(崩落)を通過した回数(rogue-24: 灯火)。 */
  dimCollapses: number;
}

export const INITIAL_MASTERY: MasteryCounters = {
  weaponKills: 0,
  evades: 0,
  absorbed: 0,
  fistKills: 0,
  stealthKills: 0,
  trapKills: 0,
  dimCollapses: 0,
};

/** 系統ごとのレベル1/2/3の閾値。 */
const THRESHOLDS: Record<MasterySystem, readonly [number, number, number]> = {
  arms: [10, 30, 80],
  guard: [5, 15, 40],
  carapace: [30, 100, 300],
  fist: [5, 15, 40],
  stealth: [5, 15, 40],
  trapper: [5, 15, 40],
  light: [1, 3, 8],
};

function levelFor(count: number, th: readonly [number, number, number]): number {
  if (count >= th[2]) return 3;
  if (count >= th[1]) return 2;
  if (count >= th[0]) return 1;
  return 0;
}

/** カウンタから系統ごとのレベル(0〜3)を求める(純関数・離散式)。 */
export function masteryLevels(counters: MasteryCounters): Record<MasterySystem, number> {
  return {
    arms: levelFor(counters.weaponKills, THRESHOLDS.arms),
    guard: levelFor(counters.evades, THRESHOLDS.guard),
    carapace: levelFor(counters.absorbed, THRESHOLDS.carapace),
    fist: levelFor(counters.fistKills, THRESHOLDS.fist),
    stealth: levelFor(counters.stealthKills, THRESHOLDS.stealth),
    trapper: levelFor(counters.trapKills, THRESHOLDS.trapper),
    light: levelFor(counters.dimCollapses, THRESHOLDS.light),
  };
}

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

/**
 * 反撃系ノード(同時装着不可)。ukekaeshi(受け反撃)と kenMikiri(見切り)は
 * どちらも「回避成功時に固定反撃」という同種の効果なので併用させない。
 * equipSkill(state/rogue.ts)がこの集合を見て装着UIで弾く。
 */
export const COUNTER_NODES: readonly NodeId[] = ['ukekaeshi', 'kenMikiri'];

/** 系統・レベルから解禁済みノード id 列。 */
export function unlockedNodes(levels: Record<MasterySystem, number>): NodeId[] {
  return NODE_IDS.filter((id) => SKILL_NODES[id].unlockLevel <= levels[SKILL_NODES[id].system]);
}

/** 装着ノードのコスト合計。 */
export function equippedCost(ids: readonly NodeId[]): number {
  return ids.reduce((sum, id) => sum + SKILL_NODES[id].cost, 0);
}

/**
 * 候補プールから最大 n 個を非復元抽出する(関門ドラフト用)。プールが空なら
 * rng を一切呼ばない — マスタリー未育成のプレイヤーとゴールデンテストの経路で
 * 乱数列を変えないための制約(候補が1つ以上あるときだけ rng を引く)。
 */
export function draftCandidates(pool: readonly NodeId[], rng: () => number, n = 3): NodeId[] {
  const remaining = [...pool];
  const picked: NodeId[] = [];
  const count = Math.min(n, remaining.length);
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rng() * remaining.length);
    picked.push(remaining.splice(idx, 1)[0]);
  }
  return picked;
}
