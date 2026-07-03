// 対象フィールド描画（it-6 + QAフィードバック対応）。
// 移動先/配置先は「セル中心の小球マーカー」で表示・クリックする。
// （当初の菱形十二面体の胞塗りは、飛行の3D移動範囲が塊になると手前のセルが
//   奥のセルを覆い隠して選べなくなったため廃止。小球なら隙間から奥が見えて拾える。）
// 攻撃/スキルの対象セルは胞の稜線アウトラインで示す（クリックはユニットメッシュが受ける）。
// あわせて store.toggles.showZoc で敵 ZOC を薄赤の稜線で可視化する。
//
// 色の意味:
//   move   = 寒色（敵 ZOC に踏み込むセル＝そこで停止、は琥珀で警告）
//   deploy = 紫
//   target = 赤（攻撃）/ 緑（ヒール）/ 藤（浮遊）
//   zoc    = 薄赤の稜線のみ

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { worldPos, keyToCell, cellKey, layer, type Cell, type CellKey } from '../model/fcc';
import { zocSet } from '../model/rules';
import { useStore } from '../state/store';
import { useGame } from '../state/game';
import { setFieldCells, pickInstance } from '../input/pick';
import { RD_EDGES, RD_VERTICES } from './rd';
import { buildHexTile, buildHexEdges } from './hex';

const C_MOVE = new THREE.Color('#38bdf8');
const C_MOVE_ZOC = new THREE.Color('#f59e0b'); // 敵 ZOC 内の移動先（そこで停止）
const C_DEPLOY = new THREE.Color('#a78bfa');
const C_ATTACK = new THREE.Color('#ef4444');
const C_HEAL = new THREE.Color('#4ade80');
const C_LEVITATE = new THREE.Color('#c084fc');
const C_ZOC = new THREE.Color('#b91c1c');

/** マーカー球の半径（ワールド単位。S 比例）。 */
const R_MARKER = 0.2;

interface FieldCell {
  cell: Cell;
  color: THREE.Color;
}

/** ハイライトセル＋意味色を導出。 */
function useFieldCells(): FieldCell[] {
  const highlight = useGame((s) => s.highlight);
  const highlightKind = useGame((s) => s.highlightKind);
  const pendingAction = useGame((s) => s.pendingAction);
  const units = useGame((s) => s.units);

  return useMemo(() => {
    if (!highlightKind) return [];
    let base = C_MOVE;
    if (highlightKind === 'deploy') base = C_DEPLOY;
    if (highlightKind === 'target') {
      base = pendingAction === 'heal' ? C_HEAL : pendingAction === 'levitate' ? C_LEVITATE : C_ATTACK;
    }
    const enemyZoc = highlightKind === 'move' ? zocSet(units, 'enemy') : null;
    const out: FieldCell[] = [];
    for (const k of highlight) {
      const color = enemyZoc?.has(k) ? C_MOVE_ZOC : base;
      out.push({ cell: keyToCell(k), color });
    }
    return out;
  }, [highlight, highlightKind, pendingAction, units]);
}

/** 移動先/配置先のセル中心マーカー（クリック対象。ホバーで同レベルのヘックスを出す）。 */
function HighlightMarkers({ cells, S }: { cells: FieldCell[]; S: number }) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const instRef = useRef<THREE.InstancedMesh>(null);
  const setHoverMarker = useGame((s) => s.setHoverMarker);

  useLayoutEffect(() => {
    setFieldCells(cells.map((c) => c.cell)); // instanceId と同じ並びで登録（空でも同期）
    const m = instRef.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    cells.forEach((r, i) => {
      const w = worldPos(r.cell[0], r.cell[1], r.cell[2], S);
      pos.set(w.x, w.y, w.z);
      scl.setScalar(R_MARKER * S);
      mat.compose(pos, quat, scl);
      m.setMatrixAt(i, mat);
      m.setColorAt(i, r.color);
    });
    m.count = cells.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [cells, S]);

  // ゆっくり明滅させて「今クリックできる場所」を示す。
  useFrame(({ clock }) => {
    if (matRef.current) {
      matRef.current.emissiveIntensity = 0.5 + 0.3 * Math.sin(clock.elapsedTime * 3.2);
    }
  });

  if (cells.length === 0) return null;
  return (
    <instancedMesh
      key={cells.length} // 数が変わったら作り直し（行列は layoutEffect で再設定）
      ref={instRef}
      args={[undefined, undefined, cells.length]}
      frustumCulled={false}
      onClick={(e) => {
        e.stopPropagation();
        pickInstance(e.instanceId);
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        const c = e.instanceId !== undefined ? cells[e.instanceId] : undefined;
        if (c) setHoverMarker(cellKey(c.cell));
      }}
      onPointerOut={() => setHoverMarker(null)}
    >
      <sphereGeometry args={[1, 10, 10]} />
      <meshStandardMaterial ref={matRef} roughness={0.4} emissive="#ffffff" emissiveIntensity={0.5} />
    </instancedMesh>
  );
}

