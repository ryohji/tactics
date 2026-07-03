// 敵 AI（it-6）。純 TS・Three 非依存。1体ぶんの行動プランを返すだけで、状態は変更しない。
// 方針（DECISIONS 2026-07-02）:
//   1. 移動範囲（現在地含む）× 攻撃可能な相手 の全組合せをスコアリングし、最良があれば実行。
//      スコア = 期待ダメージ + 撃破見込み加点 + リーダー狙い加点 − 反撃リスク。
//   2. 攻撃できないなら最寄りのプレイヤーユニットへ近づく移動だけ行う。
//   3. リーダー（死霊王）は臆病: プレイヤーが LEADER_WAKE_DIST 以内に来るまで動かない
//      （現在地から攻撃できる場合は撃つ）。

import { type Cell, type CellKey, cellKey, keyToCell } from './fcc';
import {
  type Board,
  moveRange,
  pathTo,
  canAttackFrom,
  exchange,
  gridDist,
} from './rules';
import { type Unit, isLeader } from './units';

/** リーダーが動き出すプレイヤーとの距離。 */
export const LEADER_WAKE_DIST = 8;

/** 撃破見込み（命中時ダメージで倒せる）への加点。 */
const KILL_BONUS = 8;
/** 相手がリーダーの場合の加点。 */
const LEADER_BONUS = 4;
/** 反撃リスクの重み。 */
const COUNTER_WEIGHT = 0.7;

export interface AiPlan {
  /** 移動経路（現在地含む。移動しないなら長さ1）。 */
  path: Cell[];
  /** 移動後に攻撃する相手（しないなら null）。 */
  targetId: number | null;
}

/** 候補位置 from から target を攻撃する行動のスコア。 */
function attackScore(
  attacker: Unit,
  from: Cell,
  target: Unit,
  units: readonly Unit[],
  board: Board,
): number {
  const ex = exchange(attacker, from, target, units, board.terrain);
  const expected = (ex.attack.hit / 100) * ex.attack.dmg;
  let score = expected;
  if (ex.attack.dmg >= target.hp) score += KILL_BONUS * (ex.attack.hit / 100);
  if (isLeader(target)) score += LEADER_BONUS;
  if (ex.counter) score -= COUNTER_WEIGHT * (ex.counter.hit / 100) * ex.counter.dmg;
  return score;
}

/**
 * unit の行動プラン。決定的（同点はセルキー・対象 id の昇順で解決）。
 * units は盤上の全ユニット（この unit 自身を含む）。
 */
export function planUnit(unit: Unit, units: readonly Unit[], board: Board): AiPlan {
  const foes = units.filter((u) => u.alive && u.side !== unit.side);
  const stay: AiPlan = { path: [unit.pos], targetId: null };
  if (foes.length === 0) return stay;

  const nearestDist = Math.min(...foes.map((f) => gridDist(unit.pos, f.pos)));
  const asleep = isLeader(unit) && nearestDist > LEADER_WAKE_DIST;

  const range = moveRange(unit, units, board);
  // 候補位置 = 現在地 + （臆病リーダーでなければ）移動範囲。
  const candidates: Cell[] = [unit.pos];
  if (!asleep) {
    for (const k of [...range.dests].sort()) candidates.push(keyToCell(k));
  }

  // --- 1. 攻撃行動の探索 ---
  let best: { score: number; from: Cell; targetId: number } | null = null;
  for (const from of candidates) {
    for (const f of foes) {
      if (!canAttackFrom(unit, from, f, board.terrain)) continue;
      const score = attackScore(unit, from, f, units, board);
      if (
        best === null ||
        score > best.score + 1e-9 ||
        (Math.abs(score - best.score) <= 1e-9 && f.id < best.targetId)
      ) {
        best = { score, from, targetId: f.id };
      }
    }
  }
  if (best) {
    const path =
      cellKey(best.from) === cellKey(unit.pos)
        ? [unit.pos]
        : pathTo(unit.pos, best.from, range.parent);
    return { path, targetId: best.targetId };
  }

  if (asleep) return stay;

  // --- 2. 接近移動（最寄りの敵へ距離を詰める到達セルを選ぶ） ---
  let moveBest: { key: CellKey; dist: number } | null = null;
  for (const k of range.dests) {
    const c = keyToCell(k);
    const d = Math.min(...foes.map((f) => gridDist(c, f.pos)));
    if (moveBest === null || d < moveBest.dist - 1e-9 || (Math.abs(d - moveBest.dist) <= 1e-9 && k < moveBest.key)) {
      moveBest = { key: k, dist: d };
    }
  }
  if (moveBest && moveBest.dist < nearestDist) {
    return { path: pathTo(unit.pos, keyToCell(moveBest.key), range.parent), targetId: null };
  }
  return stay;
}
