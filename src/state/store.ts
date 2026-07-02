// 状態ストア（W4）。一方向データフローの中心。
// params / toggles / terrain と、それらから導出した各 Set・active を保持し、
// refresh() で model（classify）を呼んで再計算する。
//
// 型はここで凍結する。下流（W5〜W8）は本ファイルから型と useStore を import するだけ。
// model（fcc/terrain/classify）は編集しない。型の不足は store 側で吸収する。
//
// 再評価ポリシ（仕様10章 / DESIGN §1）: refresh は active / param / toggle 変更時のみ呼ぶ。
// 毎フレームは呼ばない。中規模アリーナ（数千セル）なら全再計算で十分軽い。

import { create } from 'zustand';
import {
  type Cell,
  type CellKey,
  cellKey,
  keyToCell,
  layer,
  horizRadius,
  neighbors,
  buildArena,
} from '../model/fcc';
import type { Terrain } from '../model/terrain';
import { createSampleTerrain, buildCathedral, PRESETS, DEFAULT_PRESET } from '../model/cathedral';
import {
  occluderSet as computeOccluders,
  reachable as computeReachable,
  threatened,
} from '../model/classify';

// --- 公開する型（凍結点） -----------------------------------------------------

/** 数値パラメータ（仕様11章の既定値）。すべて格子単位。S のみ表示倍率。 */
export interface Params {
  /** 表示倍率（worldPos のみに効く。ロジックは格子座標で行う）。 */
  S: number;
  /** 進入禁止＋遮蔽判定の許容半径。セル中心の地形SDF ≤ d で occluder。 */
  d: number;
  /** 脅威半径（敵からこの距離以内が脅威圏）。 */
  Rthreat: number;
  /** アリーナ水平半径。 */
  Hmax: number;
  /** アリーナ層範囲（下限）。 */
  Lmin: number;
  /** アリーナ層範囲（上限）。 */
  Lmax: number;
}

/**
 * 表示トグル群（仕様8章 / DESIGN §7 / it-2 決定）。
 * 地形と「自機・移動可能領域・脅威圏」を、それぞれセル塗りと稜線で併置トグルする。
 */
export interface Toggles {
  /** 地形のボリュームメッシュ（連続地形の姿）。既定 off。 */
  showTerrainMesh: boolean;
  /** 占有セル（進入禁止＋遮蔽）の胞塗り。既定 on（it-2 の主役表示）。 */
  showOccluderCells: boolean;
  /** 自機・到達セル（と脅威セル）をセル塗りで表示。 */
  showRegionCells: boolean;
  /** 自機・到達セル（と脅威セル）を菱形十二面体の稜線で表示。 */
  showRegionEdges: boolean;
  /** 脅威圏（敵から Rthreat 以内）の可視化。 */
  showThreat: boolean;
  /** 一人称（FP）視点。false は TP（三人称）。 */
  firstPerson: boolean;
}

export type ParamKey = keyof Params;
export type ToggleKey = keyof Toggles;

/** ストアの全状態（データ＋アクション）。 */
export interface State {
  // --- 入力状態（ユーザ操作で変わる） ---
  params: Params;
  toggles: Toggles;
  /** 地形SDF（占有判定と描画の唯一のソース）。setPreset で差し替わる。 */
  terrain: Terrain;
  /** 現在のアリーナプリセットキー（PRESETS のキー）。 */
  presetKey: string;
  /** 敵ユニット（脅威圏の素振り用）。it-1 は空。 */
  enemies: Cell[];

  // --- 導出状態（refresh で再計算。直接 set しない） ---
  /** 六角柱アリーナのセル集合。アリーナ系 param 変更時のみ再生成。 */
  arenaSet: Set<CellKey>;
  /** 進入禁止＋遮蔽セル集合。 */
  occluderSet: Set<CellKey>;
  /** active の1手到達セル集合（reachable の結果を Set 化）。 */
  reachableSet: Set<CellKey>;
  /** 脅威セル集合（通行可能セルのうち、いずれかの敵から Rthreat 以内）。 */
  threatSet: Set<CellKey>;
  /** 操作ユニット位置 P。常に arena 内・非 occluder。 */
  active: Cell;

  // --- アクション ---
  /** occluderSet → active 妥当性 → reachableSet を再計算して set。 */
  refresh: () => void;
  /** reachableSet に含まれる時のみ active を更新し refresh。 */
  setActive: (c: Cell) => void;
  /** param を更新。アリーナ系（Hmax/Lmin/Lmax）はアリーナ再生成、その後 refresh。 */
  setParam: <K extends ParamKey>(key: K, value: Params[K]) => void;
  /** アリーナプリセットを切替（地形・アリーナ・d を一括差し替えて全導出を再計算）。 */
  setPreset: (key: string) => void;
  /** toggle を更新。導出 Set には影響しないので refresh は不要。 */
  setToggle: <K extends ToggleKey>(key: K, value: Toggles[K]) => void;
}

// --- 既定値 -------------------------------------------------------------------