/**
 * ホバー中マーカーと同じ層（レベル）の移動/配置可能セルにヘックスタイルを重ねる。
 * 3D の移動範囲は塊で奥行きが読みにくいため、「いま指している高さの水平スライス」を
 * 2次元ヘックスとして見せる（水平はヘックス・高さは層で読む、の直観に乗せる）。
 */
function HoverLevelHexes({ cells, S }: { cells: FieldCell[]; S: number }) {
  const hoverMarker = useGame((s) => s.hoverMarker);

  const level = hoverMarker !== null ? layer(keyToCell(hoverMarker)) : null;
  const levelCells = useMemo(
    () => (level === null ? [] : cells.filter((c) => layer(c.cell) === level)),
    [cells, level],
  );

  const tile = useMemo(() => buildHexTile(S), [S]);
  useEffect(() => () => tile.dispose(), [tile]);
  const edges = useMemo(
    () => buildHexEdges(levelCells.map((c) => cellKey(c.cell)), S),
    [levelCells, S],
  );
  useEffect(() => () => edges.dispose(), [edges]);

  const instRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = instRef.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    levelCells.forEach((r, i) => {
      const w = worldPos(r.cell[0], r.cell[1], r.cell[2], S);
      mat.makeTranslation(w.x, w.y, w.z);
      m.setMatrixAt(i, mat);
      m.setColorAt(i, r.color);
    });
    m.count = levelCells.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [levelCells, S]);

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

/** セル集合の RD 稜線をひとつの LineSegments で描く汎用。 */
function CellEdges({ keys, color, S, opacity }: { keys: readonly CellKey[]; color: THREE.Color; S: number; opacity: number }) {
  const geom = useMemo(() => {
    const pos: number[] = [];
    for (const k of keys) {
      const c = keyToCell(k);
      for (const [a, b] of RD_EDGES) {
        const va = RD_VERTICES[a];
        const vb = RD_VERTICES[b];
        const wa = worldPos(c[0] + va[0], c[1] + va[1], c[2] + va[2], S);
        const wb = worldPos(c[0] + vb[0], c[1] + vb[1], c[2] + vb[2], S);
        pos.push(wa.x, wa.y, wa.z, wb.x, wb.y, wb.z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, [keys, S]);
  useEffect(() => () => geom.dispose(), [geom]);

  if (keys.length === 0) return null;
  return (
    <lineSegments frustumCulled={false}>
      <primitive object={geom} attach="geometry" />
      <lineBasicMaterial color={color} transparent opacity={opacity} />
    </lineSegments>
  );
}

/** 攻撃/スキル対象セルの胞アウトライン（クリックはユニットメッシュが受ける）。 */
function TargetOutlines({ cells, S }: { cells: FieldCell[]; S: number }) {
  const keys = useMemo(() => cells.map((c) => `${c.cell[0]},${c.cell[1]},${c.cell[2]}`), [cells]);
  const color = cells[0]?.color ?? C_ATTACK; // target は全セル同色（行動種で決まる）
  useLayoutEffect(() => {
    setFieldCells([]); // マーカー経由のクリックは無し（stale な instanceId 対応を防ぐ）
  }, [keys]);
  return <CellEdges keys={keys} color={color} S={S} opacity={0.9} />;
}

/** 敵 ZOC の可視化（トグル）。 */
function ZocOverlay({ S }: { S: number }) {
  const showZoc = useStore((s) => s.toggles.showZoc);
  const units = useGame((s) => s.units);
  const board = useGame((s) => s.board);

  const keys = useMemo(() => {
    if (!showZoc) return [] as CellKey[];
    const z = zocSet(units, 'enemy');
    // 通行できるセルだけ見せる（壁の中の ZOC は意味がない）。
    return [...z].filter((k) => board.arenaSet.has(k) && !board.occluderSet.has(k));
  }, [showZoc, units, board]);

  if (!showZoc) return null;
  return <CellEdges keys={keys} color={C_ZOC} S={S} opacity={0.5} />;
}

export function TargetField() {
  const S = useStore((s) => s.params.S);
  const highlightKind = useGame((s) => s.highlightKind);
  const cells = useFieldCells();
  return (
    <>
      {highlightKind === 'target' ? (
        <TargetOutlines cells={cells} S={S} />
      ) : (
        <>
          <HighlightMarkers cells={cells} S={S} />
          <HoverLevelHexes cells={cells} S={S} />
        </>
      )}
      <ZocOverlay S={S} />
    </>
  );
}
