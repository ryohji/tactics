// プレイヤー層の常時ヘックス床(探索支援)。発見済み空洞のうちプレイヤーと同じ層の
// セルへ薄い紫のヘックスタイルを敷き、「いま立っている高さの歩ける広がり」を
// 2次元ヘックスの直観で読めるようにする。ホバー時の同層オーバーレイ(シアン・明)とは
// 色を分け、常時表示側は控えめにする。

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { cellKey, keyToCell, layer, worldPos, type Cell } from '../../model/fcc';
import { useRogue, ROGUE_S } from '../../state/rogue';
import { buildHexTile, buildHexEdges } from '../hex';

const S = ROGUE_S;
const FILL = '#8b7fd8';
const EDGE = '#8b7fd8';

export function LevelFloor() {
  const discoveredRev = useRogue((s) => s.discoveredRev);
  const playerPos = useRogue((s) => s.player.pos);
  const level = layer(playerPos);

  const cells = useMemo(() => {
    const { discovered } = useRogue.getState();
    const out: Cell[] = [];
    for (const k of discovered) {
      const c = keyToCell(k);
      if (layer(c) === level) out.push(c);
    }
    return out;
    // discovered は in-place 更新のため rev をキーにする。
  }, [discoveredRev, level]);

  const tile = useMemo(() => buildHexTile(S), []);
  useEffect(() => () => tile.dispose(), [tile]);
  const edges = useMemo(() => buildHexEdges(cells.map((c) => cellKey(c)), S), [cells]);
  useEffect(() => () => edges.dispose(), [edges]);

  const instRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = instRef.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    cells.forEach((c, i) => {
      const w = worldPos(c[0], c[1], c[2], S);
      mat.makeTranslation(w.x, w.y, w.z);
      m.setMatrixAt(i, mat);
    });
    m.count = cells.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [cells]);

  if (cells.length === 0) return null;
  return (
    <group>
      <instancedMesh
        key={cells.length}
        ref={instRef}
        args={[undefined, undefined, cells.length]}
        frustumCulled={false}
      >
        <primitive object={tile} attach="geometry" />
        <meshStandardMaterial
          color={FILL}
          transparent
          opacity={0.13}
          depthWrite={false}
          side={THREE.DoubleSide}
          roughness={0.7}
        />
      </instancedMesh>
      <lineSegments frustumCulled={false}>
        <primitive object={edges} attach="geometry" />
        <lineBasicMaterial color={EDGE} transparent opacity={0.35} />
      </lineSegments>
    </group>
  );
}
