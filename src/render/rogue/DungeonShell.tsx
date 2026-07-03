// 洞窟の壁描画(rogue-1)。「発見済みの空洞セルに接する、空洞でない or 未発見のセル」を
// 岩ブロック(RD)としてインスタンス描画する。RD は空間充填なので壁面は厳密に閉じ、
// 未発見の空洞は壁のまま・発見と同時に開く(discoveredRev で全再構築。差分更新は先送り)。
// 色は深さで暖色の岩 → 冷たい深部へ遷移し、セルごとのハッシュで僅かに揺らす。

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OFFSETS, keyToCell, layer, worldPos, type Cell, type CellKey } from '../../model/fcc';
import { useRogue, ROGUE_S } from '../../state/rogue';
import { buildRhombicDodecahedron } from '../rd';

const ROCK_SHALLOW = new THREE.Color('#7a6a55');
const ROCK_DEEP = new THREE.Color('#3a3452');

/** セル座標の決定的ハッシュ(0..1)。岩肌の色むらに使う。 */
function hash01(c: Cell): number {
  let h = (c[0] * 73856093) ^ (c[1] * 19349663) ^ (c[2] * 83492791);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

export function DungeonShell() {
  const discoveredRev = useRogue((s) => s.discoveredRev);

  const shell = useMemo(() => {
    const { dungeon, discovered } = useRogue.getState();
    const out = new Set<CellKey>();
    for (const k of discovered) {
      const c = keyToCell(k);
      for (const o of OFFSETS) {
        const n: Cell = [c[0] + o[0], c[1] + o[1], c[2] + o[2]];
        const nk = `${n[0]},${n[1]},${n[2]}`;
        if (!dungeon.open.has(nk) || !discovered.has(nk)) out.add(nk);
      }
    }
    return [...out].map(keyToCell);
    // discoveredRev が唯一の変更検知キー(dungeon/discovered は in-place 更新)。
  }, [discoveredRev]);

  const geom = useMemo(() => buildRhombicDodecahedron(ROGUE_S), []);

  const instRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = instRef.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    const col = new THREE.Color();
    shell.forEach((c, i) => {
      const w = worldPos(c[0], c[1], c[2], ROGUE_S);
      mat.makeTranslation(w.x, w.y, w.z);
      m.setMatrixAt(i, mat);
      const t = Math.min(1, Math.max(0, -layer(c) / 26));
      col.copy(ROCK_SHALLOW).lerp(ROCK_DEEP, t);
      col.multiplyScalar(0.82 + 0.36 * hash01(c));
      m.setColorAt(i, col);
    });
    m.count = shell.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [shell]);

  if (shell.length === 0) return null;
  return (
    <instancedMesh
      key={shell.length}
      ref={instRef}
      args={[undefined, undefined, shell.length]}
      frustumCulled={false}
    >
      <primitive object={geom} attach="geometry" />
      <meshStandardMaterial roughness={0.95} metalness={0.02} flatShading />
    </instancedMesh>
  );
}
