// 探索バブル(rogue-2/3)。
// ゲーム画面: 発見済みアイテアと、いま居る広間の通路入り口へ「名前+歩数」のバブル。
// マップ画面: 確認できた敵(生存・位置が発見済み)と未取得アイテムを、
//             対象から立ち上がる引き出し線つきのバブルで示す。
// どちらもクリックでファストトラベル(マップ側はゲーム画面へ戻ってから移動開始。
// 敵バブルは敵の隣の空きセルが目的地)。歩数は障害物なしの FCC 格子距離(stepDist)。

import { useEffect, useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { cellKey, neighbors, worldPos, type Cell } from '../model/fcc';
import { stepDist, stubLeadsSomewhere } from '../model/dungeon';
import { itemLabel } from '../model/loot';
import { BEASTS } from '../model/beasts';
import { useRogue, ROGUE_S } from '../state/rogue';
import { tapAction } from '../input/touch';

const S = ROGUE_S;

function Bubble({
  id,
  target,
  label,
  kind,
  lift = 0.9,
  onClick,
}: {
  /** 2段階タップの識別キー(一覧の React key と同じ値)。 */
  id: string;
  target: Cell;
  label: string;
  kind: 'item' | 'passage' | 'beast' | 'room';
  lift?: number;
  onClick?: () => void;
}) {
  const travelTo = useRogue((s) => s.travelTo);
  const playerPos = useRogue((s) => s.player.pos);
  const armedKey = useRogue((s) => s.armedKey);
  const w = worldPos(target[0], target[1], target[2], S);
  const d = stepDist(playerPos, target);
  const key = `bubble:${id}`;
  return (
    <Html position={[w.x, w.y + lift * S, w.z]} center zIndexRange={[5, 0]}>
      <div
        className={`hud-bubble ${kind}${armedKey === key ? ' armed' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          // タッチは2段階: 1度目=選択(強調表示)、2度目=移動。
          const s = useRogue.getState();
          if (tapAction(s.armedKey, key) === 'arm') {
            s.setArmed(key);
            return;
          }
          s.setArmed(null);
          if (onClick) onClick();
          else travelTo(target);
        }}
      >
        {label} <b>{d}歩</b>
      </div>
    </Html>
  );
}

/** ゲーム画面のバブル(アイテム+いま居る広間の通路入り口)。 */
function GameBubbles() {
  const items = useRogue((s) => s.items);
  const playerPos = useRogue((s) => s.player.pos);
  const discoveredRev = useRogue((s) => s.discoveredRev);
  void discoveredRev; // discovered/dungeon.stubs は in-place 更新なので rev で再評価させる
  const { discovered, dungeon, cellChamber } = useRogue.getState();

  const pk = cellKey(playerPos);
  const itemBubbles = items.filter(
    (i) => discovered.has(cellKey(i.pos)) && cellKey(i.pos) !== pk,
  );

  // いま居る広間から伸びる通路の入り口(発見済みのみ)。
  const chamberId = cellChamber.get(pk);
  const passages =
    chamberId === undefined
      ? []
      : dungeon.stubs.filter(
          (st) =>
            st.from === chamberId &&
            discovered.has(cellKey(st.mouth)) &&
            stubLeadsSomewhere(dungeon, st),
        );

  return (
    <>
      {itemBubbles.map((i) => (
        <Bubble key={`i${i.id}`} id={`i${i.id}`} target={i.pos} label={itemLabel(i.stack)} kind="item" />
      ))}
      {passages.map((st) => (
        <Bubble
          key={`p${st.id}`}
          id={`p${st.id}`}
          target={st.mouth}
          label={st.used ? '通路' : '未踏の通路'}
          kind="passage"
        />
      ))}
    </>
  );
}

/** 引き出し線の高さ(重なりにくいよう種別と並びで少しずらす)。 */
function liftOf(kind: 'item' | 'beast' | 'passage', i: number): number {
  return (kind === 'beast' ? 3.0 : kind === 'item' ? 2.1 : 1.4) + (i % 3) * 0.55;
}

/** マップ画面のバブル(確認できた敵+未取得アイテム+フォーカス部屋への移動)。 */
function MapBubbles() {
  const beasts = useRogue((s) => s.beasts);
  const items = useRogue((s) => s.items);
  const mapFocusChamber = useRogue((s) => s.mapFocusChamber);
  const travelToChamber = useRogue((s) => s.travelToChamber);
  const playerPos = useRogue((s) => s.player.pos);
  const discoveredRev = useRogue((s) => s.discoveredRev);
  void discoveredRev;
  const { discovered, dungeon, cellChamber } = useRogue.getState();

  // TAB フォーカス中の部屋: 中央に「入り口へ移動」バブル(自分の部屋には出さない・
  // 崩落済み(墓標化)部屋にも出さない防御ガード)。
  const focusTarget =
    mapFocusChamber !== null &&
    cellChamber.get(cellKey(playerPos)) !== mapFocusChamber &&
    !dungeon.chambers[mapFocusChamber].collapsed
      ? dungeon.chambers[mapFocusChamber]
      : null;

  const spotted = beasts.filter((b) => b.alive && discovered.has(cellKey(b.pos)));
  const loot = items.filter((i) => discovered.has(cellKey(i.pos)));

  // 注目中の部屋(TAB フォーカス。無ければ現在の部屋)の通路入り口(発見済みのみ)。
  const chamberId = mapFocusChamber ?? cellChamber.get(cellKey(playerPos));
  const passages =
    chamberId === undefined
      ? []
      : dungeon.stubs.filter(
          (st) =>
            st.from === chamberId &&
            discovered.has(cellKey(st.mouth)) &&
            stubLeadsSomewhere(dungeon, st),
        );

  // 引き出し線(対象のすぐ上 → バブルの足元)をひとつの LineSegments にまとめる。
  const lines = useMemo(() => {
    const pos: number[] = [];
    const add = (c: Cell, lift: number) => {
      const w = worldPos(c[0], c[1], c[2], S);
      pos.push(w.x, w.y + 0.3 * S, w.z, w.x, w.y + (lift - 0.25) * S, w.z);
    };
    spotted.forEach((b, i) => add(b.pos, liftOf('beast', i)));
    loot.forEach((it, i) => add(it.pos, liftOf('item', i)));
    passages.forEach((st, i) => add(st.mouth, liftOf('passage', i)));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
    // beasts/items は更新のたび配列が差し替わる。discovered/stubs は rev、部屋は focus で追う。
  }, [beasts, items, discoveredRev, mapFocusChamber, playerPos]);
  useEffect(() => () => lines.dispose(), [lines]);

  // 敵バブル: 目的地は敵の隣の空きセル(プレイヤーに最も近いもの)。
  const approach = (target: Cell) => {
    const s = useRogue.getState();
    const occupied = new Set(s.beasts.filter((b) => b.alive).map((b) => cellKey(b.pos)));
    const cand = neighbors(target)
      .filter(
        (n) =>
          s.dungeon.open.has(cellKey(n)) &&
          s.discovered.has(cellKey(n)) &&
          !occupied.has(cellKey(n)),
      )
      .sort((a, b) => stepDist(s.player.pos, a) - stepDist(s.player.pos, b))[0];
    s.toggleMap(); // ゲーム画面へ戻ってから移動開始
    if (cand) s.travelTo(cand);
  };

  /** マップを閉じてそのセルへファストトラベル(アイテム・通路入り口)。 */
  const goTo = (target: Cell) => {
    const s = useRogue.getState();
    s.toggleMap();
    s.travelTo(target);
  };

  return (
    <>
      <lineSegments frustumCulled={false}>
        <primitive object={lines} attach="geometry" />
        <lineBasicMaterial color="#8ea0b8" transparent opacity={0.7} />
      </lineSegments>
      {spotted.map((b, i) => (
        <Bubble
          key={`b${b.id}`}
          id={`b${b.id}`}
          target={b.pos}
          label={BEASTS[b.kind].name}
          kind="beast"
          lift={liftOf('beast', i)}
          onClick={() => approach(b.pos)}
        />
      ))}
      {loot.map((it, i) => (
        <Bubble
          key={`i${it.id}`}
          id={`i${it.id}`}
          target={it.pos}
          label={itemLabel(it.stack)}
          kind="item"
          lift={liftOf('item', i)}
          onClick={() => goTo(it.pos)}
        />
      ))}
      {passages.map((st, i) => (
        <Bubble
          key={`p${st.id}`}
          id={`mp${st.id}`}
          target={st.mouth}
          label={st.used ? '通路' : '未踏の通路'}
          kind="passage"
          lift={liftOf('passage', i)}
          onClick={() => goTo(st.mouth)}
        />
      ))}
      {focusTarget && (
        <Bubble
          key={`c${focusTarget.id}`}
          id={`c${focusTarget.id}`}
          target={focusTarget.center}
          label="この部屋の入り口へ"
          kind="room"
          lift={4.2}
          onClick={() => travelToChamber(focusTarget.id)}
        />
      )}
    </>
  );
}

export function Bubbles() {
  const phase = useRogue((s) => s.phase);
  const mapMode = useRogue((s) => s.mapMode);
  if (phase !== 'play') return null;
  return mapMode ? <MapBubbles /> : <GameBubbles />;
}
