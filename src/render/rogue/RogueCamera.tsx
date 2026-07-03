// rogue 用 TP カメラ。tactics の CameraRig と同じ操作系(左ドラッグ旋回・ホイール寄り引き、
// 視点モードで左パン/右旋回)を、rogue ストア(freeCam/focus)と固定スケール ROGUE_S で動かす。
// 洞窟は閉所なので既定距離は近め、クランプも狭め。

import { useThree, useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { worldPos } from '../../model/fcc';
import { fromFrame } from '../../model/terrain';
import { useRogue, ROGUE_S } from '../../state/rogue';
import { view } from '../../state/view';
import { setSuppressNextClick } from '../../input/suppress';
import { currentFocusGrid } from './rogueFocus';

const K = 0.005;
const PAN_K = 0.0014;
const THETA_MAX = Math.PI / 2 - 0.05;
const FOV = 46;
const DRAG_THRESHOLD = 4;

const R_DEFAULT = 15 * ROGUE_S;
const R_MIN = 2.5 * ROGUE_S;
const R_MAX = 60 * ROGUE_S;

export function RogueCamera() {
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
      const g = fromFrame(wx / S, wy / S, wz / S);
      view.base = [view.base[0] + g[0], view.base[1] + g[1], view.base[2] + g[2]];
    };

    const onDown = (e: PointerEvent) => {
      const free = useRogue.getState().freeCam;
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
      view.R = (view.R ?? R_DEFAULT) * (1 + e.deltaY * 0.001);
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

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
    const free = useRogue.getState().freeCam;
    let g: [number, number, number];
    if (free) {
      if (view.base === null) view.base = currentFocusGrid();
      g = view.base;
    } else {
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
  });

  return null;
}
