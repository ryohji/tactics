// マスタリー(永続メタ)の実績カウント・解禁判定ロジック(rogue-35: v3「四道」)。
// スキルノード定義はskillNodes.ts に分離。
// 「マスタリー(永続。ノードごとの行いの実績)×スロット(ラン内。装着数)」の二層構造は不変。
// rogue-27 で導入した「系統Lv(0〜3)」の層は rogue-35 で撤去し、ノードは自分の deed
// (1つのカウンタ+ランクごとの閾値 at)で直接解禁される(道は UI のグルーピングのみに使う)。
// 全て純データ+純関数(クラス不使用)。永続カウンタの読み書きは state/masteryStore.ts、
// スロット・ドラフトのラン内状態は state/rogue.ts が持つ。

import type { EquippedSkill, MasteryCounterKey, NodeId } from './skillNodes';
import { EXCLUDES, KNOTS, NODE_IDS, SKILL_NODES, rankOf } from './skillNodes';

// スキルノードのデータ表から道定義とノード型を再輸出。
export {
  type Road,
  ROAD_NAME,
  type MasteryCounterKey,
  DEED_LABEL,
  type NodeId,
  NODE_IDS,
  type SkillNode,
  type NodeDeed,
  SKILL_NODES,
  type EquippedSkill,
  maxRank,
  rankOf,
  cdOf,
  type KnotId,
  type Knot,
  KNOTS,
  knotActive,
  EXCLUDES,
} from './skillNodes';

/**
 * 永続カウンタ(死んでも残る。masteryStore.ts が localStorage に保存)。rogue-35 で
 * 「系統ごとの実績」から「1イベント=1の自動記録・ノード単位の deed」へ再編(v2)。
 * 稼ぎプレイを避けるため、そのまま閾値判定に使う(離散式)。
 */
export type MasteryCounters = Record<MasteryCounterKey, number>;

export const INITIAL_MASTERY: MasteryCounters = {
  fistKills: 0,
  evades: 0,
  absorbed: 0,
  stealthStrikes: 0,
  trapKills: 0,
  oneHandFreeKills: 0,
  twoHandKills: 0,
  unhurtKills: 0,
  lowHpKills: 0,
  darkKills: 0,
  knifeKills: 0,
};

/**
 * どれか1つでもカウンタが動いている(>0)か。真にマスタリー0のプレイヤー・ボット・
 * ゴールデンテストの操作列/乱数列を守るため、支度・関門ドラフトの自動起動条件に使う
 * (wanaAmi・kenPunch は counter=0 でも takeable だが、それは「1つも育っていない」とは
 * 区別する — rogue-27 由来の既存の体験を維持する)。
 */
export function hasAnyMastery(counters: MasteryCounters): boolean {
  return Object.values(counters).some((v) => v > 0);
}

/**
 * ノードの deed カウンタ値から、そのノードが解禁済みの最大ランク(0..maxRank)を求める。
 * at を先頭から走査し、カウンタ値以下である間だけランクを進める(at は昇順が前提。
 * 根ノードは at[0]===0 なのでランクIはカウンタ0でも解禁)。
 */
export function unlockedRank(id: NodeId, counters: MasteryCounters): number {
  const { counter, at } = SKILL_NODES[id].deed;
  const val = counters[counter];
  let r = 0;
  for (let i = 0; i < at.length; i++) {
    if (at[i] <= val) r = i + 1;
    else break;
  }
  return r;
}

/** 装着中スキルのコスト合計(Σ costs[rank-1])。 */
export function equippedCost(eq: readonly EquippedSkill[]): number {
  return eq.reduce((sum, e) => sum + SKILL_NODES[e.id].costs[e.rank - 1], 0);
}

/** target ランクで id を装着すると EXCLUDES のどれかに抵触するか(相手側が該当ランク以上で装着中)。 */
function violatesExclude(eq: readonly EquippedSkill[], id: NodeId, target: number): boolean {
  return EXCLUDES.some(([[a, aMin], [b, bMin]]) => {
    if (a === id && target >= aMin && rankOf(eq, b) >= bMin) return true;
    if (b === id && target >= bMin && rankOf(eq, a) >= aMin) return true;
    return false;
  });
}

