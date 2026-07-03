import { describe, it, expect } from 'vitest';
import { cellKey, layer } from './fcc';
import { createDungeon, expandAt, maybeExpand, reachableCount, distW } from './dungeon';

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
  it('スタブ位置に広間が生成され、連結が保たれ、新スタブが伸びる', () => {
    const dg = createDungeon(5);
    const stubsBefore = dg.stubs.length;
    const ch = expandAt(dg, dg.stubs[0]);
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

  it('スタブ終端は広間の外にある(通路として意味を持つ)', () => {
    const dg = createDungeon(13);
    for (const st of dg.stubs) {
      const home = dg.chambers[st.from];
      expect(distW(st.exit, home.center)).toBeGreaterThanOrEqual(home.r + 3);
    }
  });
});
