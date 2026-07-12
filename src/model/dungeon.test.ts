import { describe, it, expect } from 'vitest';
import { cellKey, keyToCell, layer, type Cell } from './fcc';
import {
  createDungeon,
  expandAt,
  maybeExpand,
  reachableCount,
  distW,
  stepDist,
  slotKeyOfCell,
  collapseAbove,
  lineOfSight,
  adjacent,
} from './dungeon';

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
  it('掘る順序に依らず同じ迷宮になる(生成が位置の純関数)', () => {
    // 同じ seed のふたつの巣を、3世代ぶん逆順に展開しても空洞集合が一致する。
    const a = createDungeon(11);
    const b = createDungeon(11);
    for (let gen = 0; gen < 3; gen++) {
      for (const st of [...a.stubs]) if (!st.used) expandAt(a, st);
      for (const st of [...b.stubs].reverse()) if (!st.used) expandAt(b, st);
    }
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
            // 通路同士の共有は、同じ広間(スロット)に接する通路が
            // 戸口付近で触れる場合のみ許す(端点スロットを共有していること)。
            const ends = (x: (typeof dg.stubs)[number]) => [
              slotKeyOfCell(dg.chambers[x.from].center),
              slotKeyOfCell(x.exit),
            ];
            const prev = corridorOf.get(k);
            const ok =
              prev === undefined ||
              ends(dg.stubs[prev]).some((e) => ends(st).includes(e));
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

  it('通路の入り口(mouth)は掘削済みで、自分の広間の戸口(縁のすぐ外)にある', () => {
    for (const seed of [13, 17, 23]) {
      const dg = createDungeon(seed);
      for (const st of [...dg.stubs]) if (!st.used) expandAt(dg, st);
      for (const st of dg.stubs) {
        const home = dg.chambers[st.from];
        expect(dg.open.has(cellKey(st.mouth))).toBe(true);
        expect(distW(st.mouth, home.center)).toBeGreaterThan(home.r);
        expect(distW(st.mouth, home.center)).toBeLessThanOrEqual(home.r + 3); // 遠端ではない
      }
    }
  });
});

