import { describe, it, expect } from 'vitest';
import { cellKey, layer } from './fcc';
import { createDungeon, expandAt, maybeExpand, reachableCount, distW, stepDist } from './dungeon';

describe('stepDist(FCC 最短歩数)', () => {
  it('近傍は1歩、軸方向2は2歩', () => {
    expect(stepDist([0, 0, 0], [1, 1, 0])).toBe(1);
    expect(stepDist([0, 0, 0], [2, 0, 0])).toBe(2);
    expect(stepDist([0, 0, 0], [0, 0, 0])).toBe(0);
  });
  it('複合方向も整数歩(1,1,2 は2歩・2,2,0 は2歩)', () => {
    expect(stepDist([0, 0, 0], [1, 1, 2])).toBe(2);
    expect(stepDist([0, 0, 0], [2, 2, 0])).toBe(2);
    expect(stepDist([1, 1, 0], [3, 3, 2])).toBe(3);
  });
});

describe('createDungeon', () => {
  it('同じ seed なら同じ巣になる(決定性)', () => {
    const a = createDungeon(7);
    const b = createDungeon(7);
    expect([...a.open].sort()).toEqual([...b.open].sort());
    expect(a.stubs.map((s) => cellKey(s.exit))).toEqual(b.stubs.map((s) => cellKey(s.exit)));
  });

  it('入口が空洞で、スタブが2本以上ある', () => {
    const dg = createDungeon(1);
    expect(dg.open.has('0,0,0')).toBe(true);
    expect(dg.chambers).toHaveLength(1);
    expect(dg.stubs.length).toBeGreaterThanOrEqual(2);
    // スタブ終端も掘削済み(通路は掘り切ってある)。
    for (const st of dg.stubs) expect(dg.open.has(cellKey(st.exit))).toBe(true);
  });

  it('全空洞セルが入口から連結している', () => {
    const dg = createDungeon(3);
    expect(reachableCount(dg)).toBe(dg.open.size);
  });
});

describe('expandAt / maybeExpand', () => {
  it('掘る順序に依らず同じ迷宮になる(スタブ位置から rng を導出)', () => {
    // 同じ seed のふたつの巣で、最初の2本のスタブを逆順に展開しても空洞集合が一致する。
    const a = createDungeon(11);
    const b = createDungeon(11);
    expandAt(a, a.stubs[0]);
    expandAt(a, a.stubs[1]);
    expandAt(b, b.stubs[1]);
    expandAt(b, b.stubs[0]);
    expect([...a.open].sort()).toEqual([...b.open].sort());
    // 同じ位置に生えた広間は同じ半径・同じセル集合。
    const chA = a.chambers.find((c) => cellKey(c.center) === cellKey(a.stubs[0].exit))!;
    const chB = b.chambers.find((c) => cellKey(c.center) === cellKey(b.stubs[0].exit))!;
    expect(chA.r).toBe(chB.r);
    expect([...chA.cells].sort()).toEqual([...chB.cells].sort());
  });

  it('スタブ位置に広間が生成され、連結が保たれ、新スタブが伸びる', () => {
    const dg = createDungeon(5);
    const stubsBefore = dg.stubs.length;
    const ch = expandAt(dg, dg.stubs[0])!;
    expect(ch).not.toBeNull();
    expect(dg.chambers).toHaveLength(2);
    expect(ch.cells.length).toBeGreaterThan(5);
    expect(dg.stubs[0].used).toBe(true);
    expect(dg.stubs.length).toBeGreaterThan(stubsBefore); // 新しい広間からもスタブ
    expect(reachableCount(dg)).toBe(dg.open.size);
  });

  it('近づいたスタブだけ生成される', () => {
    const dg = createDungeon(9);
    const st = dg.stubs[0];
    const far = maybeExpand(dg, [0, 0, 0], 3); // 入口から終端は遠い(通路長≥10)
    expect(far).toHaveLength(0);
    const near = maybeExpand(dg, st.exit, 3);
    expect(near.length).toBeGreaterThanOrEqual(1);
    expect(near[0].center).toEqual(st.exit);
  });

  it('下向きバイアス: 2世代拡張すると入口より深い広間ができる', () => {
    const dg = createDungeon(11);
    for (const st of [...dg.stubs]) if (!st.used) expandAt(dg, st);
    for (const st of [...dg.stubs]) if (!st.used) expandAt(dg, st);
    const minLayer = Math.min(...dg.chambers.map((c) => layer(c.center)));
    expect(minLayer).toBeLessThan(0);
  });

  it('広間は互いに重ならない(セル集合が素)', () => {
    for (const seed of [1, 2, 3, 5, 7, 11, 42]) {
      const dg = createDungeon(seed);
      // 3世代ぶん全スタブを展開して重なりの機会を作る。
      for (let gen = 0; gen < 3; gen++) {
        for (const st of [...dg.stubs]) if (!st.used) expandAt(dg, st);
      }
      const owner = new Map<string, number>();
      for (const ch of dg.chambers) {
        for (const k of ch.cells) {
          expect(owner.has(k), `seed ${seed}: セル ${k} を広間 ${owner.get(k)} と ${ch.id} が共有`).toBe(false);
          owner.set(k, ch.id);
        }
      }
      expect(reachableCount(dg)).toBe(dg.open.size); // 連結は保たれる
    }
  });

  it('通路は他の通路・無関係な広間と重ならない', () => {
    for (const seed of [1, 2, 3, 5, 7, 11, 42]) {
      const dg = createDungeon(seed);
      for (let gen = 0; gen < 3; gen++) {
        for (const st of [...dg.stubs]) if (!st.used) expandAt(dg, st);
      }
      const chamberOf = new Map<string, number>();
      for (const ch of dg.chambers) for (const k of ch.cells) chamberOf.set(k, ch.id);
      const corridorOf = new Map<string, number>();
      for (const st of dg.stubs) {
        for (const k of st.path) {
          const chId = chamberOf.get(k);
          if (chId !== undefined) {
            // 通路セルが広間に属してよいのは、出発点の親広間と、終端に生えた自分の広間だけ。
            const child = dg.chambers[chId];
            const ok = chId === st.from || cellKey(child.center) === cellKey(st.exit);
            expect(ok, `seed ${seed}: 通路 ${st.id} のセル ${k} が無関係な広間 ${chId} と重なる`).toBe(true);
          } else {
            // 通路同士の共有は、同じ広間から出た兄弟が戸口付近で重なる場合のみ許す。
            const prev = corridorOf.get(k);
            const ok = prev === undefined || dg.stubs[prev].from === st.from;
            expect(ok, `seed ${seed}: セル ${k} を通路 ${prev} と ${st.id} が共有`).toBe(true);
            corridorOf.set(k, st.id);
          }
        }
      }
    }
  });

  it('スタブ終端は広間の外にある(通路として意味を持つ)', () => {
    const dg = createDungeon(13);
    for (const st of dg.stubs) {
      const home = dg.chambers[st.from];
      expect(distW(st.exit, home.center)).toBeGreaterThanOrEqual(home.r + 3);
    }
  });

  it('通路の入り口(mouth)は掘削済みで、広間の縁の外・終端より内にある', () => {
    const dg = createDungeon(17);
    for (const st of dg.stubs) {
      const home = dg.chambers[st.from];
      expect(dg.open.has(cellKey(st.mouth))).toBe(true);
      expect(distW(st.mouth, home.center)).toBeGreaterThan(home.r);
      expect(distW(st.mouth, home.center)).toBeLessThanOrEqual(distW(st.exit, home.center));
    }
  });
});
