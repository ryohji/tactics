// 遺物「巣の琥珀」の湧き(rogue-25)の単体テスト。spawnChamber は純関数なので、
// Dungeon/Chamber を直接組み立てて深度を制御する(state/rogue.ts を経由しない)。

import { describe, it, expect } from 'vitest';
import { cellKey, neighbors, type Cell } from '../fcc';
import { lcg, type Chamber, type Dungeon } from '../dungeon';
import { spawnChamber } from './spawn';

function fakeDungeon(seed: number): Dungeon {
  return {
    open: new Set(),
    chambers: [],
    stubs: [],
    slots: new Map(),
    seed,
    rng: lcg(seed),
    rev: 0,
    cutLayer: 999999,
  };
}

/** depth 相当の広間(center の layer=-4*depth → depthOf(center)=depth。12近傍を候補セルに使う)。 */
function chamberAt(id: number, depth: number): Chamber {
  const center: Cell = [0, -8 * depth, 0];
  const cells = [cellKey(center), ...neighbors(center).map(cellKey)];
  return { id, center, r: 3, cells };
}

function counters() {
  let beastId = 1;
  let itemId = 1;
  return { nextBeastId: () => beastId++, nextItemId: () => itemId++ };
}

describe('遺物「巣の琥珀」の湧き(rogue-25)', () => {
  it('中間帯(深度3〜5・11〜13・19〜21)では複数シードのどこかで amber が湧く', () => {
    for (const depth of [3, 4, 5, 11, 12, 13, 19, 20, 21]) {
      let found = false;
      for (let seed = 1; seed <= 60 && !found; seed++) {
        const { nextBeastId, nextItemId } = counters();
        const { items } = spawnChamber(fakeDungeon(seed), chamberAt(1, depth), nextBeastId, nextItemId);
        if (items.some((i) => i.stack.item === 'amber')) found = true;
      }
      expect(found, `depth=${depth} で60シード中1つも amber が湧かなかった`).toBe(true);
    }
  });

  it('amber の品質 q は層番号-1(k-1)になる(深度3〜5→q0・11〜13→q1・19〜21→q2)', () => {
    const expectQ: [number, number][] = [
      [3, 0], [4, 0], [5, 0],
      [11, 1], [12, 1], [13, 1],
      [19, 2], [20, 2], [21, 2],
    ];
    for (const [depth, q] of expectQ) {
      for (let seed = 1; seed <= 60; seed++) {
        const { nextBeastId, nextItemId } = counters();
        const { items } = spawnChamber(fakeDungeon(seed), chamberAt(1, depth), nextBeastId, nextItemId);
        const amber = items.find((i) => i.stack.item === 'amber');
        if (amber) expect(amber.stack.q).toBe(q);
      }
    }
  });

  it('帯の外(深度0〜2・6〜10・14〜18・22〜26)では amber が一度も湧かない', () => {
    for (const depth of [0, 1, 2, 6, 7, 8, 9, 10, 14, 15, 16, 17, 18, 22, 23, 24, 25, 26]) {
      for (let seed = 1; seed <= 40; seed++) {
        const { nextBeastId, nextItemId } = counters();
        const { items } = spawnChamber(fakeDungeon(seed), chamberAt(1, depth), nextBeastId, nextItemId);
        expect(items.some((i) => i.stack.item === 'amber')).toBe(false);
      }
    }
  });

  it('決定性: 同じ seed・同じ広間なら結果(beasts/items)が完全に一致する', () => {
    const depth = 4; // 中間帯
    for (const seed of [7, 42, 12345]) {
      const c1 = counters();
      const c2 = counters();
      const a = spawnChamber(fakeDungeon(seed), chamberAt(1, depth), c1.nextBeastId, c1.nextItemId);
      const b = spawnChamber(fakeDungeon(seed), chamberAt(1, depth), c2.nextBeastId, c2.nextItemId);
      expect(a.items.map((i) => i.stack)).toEqual(b.items.map((i) => i.stack));
      expect(a.beasts.map((x) => ({ kind: x.kind, pos: x.pos }))).toEqual(
        b.beasts.map((x) => ({ kind: x.kind, pos: x.pos })),
      );
    }
  });
});
