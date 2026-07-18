// マスタリー(永続メタ)の系統と実績カウント・レベル判定ロジック。
// スキルノード定義はskillNodes.ts に分離(rogue-23 で武技・盾・甲殻の3系統・7ノードを
// 実装。rogue-24 で拳闘・隠密・罠師・灯火の4系統・18ノード+盾「掲盾」を追加し全系統化。
// rogue-27 でライン(ランクI〜III)+単発+結び+排他のデータモデルへ再編)。
// 「マスタリー(永続。系統ごとの使用実績)×スロット(ラン内。装着数)」の二層構造。
// 全て純データ+純関数(クラス不使用)。永続カウンタの読み書きは state/masteryStore.ts、
// スロット・ドラフトのラン内状態は state/rogue.ts が持つ。

import type { EquippedSkill, MasterySystem, NodeId } from './skillNodes';
import { EXCLUDES, KNOTS, NODE_IDS, SKILL_NODES, rankOf } from './skillNodes';

// スキルノードのデータ表から系統定義とノード型を再輸出。
export {
  type MasterySystem,
  MASTERY_NAME,
  MASTERY_DEED,
  type NodeId,
  NODE_IDS,
  type SkillNode,
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
  /** 未覚醒の敵への攻撃命中(rogue-32: 隠密)。 */
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

/**
 * 全系統のうちどれか1つでもレベル1以上に育っているか。
 *
 * wanaAmi(罠編み)はランクIの解禁が系統レベル0(=マスタリー未育成でも常時解禁)という
 * データ(unlockLevels=[0,1,2])を持つため、takeable() は真にマスタリー0のプレイヤーに
 * 対しても非空(wanaAmi ランクIのみ)を返しうる。だが「支度」パネルの自動起動・関門
 * ドラフトの自動生成は、この関数で「本当に何か育っているか」を別途確認してから行う
 * (真にマスタリー0のプレイヤー・ボット・ゴールデンテストの操作列/乱数列を守る既存規律。
 * wanaAmi 自体は一度でも何かが育った後の支度/ドラフトの中で選べるので、恒久的に
 * 選べなくなるわけではない)。
 */
export function hasAnyMastery(levels: Record<MasterySystem, number>): boolean {
  return Object.values(levels).some((lv) => lv > 0);
}

/**
 * 系統マスタリーレベルから、そのノードが解禁済みの最大ランク(0..maxRank)を求める。
 * unlockLevels を先頭から走査し、系統レベル以下である間だけランクを進める
 * (unlockLevels は昇順が前提。wanaAmi は [0,1,2] なのでランクIはレベル0=最初から解禁)。
 */
export function unlockedRank(id: NodeId, levels: Record<MasterySystem, number>): number {
  const node = SKILL_NODES[id];
  const lvl = levels[node.system];
  let r = 0;
  for (let i = 0; i < node.unlockLevels.length; i++) {
    if (node.unlockLevels[i] <= lvl) r = i + 1;
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
export function takeable(
  eq: readonly EquippedSkill[],
  levels: Record<MasterySystem, number>,
): EquippedSkill[] {
  const out: EquippedSkill[] = [];
  for (const id of NODE_IDS) {
    const cur = rankOf(eq, id);
    const max = unlockedRank(id, levels);
    if (cur >= max) continue;
    const target = cur + 1;
    if (violatesExclude(eq, id, target)) continue;
    out.push({ id, rank: target });
  }
  return out;
}

/** 関門ドラフトの3枠に使うレーン。en=縁(同系統/結びの相方)・shinka=深化(ランク2以上)・nagare=流れ(全体)。 */
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
  levels: Record<MasterySystem, number>,
  rng: () => number,
): DraftEntry[] {
  const base = takeable(eq, levels);
  if (base.length === 0) return [];

  // en: rank===1 かつ(装着中ノードと同 system、または いずれかの結びの親で
  // もう片方の親が所定ランク以上で装着中)。
  const enPool = base.filter((c) => {
    if (c.rank !== 1) return false;
    const sys = SKILL_NODES[c.id].system;
    if (eq.some((e) => SKILL_NODES[e.id].system === sys)) return true;
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
