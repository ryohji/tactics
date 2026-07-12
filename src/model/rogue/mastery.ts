// マスタリー(永続メタ)とスキルノード定義(rogue-23)。
// 「マスタリー(永続。系統ごとの使用実績)×スロット(ラン内。装着数)」の二層構造の
// MVP — 武技(arms)・盾(guard)・甲殻(carapace)の3系統だけを扱う。
// 全て純データ+純関数(クラス不使用)。永続カウンタの読み書きは state/masteryStore.ts、
// スロット・ドラフトのラン内状態は state/rogue.ts が持つ。

/** マスタリー系統。 */
export type MasterySystem = 'arms' | 'guard' | 'carapace';

/** 系統名(ログ・UI表示用)。 */
export const MASTERY_NAME: Record<MasterySystem, string> = {
  arms: '武技',
  guard: '盾',
  carapace: '甲殻',
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
}

export const INITIAL_MASTERY: MasteryCounters = { weaponKills: 0, evades: 0, absorbed: 0 };

/** 系統ごとのレベル1/2/3の閾値。 */
const THRESHOLDS: Record<MasterySystem, readonly [number, number, number]> = {
  arms: [10, 30, 80],
  guard: [5, 15, 40],
  carapace: [30, 100, 300],
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
  };
}

/** スキルノード id(7個・rogue-23 MVP)。 */
export type NodeId = 'kensan' | 'ryote' | 'katate' | 'jutsu' | 'ukekaeshi' | 'kouka' | 'tenka';

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

export const NODE_IDS: NodeId[] = ['kensan', 'ryote', 'katate', 'jutsu', 'ukekaeshi', 'kouka', 'tenka'];

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
    // 反撃自体は乱数を引かない固定値(戦闘の乱数列を守るため)。
    desc: '回避成功時、攻撃者へ攻撃力半分の固定反撃',
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
};

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
