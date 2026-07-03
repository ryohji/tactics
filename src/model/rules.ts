// 戦術ルール（it-6）。足場・ZOC・移動範囲・射線・戦闘予測/解決・配置。純 TS・Three 非依存。
// 数値・ルールの根拠は DECISIONS 2026-07-02。盤面（arena/occluder/terrain）は state/store.ts の
// 前計算を Board として受け取るだけで、本ファイルは何も再計算しない（it-5 の教訓を維持）。

import {
  type Cell,
  type CellKey,
  cellKey,
  keyToCell,
  layer,
  neighbors,
  OFFSETS,
} from './fcc';
import type { Terrain } from './terrain';
import { toFrame } from './terrain';
import { type Unit, type Side, CLASSES, isFlying } from './units';

/** 盤面（state/store.ts の前計算を束ねたビュー）。 */
export interface Board {
  arenaSet: Set<CellKey>;
  occluderSet: Set<CellKey>;
  terrain: Terrain;
  /** アリーナ層下限（この層は大地とみなし歩行の足場になる）。 */
  Lmin: number;
}

// --- 幾何ヘルパ ---------------------------------------------------------------

/** 格子ユークリッド距離。 */
export function gridDist(a: Cell, b: Cell): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** 下層への3近傍オフセット（Σ=-2 ⇔ ΔL=-1）。 */
const DOWN_OFFSETS = OFFSETS.filter((o) => o[0] + o[1] + o[2] === -2);