// it-5: アリーナは既定プリセット（廃墟大聖堂 / 人間スケール）から導出。
// 1セル=人型1体。recommendedArena が地形を内包し周囲に飛行余白を持つ Hmax/Lmax を返す。
// 旧 it-1〜3 は Hmax4 / L0..5(数千セル)。人間スケールの大聖堂は1万セル規模になりうる。
const DEFAULT_PARAMS: Params = {
  S: 1.4,
  d: DEFAULT_PRESET.d,
  Rthreat: 3,
  Hmax: DEFAULT_PRESET.arena.Hmax,
  Lmin: DEFAULT_PRESET.arena.Lmin,
  Lmax: DEFAULT_PRESET.arena.Lmax,
};

const DEFAULT_TOGGLES: Toggles = {
  showTerrainMesh: false,
  showOccluderCells: true,
  showRegionCells: true,
  showRegionEdges: false,
  showThreat: false,
  firstPerson: false,
};

// --- 純ヘルパ -----------------------------------------------------------------

/** Cell 配列を CellKey の Set に。reachable の結果を reachableSet 化する。 */
function toKeySet(cells: Cell[]): Set<CellKey> {
  const s = new Set<CellKey>();
  for (const c of cells) s.add(cellKey(c));
  return s;
}

/** k のセルが「通行可能セル」か。arena 内・非 occluder。 */
function isPassable(k: CellKey, arenaSet: Set<CellKey>, occluders: Set<CellKey>): boolean {
  return arenaSet.has(k) && !occluders.has(k);
}

/**
 * 初期 active の決定。「最下層付近の通行可能セル」を1つ選ぶ。
 * 移動可能な足場でなければ意味がないので、少なくとも1つ通行可能な近傍を持つセルを優先する
 * （地形内に孤立した1セルのポケットを避ける）。その中で 層 L 昇順 → 中心寄り（horizRadius 昇順）
 * → キー辞書順、の決定的順序で選ぶ。該当が無ければ任意の通行可能セルへフォールバック。
 * アリーナ再生成で active が arena 外/occluder 化した時の再選出にも使う。
 */
function pickActive(arenaSet: Set<CellKey>, occluders: Set<CellKey>): Cell {
  let best: Cell | null = null; // 近傍を持つ最良
  let bestKey = '';
  let bestL = Infinity;
  let bestR = Infinity;
  let fallback: Cell | null = null; // 近傍なしでも可の保険

  for (const k of arenaSet) {
    if (occluders.has(k)) continue;
    const c = keyToCell(k);
    if (fallback === null) fallback = c;
    const hasFreeNeighbor = neighbors(c).some((n) =>
      isPassable(cellKey(n), arenaSet, occluders),
    );
    if (!hasFreeNeighbor) continue;
    const L = layer(c);
    const r = horizRadius(c[0], c[1], c[2]);
    if (L < bestL || (L === bestL && r < bestR) || (L === bestL && r === bestR && k < bestKey)) {
      best = c;
      bestKey = k;
      bestL = L;
      bestR = r;
    }
  }

  const chosen = best ?? fallback;
  if (chosen === null) {
    throw new Error('pickActive: arena に通行可能セルが存在しない（地形 d が大きすぎる可能性）');
  }
  return chosen;
}

/** 格子ユークリッド距離。 */
function gridDist(a: Cell, b: Cell): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * 脅威圏検証用に敵を1体仮置きする。active から概ね Rthreat 前後の距離にある通行可能セルを選ぶ
 * （近すぎず遠すぎず、脅威圏が一部の到達セルに重なって見えるように）。決定的に選ぶ。
 * 候補が無ければ active から最も遠い通行可能セルにフォールバック。
 */
function pickEnemy(arenaSet: Set<CellKey>, occ: Set<CellKey>, active: Cell, Rthreat: number): Cell[] {
  let best: Cell | null = null;
  let bestScore = Infinity;
  let farthest: Cell | null = null;
  let farDist = -1;
  for (const k of arenaSet) {
    if (occ.has(k)) continue;
    const c = keyToCell(k);
    if (cellKey(c) === cellKey(active)) continue;
    const dist = gridDist(c, active);
    if (dist > farDist) {
      farDist = dist;
      farthest = c;
    }
    // Rthreat 前後を狙う（脅威圏が到達セルにちょうど絡む距離）。
    const score = Math.abs(dist - Rthreat * 1.2);
    if (score < bestScore || (score === bestScore && k < cellKey(best!))) {
      best = c;
      bestScore = score;
    }
  }
  const chosen = best ?? farthest;
  return chosen ? [chosen] : [];
}

/** arena 内の通行可能セルのうち、いずれかの敵から Rthreat 以内のものを脅威セルとする。 */
function deriveThreat(
  arenaSet: Set<CellKey>,
  occ: Set<CellKey>,
  enemies: Cell[],
  Rthreat: number,
): Set<CellKey> {
  const s = new Set<CellKey>();
  if (enemies.length === 0) return s;
  for (const k of arenaSet) {
    if (occ.has(k)) continue;
    if (threatened(keyToCell(k), enemies, Rthreat)) s.add(k);
  }
  return s;
}

