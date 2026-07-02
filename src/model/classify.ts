// 分類ロジック（W3）。アリーナと地形SDF から、進入禁止/到達/脅威/遮蔽を算出する。
// Three 非依存の純 TS。全ロジックは格子座標空間（worldPos 前, S=1 相当）で行う。
// セル中心 = そのセルの格子座標 [x,y,z]。距離・d はすべて格子単位（仕様6・7・11章）。
//
// 上流: fcc.ts（Cell/CellKey/cellKey/keyToCell/neighbors）と terrain.ts（Terrain.sdf）のみ import。
// 本ファイルは両者を編集しない（型の境界に乗るだけ）。

import { type Cell, type CellKey, cellKey, keyToCell, neighbors } from './fcc';
import type { Terrain } from './terrain';

/**
 * 進入禁止＋遮蔽セル集合（DESIGN §4 / 仕様6章 occluderSet）。
 * arena 内で「セル中心の地形SDF ≤ d」のセルを集める。
 * sdf は最近接表面までの符号付き距離（負=内部）なので、内部セル（地中・岩の中）も
 * 距離 d 以内のセルも一括で拾える。判定は O(1)/セル、d を変えても即再計算できる。
 */
export function occluderSet(
  arenaSet: Set<CellKey>,
  terrain: Terrain,
  d: number,
): Set<CellKey> {
  const occ = new Set<CellKey>();
  for (const k of arenaSet) {
    const c = keyToCell(k);
    // Cell は [number,number,number]。Terrain.sdf は readonly Vec3 を取るのでそのまま渡せる。
    if (terrain.sdf(c) <= d) occ.add(k);
  }
  return occ;
}

/**
 * 1手到達セル（仕様7.3）。
 * neighbors(active) のうち arena 内・occluder でない・他ユニット非占有のもの。
 * occupied は任意（it-1 は他ユニットなしなので未指定でよい）。
 */
export function reachable(
  active: Cell,
  arenaSet: Set<CellKey>,
  occluderSet: Set<CellKey>,
  occupied?: Set<CellKey>,
): Cell[] {
  const out: Cell[] = [];
  for (const n of neighbors(active)) {
    const k = cellKey(n);
    if (!arenaSet.has(k)) continue; // arena 外
    if (occluderSet.has(k)) continue; // 地形（進入禁止）
    if (occupied?.has(k)) continue; // 他ユニット占有
    out.push(n);
  }
  return out;
}

/**
 * 複数歩到達（仕様7.3末尾, 任意）。neighbors を辺・移動コスト1とした BFS。
 * active から steps 手以内で到達できるセル集合を返す（active 自身は含めない）。
 * 各ステップで arena 外・occluder・占有を除外する。等方性によりグラフ距離はユークリッド距離とよく一致する。
 */
export function reachableWithin(
  active: Cell,
  steps: number,
  arenaSet: Set<CellKey>,
  occluderSet: Set<CellKey>,
  occupied?: Set<CellKey>,
): Cell[] {
  const visited = new Set<CellKey>([cellKey(active)]);
  const result: Cell[] = [];
  let frontier: Cell[] = [active];
  for (let s = 0; s < steps; s++) {
    const next: Cell[] = [];
    for (const c of frontier) {
      for (const n of neighbors(c)) {
        const k = cellKey(n);
        if (visited.has(k)) continue;
        if (!arenaSet.has(k)) continue;
        if (occluderSet.has(k)) continue;
        if (occupied?.has(k)) continue;
        visited.add(k);
        result.push(n);
        next.push(n);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return result;
}

/** 格子ユークリッド距離。 */
function euclid(a: Cell, b: Cell): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * 脅威圏（ZOC, 仕様7.4）。いずれかの敵から格子ユークリッド距離 Rthreat 以内なら true。
 * 球状の等方な脅威圏になる。
 */
export function threatened(c: Cell, enemies: Cell[], Rthreat: number): boolean {
  for (const e of enemies) {
    if (euclid(c, e) <= Rthreat) return true;
  }
  return false;
}

/** 近似 LoS（lineBlocked）のパラメータ（仕様7.5近似版・11章）。 */
export interface LineBlockedParams {
  /** 遮蔽判定の許容半径（格子単位, 仕様11章 d_occ ≈ 0.45）。標本の sdf ≤ dOcc で遮蔽。 */
  dOcc: number;
  /** サンプル間隔（線分長に対する割合, 0.12〜0.5）。小さいほど密。 */
  spacing: number;
}

/**
 * 視線遮蔽の近似版（仕様7.5 近似版）。
 * 線分 P→Q を等間隔サンプルし、いずれかの標本で地形SDF ≤ dOcc（地形内部 sdf≤0、または
 * 表面から dOcc 以内）なら遮蔽とみなす。端点 P,Q 自身は除外する。
 * サンプル数は spacing（線分長の割合）から決める: n = ceil(1/spacing) 区間、内点 t=1..n-1 を評価。
 */
export function lineBlocked(
  P: Cell,
  Q: Cell,
  terrain: Terrain,
  params: LineBlockedParams,
): boolean {
  const { dOcc, spacing } = params;
  const dx = Q[0] - P[0];
  const dy = Q[1] - P[1];
  const dz = Q[2] - P[2];
  // 退化（P==Q）は遮蔽なし。
  if (dx === 0 && dy === 0 && dz === 0) return false;
  const n = Math.max(2, Math.ceil(1 / spacing));
  for (let i = 1; i < n; i++) {
    const t = i / n; // 端点 (t=0, t=1) は除外
    const p: Cell = [P[0] + dx * t, P[1] + dy * t, P[2] + dz * t];
    if (terrain.sdf(p) <= dOcc) return true;
  }
  return false;
}