describe('collapseAbove(層リセット・rogue-19b)', () => {
  it('cutLayer より上の open セルが刈られ、rev が進む', () => {
    const dg = createDungeon(11);
    for (const st of [...dg.stubs]) if (!st.used) expandAt(dg, st);
    const revBefore = dg.rev;
    const before = dg.open.size;
    collapseAbove(dg, -5);
    expect(dg.rev).toBeGreaterThan(revBefore);
    expect(dg.open.size).toBeLessThan(before);
    for (const k of dg.open) expect(layer(keyToCell(k))).toBeLessThanOrEqual(-5);
  });

  it('cutLayer より上の広間は墓標化(cells=[]・collapsed=true)され、id は配列から抜かれない', () => {
    const dg = createDungeon(11);
    for (const st of [...dg.stubs]) if (!st.used) expandAt(dg, st);
    const idsBefore = dg.chambers.map((c) => c.id);
    collapseAbove(dg, -5);
    expect(dg.chambers.map((c) => c.id)).toEqual(idsBefore); // 配列から抜かない
    let sawCollapsed = false;
    let sawSurvivor = false;
    for (const ch of dg.chambers) {
      if (layer(ch.center) > -5) {
        expect(ch.collapsed).toBe(true);
        expect(ch.cells).toEqual([]);
        sawCollapsed = true;
      } else {
        expect(ch.collapsed ?? false).toBe(false);
        sawSurvivor = true;
      }
    }
    expect(sawCollapsed).toBe(true);
    expect(sawSurvivor).toBe(true);
  });

  it('崩落面より上のスロットは(明示的に expandAt を呼んでも)二度と実体化しない', () => {
    const dg = createDungeon(11);
    for (const st of [...dg.stubs]) if (!st.used) expandAt(dg, st);
    const cutLayer = -5;
    collapseAbove(dg, cutLayer);
    const before = dg.chambers.length;
    const shallowStub = dg.stubs.find((st) => layer(st.exit) > cutLayer - 8);
    expect(shallowStub).toBeDefined();
    const ch = expandAt(dg, shallowStub!);
    expect(ch).toBeNull();
    expect(dg.chambers.length).toBe(before);
  });

  it('崩落後も cutLayer より深いスタブは正常に拡張できる', () => {
    const dg = createDungeon(11);
    for (const st of [...dg.stubs]) if (!st.used) expandAt(dg, st);
    const cutLayer = -5;
    collapseAbove(dg, cutLayer);
    const before = dg.chambers.length;
    const deepStub = dg.stubs.find((st) => !st.used && layer(st.exit) <= cutLayer - 8);
    expect(deepStub).toBeDefined();
    const ch = expandAt(dg, deepStub!);
    expect(ch).not.toBeNull();
    expect(dg.chambers.length).toBe(before + 1);
  });

  it('崩落方向へ向かうスタブは削除されず used=true になるだけで残る(バブル側で cutLayer フィルタが必要)', () => {
    // seed=2 / cutLayer=-10 は、生存広間(collapsed=false)から崩落側(exit の layer >
    // cutLayer)へ伸びるスタブが残る組み合わせ(collapseAbove は used 化のみで配列から抜かない)。
    const dg = createDungeon(2);
    for (const st of [...dg.stubs]) if (!st.used) expandAt(dg, st);
    const cutLayer = -10;
    collapseAbove(dg, cutLayer);
    const survivorIds = new Set(dg.chambers.filter((c) => !c.collapsed).map((c) => c.id));
    const leftover = dg.stubs.filter(
      (st) => survivorIds.has(st.from) && layer(st.exit) > cutLayer,
    );
    // このスタブ自体は消えない(collapseAbove の仕様どおり)。
    expect(leftover.length).toBeGreaterThan(0);
    for (const st of leftover) expect(st.used).toBe(true);
    // Bubbles.tsx の通路フィルタが使う条件(exit の layer <= cutLayer)なら、
    // この残留スタブはちょうど除外される側になる。
    for (const st of leftover) expect(layer(st.exit) <= dg.cutLayer).toBe(false);
    // 一方、生存側へ伸びる本物の通路は条件を満たしたまま残る。
    const genuine = dg.stubs.filter(
      (st) => survivorIds.has(st.from) && layer(st.exit) <= cutLayer,
    );
    expect(genuine.length).toBeGreaterThan(0);
    for (const st of genuine) expect(layer(st.exit) <= dg.cutLayer).toBe(true);
  });
});

describe('lineOfSight(rogue-24: 遠隔攻撃の射線)', () => {
  it('同じ広間の中なら射線が通り、壁(open に無いセル)を挟むと通らない', () => {
    const dg = createDungeon(12345);
    const cells = dg.chambers[0].cells.map((k) => keyToCell(k));
    // 広間内の2セル(凸に近い胞塊なので、中心を挟む2点は概ね通る)。
    const center: Cell = dg.chambers[0].center;
    const far = cells.reduce((a, b) => (distW(center, b) > distW(center, a) ? b : a));
    expect(lineOfSight(dg.open, center, far)).toBe(true);
    // 壁の向こう(open から十分離れた未掘削セル)へは通らない。
    const outside: Cell = [center[0] + 40, center[1] + 40, center[2]];
    expect(lineOfSight(dg.open, center, outside)).toBe(false);
  });

  it('隣接セル同士は常に通る(間にサンプル点が無い)', () => {
    const dg = createDungeon(7);
    const c = dg.chambers[0].center;
    const n = keyToCell(dg.chambers[0].cells.find((k) => adjacent(keyToCell(k), c))!);
    expect(lineOfSight(dg.open, c, n)).toBe(true);
  });
});
