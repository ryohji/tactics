// TPカメラ（it-6 + QAフィードバック対応）。仕様9.1 の自前リグ。
// 通常モード: 回転中心 T = game.focus（選択/行動ユニット）の補間値。左ドラッグ=旋回。
// 視点モード（game.freeCam）: 回転中心がユニット追従を離れ view.base に固定される。
//   左ドラッグ=パン（画面平行に旋回中心を移動）/ 右ドラッグ=旋回 / ホイール=寄り引き。
//   配置ターンの敵陣確認や、戦闘中の任意地点の観察に使う。
// 角度・距離・視点モード中心は state/view.ts のシングルトンに置き、HUD の
// 「視点リセット」から resetView() で既定へ戻せる。
// ドラッグ後のクリック誤爆抑制は pick.setSuppressNextClick と共有。

import { useThree, useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { worldPos } from '../model/fcc';
import { fromFrame } from '../model/terrain';
import { useStore } from '../state/store';
import { useGame } from '../state/game';
import { view } from '../state/view';
import { setSuppressNextClick } from '../input/pick';
import { currentFocusGrid } from './focusAnim';

const K = 0.005; // 旋回のドラッグ感度
const PAN_K = 0.0014; // パン感度（距離 R に比例）
const THETA_MAX = Math.PI / 2 - 0.05;
const FOV = 42;
const DRAG_THRESHOLD = 4; // これ以上動いたらクリックでなくドラッグ扱い（px）

const SQRT3 = Math.sqrt(3);

/** アリーナの概ねのワールド半径（カメラ既定/クランプ用）。 */
function arenaWorldRadius(Hmax: number, Lmin: number, Lmax: number, S: number): number {
  const horiz = Hmax * S;
  const halfHeight = ((Lmax - Lmin) / SQRT3) * S;
  return Math.max(horiz, halfHeight, 1);
}

function defaultR(): number {
  const p = useStore.getState().params;
  return 1.7 * arenaWorldRadius(p.Hmax, p.Lmin, p.Lmax, p.S);
}

export function CameraRig() {
  const camera = useThree((s) => s.camera);
  const domElement = useThree((s) => s.gl.domElement);

  useEffect(() => {
    const el = domElement;
    let mode: 'rotate' | 'pan' | null = null;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;

    const right = new THREE.Vector3();
    const up = new THREE.Vector3();

    /** 画面ドラッグ量を旋回中心（格子座標）の移動へ変換する。 */
    const pan = (dx: number, dy: number) => {
      if (view.base === null) view.base = currentFocusGrid();
      const S = useStore.getState().params.S;
      const R = view.R ?? defaultR();
      const k = R * PAN_K;
      right.setFromMatrixColumn(camera.matrix, 0);
      up.setFromMatrixColumn(camera.matrix, 1);
      // ワールド差分（ドラッグと逆方向に世界が動く＝掴んで動かす感覚）。
      const wx = (-dx * right.x + dy * up.x) * k;
      const wy = (-dx * right.y + dy * up.y) * k;
      const wz = (-dx * right.z + dy * up.z) * k;
      // worldPos は S·(直交変換) なので、逆変換は fromFrame(ワールド/S)。
      const g = fromFrame(wx / S, wy / S, wz / S);
      view.base = [view.base[0] + g[0], view.base[1] + g[1], view.base[2] + g[2]];
    };

    const onDown = (e: PointerEvent) => {
      const free = useGame.getState().freeCam;
      if (e.button === 0) {
        mode = free ? 'pan' : 'rotate';
      } else if (e.button === 2 && free) {
        mode = 'rotate';
      } else {
        return;
      }
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      setSuppressNextClick(false);
    };
    const onMove = (e: PointerEvent) => {
      if (mode === null) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (mode === 'rotate') {
        view.phi += dx * K;
        view.theta = Math.max(-THETA_MAX, Math.min(THETA_MAX, view.theta - dy * K));
      } else {
        pan(dx, dy);
      }
    };
    const onUp = () => {
      if (mode === null) return;
      mode = null;
      if (moved > DRAG_THRESHOLD) setSuppressNextClick(true);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      view.R = (view.R ?? defaultR()) * (1 + e.deltaY * 0.001);
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault(); // 右ドラッグ旋回のため

    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContextMenu);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, [domElement, camera]);

  const tv = useRef(new THREE.Vector3());
  const dir = useRef(new THREE.Vector3());
  useFrame(() => {
    const { params } = useStore.getState();
    const S = params.S;
    const free = useGame.getState().freeCam;

    // 旋回中心: 視点モードなら view.base（未設定なら現フォーカスから取得）、
    // 通常モードならユニットフォーカスの補間値（base は破棄して追従へ戻る）。
    let g: [number, number, number];
    if (free) {
      if (view.base === null) view.base = currentFocusGrid();
      g = view.base;
    } else {
      view.base = null;
      g = currentFocusGrid();
    }
    const w = worldPos(g[0], g[1], g[2], S);
    tv.current.set(w.x, w.y, w.z);

    const cosT = Math.cos(view.theta);
    dir.current.set(cosT * Math.sin(view.phi), Math.sin(view.theta), cosT * Math.cos(view.phi));

    const cam = camera as THREE.PerspectiveCamera;
    if (cam.fov !== FOV) {
      cam.fov = FOV;
      cam.updateProjectionMatrix();
    }
    const radius = arenaWorldRadius(params.Hmax, params.Lmin, params.Lmax, S);
    const Rc = Math.max(1.6 * S, Math.min(5 * radius, view.R ?? defaultR()));
    view.R = Rc;
    cam.position.set(
      tv.current.x + dir.current.x * Rc,
      tv.current.y + dir.current.y * Rc,
      tv.current.z + dir.current.z * Rc,
    );
    cam.lookAt(tv.current);
  });

  return null;
}
