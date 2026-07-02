// W8: パラメータ実時間調整UI（leva）。DESIGN §7。
//
// store が単一の真実。leva は初期値を store の現在値から受け取り（store→leva）、
// 各 onChange で setParam/setToggle を呼んで store に流す（leva→store）。
// params/toggles は本 UI からしか変わらない（active はクリックで変わるが params には触れない）ので、
// leva 側を権威として持って構わない。再計算・アリーナ再生成は setParam 内の store 側が行うため、
// UI は値を流すだけでよい。
//
// store.ts / Scene.tsx / App.tsx は触らない（import のみ）。

import { useRef } from 'react';
import { useControls, folder } from 'leva';
import { useStore } from '../state/store';
import { PRESETS } from '../model/cathedral';

// leva の onChange 第3引数。マウント時の初回呼び出しを弾くため initial だけ参照する。
type ChangeCtx = { initial: boolean };

// d 変更時の occluder 再計算は壮大スケール（数万セル）で重い。ドラッグ中の連続再計算を
// 間引くためのデバウンス間隔（ms）。最終値は必ず反映される（最後の onChange が発火する）。
const D_DEBOUNCE_MS = 100;

// プリセット選択肢（leva の options は { ラベル: 値 }）。cathedral.PRESETS から生成。
const PRESET_OPTIONS: Record<string, string> = Object.fromEntries(
  Object.values(PRESETS).map((p) => [p.label, p.key]),
);

export function Controls() {
  const setParam = useStore((s) => s.setParam);
  const setToggle = useStore((s) => s.setToggle);
  const setPreset = useStore((s) => s.setPreset);

  // d のデバウンス用タイマ。ドラッグ中に来る連続 onChange を最後の1回へ畳む。
  const dTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // プリセット切替で arena 系スライダ表示を同期する間、param onChange の store 反映を抑止するフラグ。
  const syncing = useRef(false);

  // 初期表示値は store の現在値（既定プリセットのアリーナ・d）。
  const { params, toggles, presetKey } = useStore.getState();

  const [, set] = useControls(() => ({
    // アリーナ切替（地形・アリーナ・d を一括差し替え）。最上部に出す。
    preset: {
      value: presetKey,
      options: PRESET_OPTIONS,
      label: 'アリーナ',
      onChange: (key: string, _path: string, ctx: ChangeCtx) => {
        if (ctx.initial) return;
        setPreset(key);
        // 切替で変わった d/Hmax/Lmin/Lmax を leva 表示に反映（その間 onChange の store 反映は抑止）。
        const p = useStore.getState().params;
        syncing.current = true;
        set({ d: p.d, Hmax: p.Hmax, Lmin: p.Lmin, Lmax: p.Lmax });
        syncing.current = false;
      },
    },
    // d が主役（進入禁止＋遮蔽の許容半径）。0〜1.5 を 0.01 刻みで。
    // 壮大スケールでは occluder 再計算が重いのでデバウンスして反映（最終値は必ず反映）。
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
    // 表示倍率。描画専用（ロジックは格子座標）。
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
    // 脅威半径。
    Rthreat: {
      value: params.Rthreat,
      min: 0,
      max: 5,
      step: 0.1,
      label: 'Rthreat（脅威半径）',
      onChange: (v: number, _path: string, ctx: ChangeCtx) => {
        if (ctx.initial) return;
        setParam('Rthreat', v);
      },
    },
    // --- アリーナ系（変更で重い再生成。整数 step で頻度を抑える） ---
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
        // Lmin ≤ Lmax を壊さないようクランプ。はみ出したら表示も補正する。
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
    // --- 表示トグル（導出 Set に影響せず refresh 不要。store 側も refresh しない） ---
    // 日本語ラベルでグルーピング。値の真実は store、leva 初期値は store 既定と一致。
    地形: folder({
      showTerrainMesh: {
        value: toggles.showTerrainMesh,
        label: 'ボリュームメッシュ',
        onChange: (v: boolean, _path: string, ctx: ChangeCtx) => {
          if (ctx.initial) return;
          setToggle('showTerrainMesh', v);
        },
      },
      showOccluderCells: {
        value: toggles.showOccluderCells,
        label: '占有セル（進入禁止）の胞塗り',
        onChange: (v: boolean, _path: string, ctx: ChangeCtx) => {
          if (ctx.initial) return;
          setToggle('showOccluderCells', v);
        },
      },
    }),
    領域表示: folder({
      showRegionCells: {
        value: toggles.showRegionCells,
        label: 'セル塗り（自機・移動可能・脅威圏）',
        onChange: (v: boolean, _path: string, ctx: ChangeCtx) => {
          if (ctx.initial) return;
          setToggle('showRegionCells', v);
        },
      },
      showRegionEdges: {
        value: toggles.showRegionEdges,
        label: '稜線（菱形十二面体）',
        onChange: (v: boolean, _path: string, ctx: ChangeCtx) => {
          if (ctx.initial) return;
          setToggle('showRegionEdges', v);
        },
      },
    }),
    '視点ほか': folder({
      showThreat: {
        value: toggles.showThreat,
        label: '脅威圏を表示',
        onChange: (v: boolean, _path: string, ctx: ChangeCtx) => {
          if (ctx.initial) return;
          setToggle('showThreat', v);
        },
      },
      firstPerson: {
        value: toggles.firstPerson,
        label: '一人称（FP）視点',
        onChange: (v: boolean, _path: string, ctx: ChangeCtx) => {
          if (ctx.initial) return;
          setToggle('firstPerson', v);
        },
      },
    }),
  }));

  // leva のパネルはグローバルに描画される。本コンポーネントは登録のみで DOM は持たない。
  return null;
}
