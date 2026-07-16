// マスタリー(永続メタ)の系統と実績カウント・レベル判定ロジック。
// スキルノード定義はskillNodes.ts に分離(rogue-23 で武技・盾・甲殻の3系統・7ノードを
// 実装。rogue-24 で拳闘・隠密・罠師・灯火の4系統・18ノード+盾「掲盾」を追加し全系統化)。
// 「マスタリー(永続。系統ごとの使用実績)×スロット(ラン内。装着数)」の二層構造。
// 全て純データ+純関数(クラス不使用)。永続カウンタの読み書きは state/masteryStore.ts、
// スロット・ドラフトのラン内状態は state/rogue.ts が持つ。

import type { MasterySystem, NodeId } from './skillNodes';
import { NODE_IDS, SKILL_NODES } from './skillNodes';

// スキルノードのデータ表から系統定義とノード型を再輸出。
export {
  type MasterySystem,
  MASTERY_NAME,
  type NodeId,
  NODE_IDS,
  type SkillNode,
  SKILL_NODES,
  COUNTER_NODES,
} from './skillNodes';

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

/** 系統ごとのレベル1/2/3の閾値(スキルツリー表示の進捗算出にも使うため公開)。 */
export const MASTERY_THRESHOLDS: Record<MasterySystem, readonly [number, number, number]> = {
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

const COUNTER_KEY: Record<MasterySystem, keyof MasteryCounters> = {
  arms: 'weaponKills',
  guard: 'evades',
  carapace: 'absorbed',
  fist: 'fistKills',
  stealth: 'stealthKills',
  trapper: 'trapKills',
  light: 'dimCollapses',
};

/** 系統の現在カウンタ値(スキルツリー表示の進捗表示用)。 */
export function counterFor(system: MasterySystem, counters: MasteryCounters): number {
  return counters[COUNTER_KEY[system]];
}

/** カウンタから系統ごとのレベル(0〜3)を求める(純関数・離散式)。 */
export function masteryLevels(counters: MasteryCounters): Record<MasterySystem, number> {
  return {
    arms: levelFor(counters.weaponKills, MASTERY_THRESHOLDS.arms),
    guard: levelFor(counters.evades, MASTERY_THRESHOLDS.guard),
    carapace: levelFor(counters.absorbed, MASTERY_THRESHOLDS.carapace),
    fist: levelFor(counters.fistKills, MASTERY_THRESHOLDS.fist),
    stealth: levelFor(counters.stealthKills, MASTERY_THRESHOLDS.stealth),
    trapper: levelFor(counters.trapKills, MASTERY_THRESHOLDS.trapper),
    light: levelFor(counters.dimCollapses, MASTERY_THRESHOLDS.light),
  };
}

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
