// TPカメラ（自己中心旋回）＋寄り引き（W7 / 仕様9.1・10章 / DESIGN §7）。
//
// 回転中心 T = worldPos(active)。標準 OrbitControls は使わず、仕様式どおりの自前リグにする
// （回転中心を常に active へ固定するため）。
//   camera.position = T + R_cam·(cosθ·sinφ, sinθ, cosθ·cosφ)、lookAt(T)、FOV≈42°。
//   ドラッグ: φ += dx·k ; θ -= dy·k（θ は ±π/2 弱でクランプ）
//   ホイール: R_cam *= (1 + dWheel·0.001)（[4·S, 19·S] でクランプ）
// 回転中心 T は activeAnim の補間値に追従させ、移動時に視点が滑らかにスライドする（F1）。
//
// FP（firstPerson トグル）は枠だけ実装（位置=T、前方を見回し、FOV≈80）。it-1 必須ではない。

import { useThree, useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { worldPos } from '../model/fcc';
import { useStore } from '../state/store';
import { setSuppressNextClick } from '../input/pick';
import { currentActiveGrid } from './activeAnim';

const K = 0.005; // ドラッグ感度
const THETA_MAX = Math.PI / 2 - 0.05; // pitch クランプ（±π/2 弱）
const FOV_TP = 42;
const FOV_FP = 80;
const DRAG_THRESHOLD = 4; // これ以上動いたらクリックでなくドラッグ扱い（px）

const SQRT3 = Math.sqrt(3);

/**
 * アリーナの概ねのワールド半径（壮大スケールでカメラ既定/クランプを合わせるため）。
 * 水平は Hmax·S、鉛直は層スパンの世界高さの半分（worldPos.y = S·2L/√3）。大きい方を採る。
 */
function arenaWorldRadius(Hmax: number, Lmin: number, Lmax: number, S: number): number {
  const horiz = Hmax * S;
  const halfHeight = ((Lmax - Lmin) / SQRT3) * S;
  return Math.max(horiz, halfHeight, 1);
}

export function CameraRig() {
  const camera = useThree((s) => s.camera);
  const domElement = useThree((s) => s.gl.domElement);

  // 視点状態。React 再レンダに依らず ref で持つ（毎フレーム読む）。
  const phi = useRef(0.6); // yaw
  const theta = useRef(0.5); // pitch
  // 旋回半径（絶対距離）。初期はアリーナ全体が見える距離（FOV42°で半径が収まる ~2.4×）。
  const R = useRef(
    (() => {
      const p = useStore.getState().params;
      return 2.4 * arenaWorldRadius(p.Hmax, p.Lmin, p.Lmax, p.S);
    })(),
  );

  // 入力（ドラッグ＝旋回 / ホイール＝寄り引き）。pointermove/up は window で拾う
  // （ドラッグ中にカーソルが canvas 外へ出ても追従させる）。
  useEffect(() => {
    const el = domElement;
    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      setSuppressNextClick(false); // 新しい操作の開始でフラグをリセット
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      phi.current += dx * K;
      theta.current -= dy * K;
      theta.current = Math.max(-THETA_MAX, Math.min(THETA_MAX, theta.current));
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      if (moved > DRAG_THRESHOLD) setSuppressNextClick(true); // 直後のクリック移動を抑制
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      R.current *= 1 + e.deltaY * 0.001;
    };

    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, [domElement]);

  // 毎フレーム: active から T を作り、仕様式で camera を配置する。
  const tv = useRef(new THREE.Vector3());
  const dir = useRef(new THREE.Vector3());
  useFrame(() => {
    const { params, toggles } = useStore.getState();
    const S = params.S;
    // 回転中心 T は離散 active ではなく補間値に追従（F1: 視点が滑らかに付いていく）。
    const g = currentActiveGrid();
    const w = worldPos(g[0], g[1], g[2], S);
    tv.current.set(w.x, w.y, w.z);

    const cosT = Math.cos(theta.current);
    dir.current.set(
      cosT * Math.sin(phi.current),
      Math.sin(theta.current),
      cosT * Math.cos(phi.current),
    );

    const cam = camera as THREE.PerspectiveCamera;
    if (toggles.firstPerson) {
      if (cam.fov !== FOV_FP) {
        cam.fov = FOV_FP;
        cam.updateProjectionMatrix();
      }
      cam.position.copy(tv.current);
      cam.lookAt(tv.current.x + dir.current.x, tv.current.y + dir.current.y, tv.current.z + dir.current.z);
    } else {
      if (cam.fov !== FOV_TP) {
        cam.fov = FOV_TP;
        cam.updateProjectionMatrix();
      }
      // クランプはアリーナスケールに連動（壮大スケールでも寄り引きが効く範囲に）。
      const radius = arenaWorldRadius(params.Hmax, params.Lmin, params.Lmax, S);
      const Rc = Math.max(1.2 * S, Math.min(6 * radius, R.current));
      R.current = Rc; // クランプ後の値を保持
      cam.position.set(
        tv.current.x + dir.current.x * Rc,
        tv.current.y + dir.current.y * Rc,
        tv.current.z + dir.current.z * Rc,
      );
      cam.lookAt(tv.current);
    }
  });

  return null;
}