/** 隣接（12近傍）か。オフセットのノルムは全て √2。 */
export function isAdjacent(a: Cell, b: Cell): boolean {
  return gridDist(a, b) <= 1.5 && !(a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
}

// --- 足場（歩行ユニットの移動制約） -------------------------------------------

/**
 * c が足場セルか。下3近傍のいずれかが occluder（=地形の直上に立てる）、
 * または層が Lmin（アリーナ底＝大地扱い）なら足場。
 */
export function hasFooting(c: Cell, board: Board): boolean {
  if (layer(c) <= board.Lmin) return true;
  for (const o of DOWN_OFFSETS) {
    if (board.occluderSet.has(cellKey([c[0] + o[0], c[1] + o[1], c[2] + o[2]]))) return true;
  }
  return false;
}

// --- 占有と ZOC ---------------------------------------------------------------

/** 生存ユニットの占有マップ（cellKey → Unit）。 */
export function occupancy(units: readonly Unit[]): Map<CellKey, Unit> {
  const m = new Map<CellKey, Unit>();
  for (const u of units) if (u.alive) m.set(cellKey(u.pos), u);
  return m;
}

/**
 * side 陣営が張る ZOC セル集合（各生存ユニットの12近傍）。
 * 3D なので ZOC は球殻状に広がり、空中にも「壁」が立つ。
 */
export function zocSet(units: readonly Unit[], side: Side): Set<CellKey> {
  const s = new Set<CellKey>();
  for (const u of units) {
    if (!u.alive || u.side !== side) continue;
    for (const n of neighbors(u.pos)) s.add(cellKey(n));
  }
  return s;
}

// --- 移動範囲（ZOC・足場・占有つき BFS） ---------------------------------------

export interface MoveRange {
  /** 移動先にできるセル（現在地は含まない）。 */
  dests: Set<CellKey>;
  /** BFS 親ポインタ（経路復元用）。開始セルの親はなし。 */
  parent: Map<CellKey, CellKey>;
}

/**
 * unit の移動範囲。12近傍 BFS を CLASSES[cls].move 深さまで。
 * - 通行: arena 内・非 occluder・敵占有でない。歩行（非飛行）は足場セルのみ。
 * - 味方占有セルは通過可・停止不可。
 * - 敵 ZOC セルに入ったらそこで移動終了（進入可・通過不可）。
 */
export function moveRange(unit: Unit, units: readonly Unit[], board: Board): MoveRange {
  const cls = CLASSES[unit.cls];
  const fly = isFlying(unit);
  const occ = occupancy(units);
  const enemyZoc = zocSet(units, unit.side === 'player' ? 'enemy' : 'player');
  const startKey = cellKey(unit.pos);

  const dests = new Set<CellKey>();
  const parent = new Map<CellKey, CellKey>();
  const visited = new Set<CellKey>([startKey]);
  let frontier: Cell[] = [unit.pos];

  for (let step = 0; step < cls.move && frontier.length > 0; step++) {
    const next: Cell[] = [];
    for (const c of frontier) {
      const ck = cellKey(c);
      // 敵 ZOC に入ったセルからは先へ進めない（開始セルは除く: ZOC 内から出るのは可）。
      if (ck !== startKey && enemyZoc.has(ck)) continue;
      for (const n of neighbors(c)) {
        const k = cellKey(n);
        if (visited.has(k)) continue;
        if (!board.arenaSet.has(k)) continue;
        if (board.occluderSet.has(k)) continue;
        if (!fly && !hasFooting(n, board)) continue;
        const occupant = occ.get(k);
        if (occupant && occupant.side !== unit.side) continue; // 敵占有は通行不可
        visited.add(k);
        parent.set(k, ck);
        if (!occupant) dests.add(k); // 味方占有は通過のみ（停止不可）
        next.push(n);
      }
    }
    frontier = next;
  }
  return { dests, parent };
}

/** BFS 親ポインタから 開始→goal の経路（両端含む）を復元する。 */
export function pathTo(start: Cell, goal: Cell, parent: Map<CellKey, CellKey>): Cell[] {
  const path: Cell[] = [goal];
  let k = cellKey(goal);
  const startKey = cellKey(start);
  while (k !== startKey) {
    const p = parent.get(k);
    if (p === undefined) return [start, goal]; // 想定外（直行にフォールバック）
    path.push(keyToCell(p));
    k = p;
  }
  return path.reverse();
}

// --- 射線（LoS）と遮蔽 ---------------------------------------------------------

export type LosStatus = 'clear' | 'cover' | 'blocked';

/** 射線判定の閾値（格子単位）。 */
export const LOS_BLOCK = 0.25; // min sdf がこれ以下 → 射線なし（対象にできない）
export const LOS_COVER = 0.9; // min sdf がこれ以下 → 遮蔽（命中 -25%）
const LOS_END_MARGIN = 0.8; // 端点近傍は評価しない（射手/的が壁際でも自遮蔽しない）

/**
 * P→Q の射線。線分を等間隔サンプルし min sdf で判定する（端点近傍は除外）。
 * 近接攻撃には使わない（隣接は常に射線あり扱い）。
 */
export function losStatus(P: Cell, Q: Cell, terrain: Terrain): LosStatus {
  const dist = gridDist(P, Q);
  if (dist <= 1.5) return 'clear';
  const n = Math.max(3, Math.ceil(dist / 0.4));
  let minSdf = Infinity;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const along = t * dist;
    if (along < LOS_END_MARGIN || dist - along < LOS_END_MARGIN) continue;
    const p: readonly [number, number, number] = [
      P[0] + (Q[0] - P[0]) * t,
      P[1] + (Q[1] - P[1]) * t,
      P[2] + (Q[2] - P[2]) * t,
    ];
    const v = terrain.sdf(p);
    if (v < minSdf) minSdf = v;
  }
  if (minSdf <= LOS_BLOCK) return 'blocked';
  if (minSdf <= LOS_COVER) return 'cover';
  return 'clear';
}

// --- 戦闘予測・解決 -------------------------------------------------------------

/** 支援: 対象位置に隣接する（自身以外の）side 陣営の生存ユニット数。 */
export function adjacentAllies(
  pos: Cell,
  side: Side,
  units: readonly Unit[],
  selfId?: number,
): number {
  let n = 0;
  for (const u of units) {
    if (!u.alive || u.side !== side || u.id === selfId) continue;
    if (isAdjacent(pos, u.pos)) n++;
  }
  return n;
}

/** 戦闘補正の定数。 */
export const SUPPORT_HIT = 8; // 隣接味方1体あたりの命中補正%
export const SUPPORT_MAX = 24; // 支援補正の上限（3体分）
export const HEIGHT_HIT = 10; // 高所（攻撃側が上層）の命中補正%
export const COVER_HIT = 25; // 遮蔽の命中減%
export const HIT_MIN = 5;
export const HIT_MAX = 100;

/** 片方向の攻撃予測。 */
export interface Forecast {
  /** 命中%（5..100 に clamp 済み）。 */
  hit: number;
  /** 命中時ダメージ。 */
  dmg: number;
  /** 高低差補正（+1=高所 / -1=低所 / 0）。 */
  height: -1 | 0 | 1;
  /** 遮蔽ペナルティが乗ったか。 */
  cover: boolean;
  /** 攻撃側の支援数（隣接味方）。 */
  support: number;
  /** 防御側の支援数。 */
  defSupport: number;
}

