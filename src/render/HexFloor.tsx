// 地上ヘックスタイル(it-6 QAフィードバック第2回)。
// 「グラウンドレベル」= 足場のある通行セルのうち、直下の鉛直線が底(u≈0)まで地形で
// 連続しているもの(大地から地続きの床・瓦礫の山・壁の棚)。宙に浮いた構造の上面
// (ヴォールト屋根など)は除外する。六角形の床タイルを敷き、ユニットの水平位置と
// 足場の分布を2次元ヘックスの直観で読めるようにする。
// 盤面が変わった時だけ再構築する静的レイヤ(既定プリセットで約1600セル・~1s)。
// 塗りはごく薄く、輪郭線を主役にする。

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { worldPos, keyToCell, layer, type Cell, type CellKey } from '../model/fcc';
import { toFrame, fromFrame } from '../model/terrain';
import { hasFooting, type Board } from '../model/rules';
import { useStore } from '../state/store';
import { useGame } from '../state/game';
import { buildHexTile, buildHexEdges, HEX_Y_OFFSET } from './hex';

const FILL_COLOR = '#3d3a6e';
const EDGE_COLOR = '#5a55a0';

/** c の直下が底まで地形で連続しているか(空隙があれば「浮いた構造の上」)。 */
function grounded(c: Cell, board: Board, d: number): boolean {
  if (layer(c) <= board.Lmin) return true; // アリーナ底=大地
  const [a, u0, b] = toFrame(c);
  for (let u = u0 - 0.8; u > 0.2; u -= 0.5) {
    if (board.terrain.sdf(fromFrame(a, u, b)) > d + 0.2) return false;
  }
  return true;
}

export function HexFloor() {
  const S = useStore((s) => s.params.S);
  const d = useStore((s) => s.params.d);
  const board = useGame((s) => s.board);
  // メモ化キーは盤面の実体(Set/terrain の参照)。rebuild で board オブジェクトが
  // 作り直されても中身が同じなら再計算しない(グラウンド判定は ~1s かかる)。
  const { arenaSet, occluderSet, terrain, Lmin } = board;

  const keys = useMemo(() => {
    const b: Board = { arenaSet, occluderSet, terrain, Lmin };
    const out: CellKey[] = [];
    for (const k of arenaSet) {
      if (occluderSet.has(k)) continue;
      const c = keyToCell(k);
      if (!hasFooting(c, b)) continue;
      if (!grounded(c, b, d)) continue;
      out.push(k);
    }
    return out;
  }, [arenaSet, occluderSet, terrain, Lmin, d]);

  const tile = useMemo(() => buildHexTile(S), [S]);
  useEffect(() => () => tile.dispose(), [tile]);
  const edges = useMemo(() => buildHexEdges(keys, S), [keys, S]);
  useEffect(() => () => edges.dispose(), [edges]);

  const instRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = instRef.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    keys.forEach((k, i) => {
      const c = keyToCell(k);
      const w = worldPos(c[0], c[1], c[2], S);
      mat.makeTranslation(w.x, w.y, w.z); // タイルの沈み込みはジオメトリ側(HEX_Y_OFFSET)
      m.setMatrixAt(i, mat);
    });
    m.count = keys.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [keys, S]);

  if (keys.length === 0) return null;
  return (
    <group>
      <instancedMesh
        key={keys.length}
        ref={instRef}
        args={[undefined, undefined, keys.length]}
        frustumCulled={false}
      >
        <primitive object={tile} attach="geometry" />
        <meshStandardMaterial
          color={FILL_COLOR}
          transparent
          opacity={0.1}
          depthWrite={false}
          side={THREE.DoubleSide}
          roughness={1}
        />
      </instancedMesh>
      <lineSegments frustumCulled={false}>
        <primitive object={edges} attach="geometry" />
        <lineBasicMaterial color={EDGE_COLOR} transparent opacity={0.35} />
      </lineSegments>
    </group>
  );
}

export { HEX_Y_OFFSET };
