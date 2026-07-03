// デバッグ調整UI（leva）。it-6 でゲーム HUD が主役になったため、こちらは
// 盤面パラメータ（プリセット/d/S/アリーナ）と可視化トグルのデバッグパネルに縮退。
// パネルは App 側で <Leva collapsed /> にして畳んでおく。
//
// store が単一の真実。leva は初期値を store から受け取り、onChange で store へ流すだけ。

import { useRef } from 'react';
import { useControls, folder } from 'leva';
import { useStore } from '../state/store';
import { PRESETS } from '../model/cathedral';

// leva の onChange 第3引数。マウント時の初回呼び出しを弾くため initial だけ参照する。
type ChangeCtx = { initial: boolean };

// d 変更時の occluder 再計算は壮大スケール（数万セル）で重い。ドラッグ中の連続再計算を
// 間引くためのデバウンス間隔（ms）。最終値は必ず反映される（最後の onChange が発火する）。
const D_DEBOUNCE_MS = 100;

const PRESET_OPTIONS: Record<string, string> = Object.fromEntries(
  Object.values(PRESETS).map((p) => [p.label, p.key]),
);

export function Controls() {
  const setParam = useStore((s) => s.setParam);
  const setToggle = useStore((s) => s.setToggle);
  const setPreset = useStore((s) => s.setPreset);

  const dTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // プリセット切替で arena 系スライダ表示を同期する間、param onChange の store 反映を抑止するフラグ。
  const syncing = useRef(false);

  const { params, toggles, presetKey } = useStore.getState();

  const [, set] = useControls(() => ({
    preset: {
      value: presetKey,
      options: PRESET_OPTIONS,
      label: 'アリーナ',
      onChange: (key: string, _path: string, ctx: ChangeCtx) => {
        if (ctx.initial) return;
        setPreset(key); // ゲームは store 購読で自動リビルド
        const p = useStore.getState().params;
        syncing.current = true;
        set({ d: p.d, Hmax: p.Hmax, Lmin: p.Lmin, Lmax: p.Lmax });
        syncing.current = false;
      },
    },
    d: {
      value: params.d,
      min: 0,
      max: 1.5,
      step: 0.01,
      label: 'd（進入禁止半径）',
      onChange: (v: number, _path: string, ctx: ChangeCtx) => {
        if (ctx.initial || syncing.current) return;
        if (dTimer.current !== null) clearTimeout(dTimer.current);
        dTimer.current = setTimeout(() => {
          dTimer.current = null;
          setParam('d', v);
        }, D_DEBOUNCE_MS);
      },
    },
    S: {
      value: params.S,
      min: 0.5,
      max: 3,
      step: 0.05,
      label: 'S（表示倍率）',
      onChange: (v: number, _path: string, ctx: ChangeCtx) => {
        if (ctx.initial) return;
        setParam('S', v);
      },
    },
    Hmax: {
      value: params.Hmax,
      min: 2,
      max: 40,
      step: 1,
      label: 'Hmax（水平半径）',
      onChange: (v: number, _path: string, ctx: ChangeCtx) => {
        if (ctx.initial || syncing.current) return;
        setParam('Hmax', Math.round(v));
      },
    },
    Lmin: {
      value: params.Lmin,
      min: 0,
      max: 40,
      step: 1,
      label: 'Lmin（層下限）',
      onChange: (v: number, _path: string, ctx: ChangeCtx) => {
        if (ctx.initial || syncing.current) return;
        const lmax = useStore.getState().params.Lmax;
        const clamped = Math.min(Math.round(v), lmax);
        if (clamped !== v) set({ Lmin: clamped });
        setParam('Lmin', clamped);
      },
    },
    Lmax: {
      value: params.Lmax,
      min: 0,
      max: 40,
      step: 1,
      label: 'Lmax（層上限）',
      onChange: (v: number, _path: string, ctx: ChangeCtx) => {
        if (ctx.initial || syncing.current) return;
        const lmin = useStore.getState().params.Lmin;
        const clamped = Math.max(Math.round(v), lmin);
        if (clamped !== v) set({ Lmax: clamped });
        setParam('Lmax', clamped);
      },
    },
    表示: folder({
      showTerrainMesh: {
        value: toggles.showTerrainMesh,
        label: '地形メッシュ',
        onChange: (v: boolean, _path: string, ctx: ChangeCtx) => {
          if (ctx.initial) return;
          setToggle('showTerrainMesh', v);
        },
      },
      showOccluderCells: {
        value: toggles.showOccluderCells,
        label: '占有セルの胞塗り',
        onChange: (v: boolean, _path: string, ctx: ChangeCtx) => {
          if (ctx.initial) return;
          setToggle('showOccluderCells', v);
        },
      },
      showZoc: {
        value: toggles.showZoc,
        label: '敵ZOC を表示',
        onChange: (v: boolean, _path: string, ctx: ChangeCtx) => {
          if (ctx.initial) return;
          setToggle('showZoc', v);
        },
      },
    }),
  }));

  // leva のパネルはグローバルに描画される。本コンポーネントは登録のみで DOM は持たない。
  return null;
}
