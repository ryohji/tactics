// rogue 用 TP カメラ。tactics の CameraRig と同じ操作系(左ドラッグ旋回・ホイール寄り引き、
// 視点モードで左パン/右旋回)を、rogue ストア(freeCam/focus)と固定スケール ROGUE_S で動かす。
// 洞窟は閉所なので既定距離は近め、クランプも狭め。

import { useThree, useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { cellKey, worldPos, latticeAt } from '../model/fcc';
import { useRogue, gazeAngles, ROGUE_S } from '../state/rogue';
import { currentUnitGrid } from '../state/unitAnim';
import { view, clearGazeGoal } from '../state/view';
import { setSuppressNextClick } from '../input/suppress';
import { isSpaceHeld } from '../input/keys';
import { currentFocusGrid } from './rogueFocus';

const K = 0.005;
const PAN_K = 0.0014;
const THETA_MAX = Math.PI / 2 - 0.05;
const FOV = 46;
const DRAG_THRESHOLD = 4;

const R_DEFAULT = 15 * ROGUE_S;
const R_MIN = 2.5 * ROGUE_S;
const R_MAX = 60 * ROGUE_S;

/** QA診断用(iter2): ?qa のときだけ true。カメラ座標・view state を window に出す。 */
const QA = typeof location !== 'undefined' && new URLSearchParams(location.search).has('qa');

export function RogueCamera() {
  const camera = useThree((s) => s.camera);
  const domElement = useThree((s) => s.gl.domElement);

  useEffect(() => {
    // QA専用(iter2診断): TAB消失バグの原因切り分け用に view state をそのまま公開。本番は無効。
    if (QA) (window as unknown as { __qaView: typeof view }).__qaView = view;
  }, []);

  useEffect(() => {
    const el = domElement;
    let mode: 'rotate' | 'pan' | 'pinch' | null = null;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    // タッチ: アクティブポインタを追跡。1本指=旋回 / 2本指=パン+ピンチでズーム。
    const touches = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    let pinchCX = 0;
    let pinchCY = 0;
    el.style.touchAction = 'none'; // ブラウザのスクロール/ダブルタップズームを抑止

    const right = new THREE.Vector3();
    const up = new THREE.Vector3();

    const pan = (dx: number, dy: number) => {
      if (view.base === null) view.base = currentFocusGrid();
      const S = ROGUE_S;
      const R = view.R ?? R_DEFAULT;
      const k = R * PAN_K;
      right.setFromMatrixColumn(camera.matrix, 0);
      up.setFromMatrixColumn(camera.matrix, 1);
      const wx = (-dx * right.x + dy * up.x) * k;
      const wy = (-dx * right.y + dy * up.y) * k;
      const wz = (-dx * right.z + dy * up.z) * k;
      const g = latticeAt(wx / S, wy / S, wz / S);
      view.base = [view.base[0] + g[0], view.base[1] + g[1], view.base[2] + g[2]];
    };

    /** 2本指の距離と中点を更新し、前回値との差でズーム・パンする。 */
    const pinchUpdate = (init: boolean) => {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      if (!init) {
        if (d > 1) view.R = (view.R ?? R_DEFAULT) * (pinchDist / d);
        pan(cx - pinchCX, cy - pinchCY);
      }
      pinchDist = d;
      pinchCX = cx;
      pinchCY = cy;
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 1) {
          mode = 'rotate'; // タッチは常に 1本指=旋回(パンは2本指)
          moved = 0;
          lastX = e.clientX;
          lastY = e.clientY;
          setSuppressNextClick(false);
        } else if (touches.size === 2) {
          mode = 'pinch';
          pinchUpdate(true);
          setSuppressNextClick(true); // ジェスチャ後の誤タップを抑止
        }
        return;
      }
      const { mapMode } = useRogue.getState();
      if (mapMode) {
        // マップ: 左ドラッグ=回転が基本。Space を押している間は移動(パン)。右=回転。
        if (e.button === 0) mode = isSpaceHeld() ? 'pan' : 'rotate';
        else if (e.button === 2) mode = 'rotate';
        else return;
      } else if (e.button === 0) {
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
      if (e.pointerType === 'touch') {
        const p = touches.get(e.pointerId);
        if (!p) return;
        p.x = e.clientX;
        p.y = e.clientY;
        if (mode === 'pinch') {
          if (touches.size >= 2) pinchUpdate(false);
          return;
        }
      }
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (mode === 'rotate') {
        clearGazeGoal(); // ユーザの手動旋回が TAB 視線より優先
        view.phi += dx * K;
        view.theta = Math.max(-THETA_MAX, Math.min(THETA_MAX, view.theta - dy * K));
      } else {
        pan(dx, dy);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId);
        if (mode === 'pinch') {
          // 指が1本残ってもジェスチャは終了(残り指での旋回は新たなタッチから)。
          if (touches.size < 2) mode = null;
          return;
        }
      }
      if (mode === null) return;
      mode = null;
      if (moved > DRAG_THRESHOLD) setSuppressNextClick(true);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      view.R = (view.R ?? R_DEFAULT) * (1 + e.deltaY * 0.001);
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContextMenu);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, [domElement, camera]);

  const tv = useRef(new THREE.Vector3());
  const dir = useRef(new THREE.Vector3());
  useFrame(() => {
    const { mapMode } = useRogue.getState();

    // 敵追跡(rogue-14): TAB でフォーカスした敵が動いても見失わないよう、
    // 追跡中は毎フレーム目標角を敵の補間位置へ更新する(移動アニメにも追従)。
    // 終了条件: 死亡・フォーカス解除・マップ切替。発見範囲外に出た間は最後の向きを保つ。
    if (view.gazeBeastId !== null && !mapMode) {
      const s = useRogue.getState();
      const b = s.beasts.find((x) => x.id === view.gazeBeastId);
      if (!b || !b.alive || s.hoverBeastId !== b.id) {
        view.gazeBeastId = null;
      } else if (s.discovered.has(cellKey(b.pos))) {
        const gp = currentUnitGrid(b.id, b.pos);
        const g = gazeAngles(s.player.pos, gp);
        view.phiGoal = g.phi;
        view.thetaGoal = g.theta;
      }
    }

    // TAB 視線ゴールへの短弧補間(到達で解除。ドラッグ側でも解除される)。
    // 敵追跡中(gazeBeastId)は到達しても解除しない — 目標角は毎フレーム敵位置へ
    // 更新され続け、この補間を通るので視線の移動は常に滑らかなアニメーションになる。
    if (view.phiGoal !== null && view.thetaGoal !== null) {
      let dPhi = view.phiGoal - view.phi;
      dPhi = Math.atan2(Math.sin(dPhi), Math.cos(dPhi)); // 短い側の弧へ正規化
      const dTheta = view.thetaGoal - view.theta;
      if (Math.abs(dPhi) < 0.01 && Math.abs(dTheta) < 0.01 && view.gazeBeastId === null) {
        view.phi = view.phiGoal;
        view.theta = view.thetaGoal;
        clearGazeGoal();
      } else {
        view.phi += dPhi * 0.16;
        view.theta += dTheta * 0.16;
      }
    }

    let g: [number, number, number];
    if (mapMode) {
      // マップ: パンで外していなければフォーカス(巡回先)を追従。
      if (view.base !== null) g = view.base;
      else g = currentFocusGrid();
    } else {
      // ゲーム画面は常にフォーカス(プレイヤー)追従。パンはマップ専用。
      view.base = null;
      g = currentFocusGrid();
    }
    const w = worldPos(g[0], g[1], g[2], ROGUE_S);
    tv.current.set(w.x, w.y, w.z);

    const cosT = Math.cos(view.theta);
    dir.current.set(cosT * Math.sin(view.phi), Math.sin(view.theta), cosT * Math.cos(view.phi));

    const cam = camera as THREE.PerspectiveCamera;
    if (cam.fov !== FOV) {
      cam.fov = FOV;
      cam.updateProjectionMatrix();
    }
    const Rc = Math.max(R_MIN, Math.min(R_MAX, view.R ?? R_DEFAULT));
    view.R = Rc;
    cam.position.set(
      tv.current.x + dir.current.x * Rc,
      tv.current.y + dir.current.y * Rc,
      tv.current.z + dir.current.z * Rc,
    );
    cam.lookAt(tv.current);

    // QA専用(iter2診断): カメラのワールド座標を毎フレーム公開(洞窟外=土中に入っていないか確認用)。
    if (QA) {
      (window as unknown as { __qaCamera: { x: number; y: number; z: number } }).__qaCamera = {
        x: cam.position.x,
        y: cam.position.y,
        z: cam.position.z,
      };
    }
  });

  return null;
}