/**
 * from に立つ attacker が defender を攻撃する時の予測。
 * 命中 = clamp(基礎hit − 回避 + 高低差±10 + 支援×8(≤24) − 被支援×8(≤24) − 遮蔽25, 5..100)。
 * ダメージ = max(1, atk − def + 高低差±1)。
 */
export function forecast(
  attacker: Unit,
  from: Cell,
  defender: Unit,
  units: readonly Unit[],
  terrain: Terrain,
): Forecast {
  const ac = CLASSES[attacker.cls];
  const dc = CLASSES[defender.cls];
  const dL = layer(from) - layer(defender.pos);
  const height: -1 | 0 | 1 = dL >= 1 ? 1 : dL <= -1 ? -1 : 0;
  const support = adjacentAllies(from, attacker.side, units, attacker.id);
  const defSupport = adjacentAllies(defender.pos, defender.side, units, defender.id);
  const ranged = gridDist(from, defender.pos) > 1.5;
  const cover = ranged && losStatus(from, defender.pos, terrain) === 'cover';

  let hit =
    ac.hit -
    dc.evade +
    height * HEIGHT_HIT +
    Math.min(SUPPORT_MAX, support * SUPPORT_HIT) -
    Math.min(SUPPORT_MAX, defSupport * SUPPORT_HIT) -
    (cover ? COVER_HIT : 0);
  hit = Math.max(HIT_MIN, Math.min(HIT_MAX, hit));

  const dmg = Math.max(1, ac.atk - dc.def + height);
  return { hit, dmg, height, cover, support, defSupport };
}

/** from から target を攻撃できるか（射程 + 射線。射程外・射線なしは不可）。 */
export function canAttackFrom(
  attacker: Unit,
  from: Cell,
  target: Unit,
  terrain: Terrain,
): boolean {
  const cls = CLASSES[attacker.cls];
  const dist = gridDist(from, target.pos);
  if (dist < cls.minRange || dist > cls.maxRange) return false;
  if (dist > 1.5 && losStatus(from, target.pos, terrain) === 'blocked') return false;
  return true;
}

/** 攻撃予測の往復（反撃込み）。counter は防御側が生存して射程内の場合のみ。 */
export interface Exchange {
  attack: Forecast;
  /** 反撃予測（不可能なら null）。 */
  counter: Forecast | null;
}

export function exchange(
  attacker: Unit,
  from: Cell,
  defender: Unit,
  units: readonly Unit[],
  terrain: Terrain,
): Exchange {
  const attack = forecast(attacker, from, defender, units, terrain);
  // 反撃可否は「攻撃側が from に居る」前提で判定する（defender から見た射程・射線）。
  const canCounter =
    attacker.hp > 0 && canAttackFrom(defender, defender.pos, { ...attacker, pos: from }, terrain);
  const counter = canCounter ? forecast(defender, defender.pos, { ...attacker, pos: from }, units, terrain) : null;
  return { attack, counter };
}

// --- スキル（ヒール・浮遊） -----------------------------------------------------

export const HEAL_AMOUNT = 6;
export const SKILL_RANGE = 2.9; // ヒール/浮遊の射程（格子ユークリッド。2ステップ分をほぼ覆う）
export const LEVITATE_TURNS = 2; // 自陣営ターン終了ごとに-1。付与直後+次ターンまで有効

/** skill を from から target に使えるか。 */
export function canUseSkill(
  caster: Unit,
  from: Cell,
  skill: 'heal' | 'levitate',
  target: Unit,
): boolean {
  if (!target.alive || target.side !== caster.side || target.id === caster.id) return false;
  if (gridDist(from, target.pos) > SKILL_RANGE) return false;
  if (skill === 'heal') return target.hp < CLASSES[target.cls].hp;
  // 浮遊は「生来飛行でない」味方が対象（重ねがけは残ターン更新として許可）。
  return !CLASSES[target.cls].fly;
}

// --- 降着（浮遊切れ） -----------------------------------------------------------

/**
 * 浮遊が切れた歩行ユニットの降着先。現在地が足場ならそのまま。
 * そうでなければ下方向のみの BFS で最も近い空き足場セルへ落ちる（決定的）。
 * 落下先が無い（完全に塞がれた）場合は現在地に留まる（浮遊の残滓が支える、とする）。
 */
