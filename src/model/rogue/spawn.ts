// 広間生成時の湧き(rogue-17 で state/rogue.ts populate から分離)。純関数。
// id 採番はモジュール外のカウンタなので nextBeastId/nextItemId として受け取る
// (呼び出し順を保つため store 側の ++演算子をそのまま渡せる形にしてある)。

import { cellKey, keyToCell, layer, type Cell } from '../fcc';
import { cellRng, type Chamber, type Dungeon } from '../dungeon';
import { BEASTS, spawnTable, gatekeeperFor, depthScale } from '../beasts';
import { lootTable } from '../loot';
import { depthOf } from './rules';
import { STRATUM_DEPTH } from './types';
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

  // 深度係数(rogue-24): 深度24超の敵は hp/atk が伸び続ける(切り上げ・決定論)。
  const scale = depthScale(depth);
  const beasts: Beast[] = [];
  for (const kind of spawnTable(depth, rng)) {
    const pos = takeSpot();
    if (!pos) break;
    const def = BEASTS[kind];
    // 持ち物は湧きの時点で前倒し抽選する(rogue-19b)。倒したときの抽選(30%・
    // lootTable)と同じ確率・同じテーブルだが、rng はこの広間の湧き rng を使う。
    const carry = rng() < 0.3 ? (lootTable(Math.max(1, depth), rng)[0] ?? null) : null;
    beasts.push({
      id: nextBeastId(),
      kind,
      pos,
      hp: Math.ceil(def.hp * scale),
      home: ch.center,
      homeChamber: ch.id,
      layerFloor: homeL - def.vBelow,
      layerCeil: homeL + def.vAbove,
      awake: false,
      alive: true,
      status: null,
      carry,
      ...(scale > 1 ? { atkOverride: Math.ceil(def.atk * scale) } : {}),
    });
  }

  // 門番(rogue-24): 層境界帯(8k−1〜8k+1)の広間は 35% で層ボスが1体加わる。
  // 抽選はこの広間の rng の末尾で行う — 境界帯以外の広間は乱数を余分に引かない。
  const k = Math.round(depth / STRATUM_DEPTH);
  if (k >= 1 && Math.abs(depth - k * STRATUM_DEPTH) <= 1 && rng() < 0.35) {
    const pos = takeSpot();
    if (pos) {
      const g = gatekeeperFor(k);
      const def = BEASTS[g.kind];
      // 討伐報酬(スロット+1)にふさわしく、持ち物は必ず1個・高品質(+2)を保証する。
      const drop = lootTable(Math.max(1, depth), rng)[0] ?? { item: 'potion' as const, q: 0 };
      beasts.push({
        id: nextBeastId(),
        kind: g.kind,
        pos,
        hp: g.hp,
        home: ch.center,
        homeChamber: ch.id,
        layerFloor: homeL - def.vBelow,
        layerCeil: homeL + def.vAbove,
        awake: false,
        alive: true,
        status: null,
        carry: { ...drop, q: drop.q + 2 },
        atkOverride: g.atk,
        defOverride: g.def,
      });
    }
  }

  const items: GroundItem[] = [];
  for (const stack of lootTable(depth, rng)) {
    const pos = takeSpot();
    if (!pos) break;
    items.push({ id: nextItemId(), stack, pos });
  }

  return { beasts, items };
}