/**
 * arenaSet / terrain / params / enemies / active から導出 Set を再計算する純関数。
 * active が arena 外・occluder になっていれば pickActive で選び直す（壊れた状態を防ぐ）。
 */
function derive(
  arenaSet: Set<CellKey>,
  terrain: Terrain,
  params: Params,
  enemies: Cell[],
  active: Cell,
): {
  occluderSet: Set<CellKey>;
  reachableSet: Set<CellKey>;
  threatSet: Set<CellKey>;
  active: Cell;
} {
  const occ = computeOccluders(arenaSet, terrain, params.d);
  let act = active;
  const akey = cellKey(act);
  if (!arenaSet.has(akey) || occ.has(akey)) {
    act = pickActive(arenaSet, occ);
  }
  const reachableSet = toKeySet(computeReachable(act, arenaSet, occ));
  const threatSet = deriveThreat(arenaSet, occ, enemies, params.Rthreat);
  return { occluderSet: occ, reachableSet, threatSet, active: act };
}

// --- ストア本体 ---------------------------------------------------------------
//
// create が返す useStore は React の hook であると同時に、getState / setState /
// subscribe を持つ。React 外（入力ハンドラ・レイキャスト）からは
//   useStore.getState().setActive(cell)
// のように呼べる。

export const useStore = create<State>((set, get) => {
  // 初期化: アリーナ構築 → 導出 → active 選出を一度走らせ、各 Set を埋める。
  const terrain = createSampleTerrain();
  const params: Params = { ...DEFAULT_PARAMS };
  const arenaSet = buildArena({ Lmin: params.Lmin, Lmax: params.Lmax, Hmax: params.Hmax });
  const initOcc = computeOccluders(arenaSet, terrain, params.d);
  const active = pickActive(arenaSet, initOcc);
  const reachableSet = toKeySet(computeReachable(active, arenaSet, initOcc));
  const enemies = pickEnemy(arenaSet, initOcc, active, params.Rthreat);
  const threatSet = deriveThreat(arenaSet, initOcc, enemies, params.Rthreat);

  return {
    params,
    toggles: { ...DEFAULT_TOGGLES },
    terrain,
    presetKey: DEFAULT_PRESET.key,
    enemies,
    arenaSet,
    occluderSet: initOcc,
    reachableSet,
    threatSet,
    active,

    refresh: () => {
      const s = get();
      set(derive(s.arenaSet, s.terrain, s.params, s.enemies, s.active));
    },

    setActive: (c: Cell) => {
      const s = get();
      if (!s.reachableSet.has(cellKey(c))) return; // 到達外は弾く
      // occluderSet / threatSet は active に依らない（arena・terrain・d・enemies のみに依存）。
      // 移動のたびに全アリーナセルの sdf 判定をやり直すと壮大スケールで重い（処理落ち→ジャンプ）。
      // 移動で変わるのは reachableSet（active の近傍のみ）だけなので、それだけ再計算する。
      const reachableSet = toKeySet(computeReachable(c, s.arenaSet, s.occluderSet));
      set({ active: c, reachableSet });
    },

    setParam: (key, value) => {
      const s = get();
      const nextParams: Params = { ...s.params, [key]: value };
      const arenaDirty = key === 'Hmax' || key === 'Lmin' || key === 'Lmax';
      const nextArena = arenaDirty
        ? buildArena({ Lmin: nextParams.Lmin, Lmax: nextParams.Lmax, Hmax: nextParams.Hmax })
        : s.arenaSet;
      set({ params: nextParams, arenaSet: nextArena });
      get().refresh();
    },

    setPreset: (key: string) => {
      const preset = PRESETS[key];
      if (!preset || key === get().presetKey) return;
      const s = get();
      // 地形・アリーナ・d を一括差し替え（S/Rthreat は現状維持）。
      const nextTerrain = buildCathedral(preset.spec);
      const nextParams: Params = {
        ...s.params,
        d: preset.d,
        Hmax: preset.arena.Hmax,
        Lmin: preset.arena.Lmin,
        Lmax: preset.arena.Lmax,
      };
      const nextArena = buildArena(preset.arena);
      // 全導出を作り直す（occluder → active 選出 → 敵仮置き → threat / reachable）。
      const occ = computeOccluders(nextArena, nextTerrain, nextParams.d);
      const active = pickActive(nextArena, occ);
      const enemies = pickEnemy(nextArena, occ, active, nextParams.Rthreat);
      const threatSet = deriveThreat(nextArena, occ, enemies, nextParams.Rthreat);
      const reachableSet = toKeySet(computeReachable(active, nextArena, occ));
      set({
        presetKey: key,
        terrain: nextTerrain,
        params: nextParams,
        arenaSet: nextArena,
        occluderSet: occ,
        reachableSet,
        threatSet,
        active,
        enemies,
      });
    },

    setToggle: (key, value) => {
      const s = get();
      set({ toggles: { ...s.toggles, [key]: value } });
    },
  };
});
