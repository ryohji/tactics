// 移動先マーカー(rogue)。reach(BFS≤2歩)のセル中心に小球を出し、クリックで自動歩行。
// tactics の HighlightMarkers と同じインスタンス+明滅パターン。歩数で色を薄くする。
// マーカーをホバーすると、その高さ(層)の移動可能セルへヘックスタイルを重ねる
// (tactics の HoverLevelHexes と同じ「水平はヘックス、高さは層で読む」の直観)。

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { cellKey, keyToCell, layer, worldPos, type Cell } from '../../model/fcc';
import { useRogue, ROGUE_S } from '../../state/rogue';
import { consumeSuppressedClick } from '../../input/suppress';
import { buildHexTile, buildHexEdges } from '../hex';

const S = ROGUE_S;
const R_MARKER = 0.14;
const C_NEAR = new THREE.Color('#38bdf8');
const C_FAR = new THREE.Color('#1d6a96');

/** ホバー中マーカーと同じ層の移動可能セルにヘックスタイルを重ねる。 */
function HoverLevelHexes({ cells }: { cells: Cell[] }) {
  const hoverMarker = useRogue((s) => s.hoverMarker);

  const level = hoverMarker !== null ? layer(keyToCell(hoverMarker)) : null;
  const levelCells = useMemo(
    () => (level === null ? [] : cells.filter((c) => layer(c) === level)),
    [cells, level],
  );

  const tile = useMemo(() => buildHexTile(S), []);
  useEffect(() => () => tile.dispose(), [tile]);
  const edges = useMemo(
    () => buildHexEdges(levelCells.map((c) => cellKey(c)), S),
    [levelCells],
  );
  useEffect(() => () => edges.dispose(), [edges]);

  const instRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = instRef.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    levelCells.forEach((c, i) => {
      const w = worldPos(c[0], c[1], c[2], S);
      mat.makeTranslation(w.x, w.y, w.z);
      m.setMatrixAt(i, mat);
    });
    m.count = levelCells.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [levelCells]);

  if (levelCells.length === 0) return null;
  return (
    <group>
      <instancedMesh
        key={levelCells.length}
        ref={instRef}
        args={[undefined, undefined, levelCells.length]}
        frustumCulled={false}
      >
        <primitive object={tile} attach="geometry" />
        <meshStandardMaterial
          color="#38bdf8"
          transparent
          opacity={0.32}
          depthWrite={false}
          side={THREE.DoubleSide}
          roughness={0.6}
        />
      </instancedMesh>
      <lineSegments frustumCulled={false}>
        <primitive object={edges} attach="geometry" />
        <lineBasicMaterial color="#e0f2fe" transparent opacity={0.8} />
      </lineSegments>
    </group>
  );
}

export function MoveMarkers() {
  const reach = useRogue((s) => s.reach);
  const uiMode = useRogue((s) => s.uiMode);
  const clickCell = useRogue((s) => s.clickCell);
  const setHoverMarker = useRogue((s) => s.setHoverMarker);

  const cells: Cell[] = uiMode === 'walk' ? reach.cells : [];

  // 歩数(親を辿った深さ)で色を変える。
  const depths = useMemo(() => {
    const d = new Map<string, number>();
    for (const c of cells) {
      let k = cellKey(c);
      let n = 0;
      while (reach.parent.has(k)) {
        k = reach.parent.get(k)!;
        n++;
      }
      d.set(cellKey(c), n);
    }
    return d;
  }, [cells, reach]);

  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const instRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const m = instRef.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const col = new THREE.Color();
    cells.forEach((c, i) => {
      const w = worldPos(c[0], c[1], c[2], S);
      pos.set(w.x, w.y, w.z);
      scl.setScalar(R_MARKER * S);
      mat.compose(pos, quat, scl);
      m.setMatrixAt(i, mat);
      const t = ((depths.get(cellKey(c)) ?? 1) - 1) / 2;
      m.setColorAt(i, col.copy(C_NEAR).lerp(C_FAR, t));
    });
    m.count = cells.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [cells, depths]);

  useFrame(({ clock }) => {
    if (matRef.current) {
      matRef.current.emissiveIntensity = 0.5 + 0.3 * Math.sin(clock.elapsedTime * 3.2);
    }
  });

  if (cells.length === 0) return null;
  return (
    <>
      <instancedMesh
        key={cells.length}
        ref={instRef}
        args={[undefined, undefined, cells.length]}
        frustumCulled={false}
        onClick={(e) => {
          e.stopPropagation();
          if (consumeSuppressedClick()) return;
          const c = e.instanceId !== undefined ? cells[e.instanceId] : undefined;
          if (c) clickCell(c);
        }}
        onPointerMove={(e) => {
          e.stopPropagation();
          const c = e.instanceId !== undefined ? cells[e.instanceId] : undefined;
          if (c) setHoverMarker(cellKey(c));
        }}
        onPointerOut={() => setHoverMarker(null)}
      >
        <sphereGeometry args={[1, 10, 10]} />
        <meshStandardMaterial ref={matRef} roughness={0.4} emissive="#ffffff" emissiveIntensity={0.5} />
      </instancedMesh>
      <HoverLevelHexes cells={cells} />
    </>
  );
}
