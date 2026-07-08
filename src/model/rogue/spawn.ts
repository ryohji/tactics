// 広間生成時の湧き(rogue-17 で state/rogue.ts populate から分離)。純関数。
// id 採番はモジュール外のカウンタなので nextBeastId/nextItemId として受け取る
// (呼び出し順を保つため store 側の ++演算子をそのまま渡せる形にしてある)。

import { cellKey, keyToCell, layer, type Cell } from '../fcc';
import { cellRng, type Chamber, type Dungeon } from '../dungeon';
import { BEASTS, spawnTable } from '../beasts';
import { lootTable } from '../loot';
import { depthOf } from './rules';
import type { Beast, GroundItem } from './types';

export function spawnChamber(
  dungeon: Dungeon,
  ch: Chamber,
  nextBeastId: () => number,
  nextItemId: () => number,
): { beasts: Beast[]; items: GroundItem[] } {
  const depth = Math.max(0, depthOf(ch.center));
  // 広間の中心から導出した rng(生成順・戦闘に依らずシードだけで決まる)。
  const rng = cellRng(dungeon.seed, ch.center, 2);
  const spots = ch.cells.filter((k) => k !== cellKey(ch.center));
  const takeSpot = (): Cell | null => {
    if (spots.length === 0) return null;
    const i = Math.floor(rng() * spots.length);
    return keyToCell(spots.splice(i, 1)[0]);
  };
  const homeL = layer(ch.center);

  const beasts: Beast[] = [];
  for (const kind of spawnTable(depth, rng)) {
    const pos = takeSpot();
    if (!pos) break;
    const def = BEASTS[kind];
    beasts.push({
      id: nextBeastId(),
      kind,
      pos,
      hp: def.hp,
      home: ch.center,
      homeChamber: ch.id,
      layerFloor: homeL - def.vBelow,
      layerCeil: homeL + def.vAbove,
      awake: false,
      alive: true,
      status: null,
    });
  }

  const items: GroundItem[] = [];
  for (const stack of lootTable(depth, rng)) {
    const pos = takeSpot();
    if (!pos) break;
    items.push({ id: nextItemId(), stack, pos });
  }

  return { beasts, items };
}