export function landingCell(
  pos: Cell,
  board: Board,
  units: readonly Unit[],
  selfId: number,
): Cell {
  if (hasFooting(pos, board)) return pos;
  const occ = occupancy(units.filter((u) => u.id !== selfId));
  const visited = new Set<CellKey>([cellKey(pos)]);
  let frontier: Cell[] = [pos];
  while (frontier.length > 0) {
    const next: Cell[] = [];
    for (const c of frontier) {
      for (const o of DOWN_OFFSETS) {
        const n: Cell = [c[0] + o[0], c[1] + o[1], c[2] + o[2]];
        const k = cellKey(n);
        if (visited.has(k)) continue;
        visited.add(k);
        if (!board.arenaSet.has(k) || board.occluderSet.has(k) || occ.has(k)) continue;
        if (hasFooting(n, board)) return n;
        next.push(n);
      }
    }
    // 同層内の決定的順序（キー辞書順）で次フロンティアを並べ替え、再現性を保つ。
    frontier = next.sort((a, b) => (cellKey(a) < cellKey(b) ? -1 : 1));
  }
  return pos;
}

// --- 配置（デプロイ） -----------------------------------------------------------

/**
 * 両陣営のスポーンアンカー。通行可能な足場セルのうち、大聖堂の長手軸（フレーム a 座標）の
 * 西端寄り（プレイヤー）/ 東端寄り（敵）を決定的に選ぶ。低層・中央寄り（|b| 小）を優先。
 */
export function spawnAnchors(board: Board): { player: Cell; enemy: Cell } {
  let west: Cell | null = null;
  let east: Cell | null = null;
  let westScore = Infinity;
  let eastScore = Infinity;
  for (const k of board.arenaSet) {
    if (board.occluderSet.has(k)) continue;
    const c = keyToCell(k);
    if (!hasFooting(c, board)) continue;
    const [a, u, b] = toFrame(c);
    const base = u * 0.8 + Math.abs(b) * 0.3;
    const w = a + base;
    const e = -a + base;
    if (w < westScore || (w === westScore && k < cellKey(west!))) {
      west = c;
      westScore = w;
    }
    if (e < eastScore || (e === eastScore && k < cellKey(east!))) {
      east = c;
      eastScore = e;
    }
  }
  if (!west || !east) throw new Error('spawnAnchors: 足場のある通行セルが見つからない');
  return { player: west, enemy: east };
}

export const DEPLOY_RADIUS = 4;

/**
 * 配置ゾーン: アンカーから半径 DEPLOY_RADIUS 以内の通行セル（BFS 連結・足場の有無は問わない。
 * 歩行ユニットを置けるかは UI 側で hasFooting により絞る）。
 */
export function deployZone(anchor: Cell, board: Board): Set<CellKey> {
  const zone = new Set<CellKey>();
  const visited = new Set<CellKey>([cellKey(anchor)]);
  zone.add(cellKey(anchor));
  let frontier: Cell[] = [anchor];
  while (frontier.length > 0) {
    const next: Cell[] = [];
    for (const c of frontier) {
      for (const n of neighbors(c)) {
        const k = cellKey(n);
        if (visited.has(k)) continue;
        visited.add(k);
        if (!board.arenaSet.has(k) || board.occluderSet.has(k)) continue;
        if (gridDist(n, anchor) > DEPLOY_RADIUS) continue;
        zone.add(k);
        next.push(n);
      }
    }
    frontier = next;
  }
  return zone;
}

/**
 * 初期自動配置。ゾーン内をアンカーに近い順（同距離はキー順）に並べ、ロスター順に
 * 互換セル（歩行なら足場）へ割り当てる。割り当て結果で units の pos を書き換えて返す。
 */
export function autoDeploy(units: Unit[], anchor: Cell, zone: Set<CellKey>, board: Board): void {
  const cells = [...zone]
    .map((k) => keyToCell(k))
    .sort((p, q) => {
      const dp = gridDist(p, anchor);
      const dq = gridDist(q, anchor);
      return dp !== dq ? dp - dq : cellKey(p) < cellKey(q) ? -1 : 1;
    });
  const taken = new Set<CellKey>();
  for (const u of units) {
    const needFooting = !isFlying(u);
    const cell = cells.find((c) => {
      const k = cellKey(c);
      return !taken.has(k) && (!needFooting || hasFooting(c, board));
    });
    if (!cell) throw new Error(`autoDeploy: ${u.name} を置けるセルが配置ゾーンにない`);
    taken.add(cellKey(cell));
    u.pos = cell;
  }
}
