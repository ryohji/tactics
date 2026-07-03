// 盤面ストア（it-6 で縮退）。地形・アリーナ・パラメータ・表示トグルの単一の真実。
// it-1〜5 のプロトタイプ用状態（active / enemies / reachableSet / threatSet）は
// ゲームルール層（state/game.ts）に置き換えられ撤去した。
//
// 再評価ポリシ（仕様10章 / DESIGN §1・§11）: occluderSet の再計算は地形・アリーナ・d の
// 変更時のみ。ユニットの移動では再計算しない（it-5 の教訓: 数万セルの sdf 判定は重い）。
// ゲーム層は occluderSet / arenaSet の参照変化を購読して盤面リセットする。

import { create } from 'zustand';
import { type CellKey, buildArena } from '../model/fcc';
import type { Terrain } from '../model/terrain';
import { createSampleTerrain, buildCathedral, PRESETS, DEFAULT_PRESET } from '../model/cathedral';
import { occluderSet as computeOccluders } from '../model/classify';

// --- 公開する型（凍結点） -----------------------------------------------------

/** 数値パラメータ。すべて格子単位。S のみ表示倍率。 */
export interface Params {
  /** 表示倍率（worldPos のみに効く。ロジックは格子座標で行う）。 */
  S: number;
  /** 進入禁止＋遮蔽判定の許容半径。セル中心の地形SDF ≤ d で occluder。 */
  d: number;
  /** アリーナ水平半径。 */
  Hmax: number;
  /** アリーナ層範囲（下限）。 */
  Lmin: number;
  /** アリーナ層範囲（上限）。 */
  Lmax: number;
}

/** 表示トグル群（it-6: ゲーム向け既定に変更）。 */
export interface Toggles {
  /** 地形のボリュームメッシュ（ゲームの見た目の主役）。既定 on。 */
  showTerrainMesh: boolean;
  /** 占有セル（進入禁止＋遮蔽）の胞塗り（デバッグ用）。既定 off。 */
  showOccluderCells: boolean;
  /** 敵 ZOC（敵ユニットの12近傍）の可視化。 */
  showZoc: boolean;
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

  // --- 導出状態（直接 set しない） ---
  /** 六角柱アリーナのセル集合。アリーナ系 param 変更時のみ再生成。 */
  arenaSet: Set<CellKey>;
  /** 進入禁止＋遮蔽セル集合。 */
  occluderSet: Set<CellKey>;

  // --- アクション ---
  /** param を更新。アリーナ系（Hmax/Lmin/Lmax）はアリーナ再生成、d は occluder 再計算。 */
  setParam: <K extends ParamKey>(key: K, value: Params[K]) => void;
  /** アリーナプリセットを切替（地形・アリーナ・d を一括差し替え）。 */
  setPreset: (key: string) => void;
  /** toggle を更新（導出 Set には影響しない）。 */
  setToggle: <K extends ToggleKey>(key: K, value: Toggles[K]) => void;
}

// --- 既定値 -------------------------------------------------------------------

const DEFAULT_PARAMS: Params = {
  S: 1.4,
  d: DEFAULT_PRESET.d,
  Hmax: DEFAULT_PRESET.arena.Hmax,
  Lmin: DEFAULT_PRESET.arena.Lmin,
  Lmax: DEFAULT_PRESET.arena.Lmax,
};

const DEFAULT_TOGGLES: Toggles = {
  showTerrainMesh: true,
  showOccluderCells: false,
  showZoc: false,
};

// --- ストア本体 ---------------------------------------------------------------
//
// create が返す useStore は React の hook であると同時に getState / setState / subscribe を持つ。
// React 外（ゲーム層・入力ハンドラ）からは useStore.getState() で読む。

export const useStore = create<State>((set, get) => {
  const terrain = createSampleTerrain();
  const params: Params = { ...DEFAULT_PARAMS };
  const arenaSet = buildArena({ Lmin: params.Lmin, Lmax: params.Lmax, Hmax: params.Hmax });
  const occluderSet = computeOccluders(arenaSet, terrain, params.d);

  return {
    params,
    toggles: { ...DEFAULT_TOGGLES },
    terrain,
    presetKey: DEFAULT_PRESET.key,
    arenaSet,
    occluderSet,

    setParam: (key, value) => {
      const s = get();
      const nextParams: Params = { ...s.params, [key]: value };
      const arenaDirty = key === 'Hmax' || key === 'Lmin' || key === 'Lmax';
      const nextArena = arenaDirty
        ? buildArena({ Lmin: nextParams.Lmin, Lmax: nextParams.Lmax, Hmax: nextParams.Hmax })
        : s.arenaSet;
      const occDirty = arenaDirty || key === 'd';
      const nextOcc = occDirty
        ? computeOccluders(nextArena, s.terrain, nextParams.d)
        : s.occluderSet;
      set({ params: nextParams, arenaSet: nextArena, occluderSet: nextOcc });
    },

    setPreset: (key: string) => {
      const preset = PRESETS[key];
      if (!preset || key === get().presetKey) return;
      const s = get();
      const nextTerrain = buildCathedral(preset.spec);
      const nextParams: Params = {
        ...s.params,
        d: preset.d,
        Hmax: preset.arena.Hmax,
        Lmin: preset.arena.Lmin,
        Lmax: preset.arena.Lmax,
      };
      const nextArena = buildArena(preset.arena);
      const nextOcc = computeOccluders(nextArena, nextTerrain, nextParams.d);
      set({
        presetKey: key,
        terrain: nextTerrain,
        params: nextParams,
        arenaSet: nextArena,
        occluderSet: nextOcc,
      });
    },

    setToggle: (key, value) => {
      const s = get();
      set({ toggles: { ...s.toggles, [key]: value } });
    },
  };
});
