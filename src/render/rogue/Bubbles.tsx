// 探索バブル(rogue-2)。一度視界に入った(=発見済みセルにある)アイテムと、
// いま居る広間の通路入り口へ、名前+歩数距離の DOM バブルを浮かべる。
// クリックでファストトラベル(travelTo — 1歩=1ターンの自動歩行。敵の覚醒/被弾で中断)。
// 歩数は障害物なしの FCC 格子距離(stepDist)= マンハッタン距離の類似。

import { Html } from '@react-three/drei';
import { cellKey, worldPos, type Cell } from '../../model/fcc';
import { stepDist } from '../../model/dungeon';
import { ITEMS } from '../../model/loot';
import { useRogue, ROGUE_S } from '../../state/rogue';

const S = ROGUE_S;

function Bubble({
  target,
  label,
  kind,
}: {
  target: Cell;
  label: string;
  kind: 'item' | 'passage';
}) {
  const travelTo = useRogue((s) => s.travelTo);
  const playerPos = useRogue((s) => s.player.pos);
  const w = worldPos(target[0], target[1], target[2], S);
  const d = stepDist(playerPos, target);
  return (
    <Html position={[w.x, w.y + 0.9 * S, w.z]} center zIndexRange={[50, 0]}>
      <div
        className={`hud-bubble ${kind}`}
        onClick={(e) => {
          e.stopPropagation();
          travelTo(target);
        }}
      >
        {label} <b>{d}歩</b>
      </div>
    </Html>
  );
}

export function Bubbles() {
  const phase = useRogue((s) => s.phase);
  const items = useRogue((s) => s.items);
  const playerPos = useRogue((s) => s.player.pos);
  const discoveredRev = useRogue((s) => s.discoveredRev);
  void discoveredRev; // discovered/dungeon.stubs は in-place 更新なので rev で再評価させる
  const { discovered, dungeon, cellChamber } = useRogue.getState();

  if (phase !== 'play') return null;

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
          (st) => st.from === chamberId && discovered.has(cellKey(st.mouth)),
        );

  return (
    <>
      {itemBubbles.map((i) => (
        <Bubble key={`i${i.id}`} target={i.pos} label={ITEMS[i.item].name} kind="item" />
      ))}
      {passages.map((st) => (
        <Bubble
          key={`p${st.id}`}
          target={st.mouth}
          label={st.used ? '通路' : '未踏の通路'}
          kind="passage"
        />
      ))}
    </>
  );
}