/**
 * 現在装着可能な次ランクの候補一覧(支度・関門ドラフト・見送り権の共通土台)。
 * 各ノードで cur=rankOf、max=unlockedRank。cur<max なら次ランクを候補にする
 * (EXCLUDES 違反は除外)。
 */
export function takeable(eq: readonly EquippedSkill[], counters: MasteryCounters): EquippedSkill[] {
  const out: EquippedSkill[] = [];
  for (const id of NODE_IDS) {
    const cur = rankOf(eq, id);
    const max = unlockedRank(id, counters);
    if (cur >= max) continue;
    const target = cur + 1;
    if (violatesExclude(eq, id, target)) continue;
    out.push({ id, rank: target });
  }
  return out;
}

/** 関門ドラフトの3枠に使うレーン。en=縁(同じ道/結びの相方)・shinka=深化(ランク2以上)・nagare=流れ(全体)。 */
export type DraftLane = 'en' | 'shinka' | 'nagare';

export interface DraftEntry extends EquippedSkill {
  lane: DraftLane;
}

/**
 * 関門ドラフトの3枠を引く(rogue-27: 天秤ドラフト)。base(takeable)が空なら
 * **rng を一切引かず** [] を返す(マスタリー未育成のプレイヤーとゴールデンテストの
 * 経路で乱数列を守る既存規律)。
 *
 * レーン順 [en, shinka, nagare] に1枠ずつ引く。そのレーンのプールから採用済み
 * (同 id)を除き、空なら nagarePool(採用済み除外)へ縮退、それも空ならその枠は
 * スキップする(縮退・スキップいずれも rng を引かない)。lane には実際に使った
 * プールを記録する(縮退したら 'nagare')。
 */
export function draftLanes(
  eq: readonly EquippedSkill[],
  counters: MasteryCounters,
  rng: () => number,
): DraftEntry[] {
  const base = takeable(eq, counters);
  if (base.length === 0) return [];

  // en: rank===1 かつ(装着中ノードと同じ道、または いずれかの結びの親で
  // もう片方の親が所定ランク以上で装着中)。
  const enPool = base.filter((c) => {
    if (c.rank !== 1) return false;
    const road = SKILL_NODES[c.id].road;
    if (eq.some((e) => SKILL_NODES[e.id].road === road)) return true;
    return Object.values(KNOTS).some((k) => {
      const [[pa, minA], [pb, minB]] = k.parents;
      if (pa === c.id) return rankOf(eq, pb) >= minB;
      if (pb === c.id) return rankOf(eq, pa) >= minA;
      return false;
    });
  });
  const shinkaPool = base.filter((c) => c.rank >= 2);
  const nagarePool = base;

  const picked: DraftEntry[] = [];
  const lanes: { name: DraftLane; pool: EquippedSkill[] }[] = [
    { name: 'en', pool: enPool },
    { name: 'shinka', pool: shinkaPool },
    { name: 'nagare', pool: nagarePool },
  ];
  for (const lane of lanes) {
    let pool = lane.pool.filter((c) => !picked.some((p) => p.id === c.id));
    let laneName = lane.name;
    if (pool.length === 0) {
      pool = nagarePool.filter((c) => !picked.some((p) => p.id === c.id));
      laneName = 'nagare';
    }
    if (pool.length === 0) continue; // 縮退しても空 — この枠はスキップ(rng を引かない)
    const idx = Math.floor(rng() * pool.length);
    const chosen = pool[idx];
    picked.push({ id: chosen.id, rank: chosen.rank, lane: laneName });
  }
  return picked;
}

// 明示 import した EXCLUDES/rankOf/maxRank/NODE_IDS/SKILL_NODES は本ファイル内の
// 計算(violatesExclude・takeable・draftLanes・equippedCost 等)で使い、上の export
// ブロックで再輸出もしている(呼び出し側は引き続き './mastery' から import できる)。

/**
 * スコアボード/履歴に記録する文字列表現("id:rank")。rogue-27 でランク制になったため、
 * 旧来の id だけの文字列配列(NodeId[])から移行。表示側は ':' で分解して名前+ランク
 * バッジ(Ⅱ/Ⅲ)にする(state/scoreboard.ts buildRunPayload・state/history.ts 経由)。
 */
export function formatEquippedForRecord(eq: readonly EquippedSkill[]): string[] {
  return eq.map((e) => `${e.id}:${e.rank}`);
}
