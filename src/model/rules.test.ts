import { describe, it, expect } from 'vitest';
import {
  type Board,
  hasFooting,
  zocSet,
  moveRange,
  pathTo,
  losStatus,
  forecast,
  exchange,
  canAttackFrom,
  canUseSkill,
  landingCell,
  spawnAnchors,
  deployZone,
  autoDeploy,
  gridDist,
} from './rules';
import { buildArena, cellKey, keyToCell, layer, neighbors, type Cell } from './fcc';
import type { Terrain, Vec3 } from './terrain';
import { createRoster, CLASSES, isFlying, type Unit } from './units';

const DUMMY_MESH = { positions: new Float32Array(), indices: new Uint32Array() };

/** 空気だけの地形（sdf は常に大きな正値）。 */
const AIR: Terrain = { sdf: () => 100, mesh: () => DUMMY_MESH };

/** u（フレーム鉛直）が floor 以下を地面とする水平スラブ地形。 */
function slabTerrain(floorU: number): Terrain {
  const SQRT3 = Math.sqrt(3);
  return {
    sdf: (p: Vec3) => (p[0] + p[1] + p[2]) / SQRT3 - floorU,
    mesh: () => DUMMY_MESH,
  };
}

/** テスト用ボード。層0-5・半径4 の小アリーナ。 */
function makeBoard(terrain: Terrain, d = 0.45): Board {
  const arenaSet = buildArena({ Lmin: 0, Lmax: 5, Hmax: 4 });
  const occluderSet = new Set<string>();
  for (const k of arenaSet) {
    if (terrain.sdf(keyToCell(k)) <= d) occluderSet.add(k);
  }
  return { arenaSet, occluderSet, terrain, Lmin: 0 };
}

/** 指定クラスのユニットを作る小ヘルパ。 */
function unit(id: number, side: 'player' | 'enemy', cls: Unit['cls'], pos: Cell): Unit {
  return {
    id,
    side,
    cls,
    name: CLASSES[cls].name,
    pos,
    hp: CLASSES[cls].hp,
    levitate: 0,
    acted: false,
    alive: true,
  };
}

describe('hasFooting / 歩行の足場', () => {
  it('層 Lmin は常に足場、直下に occluder があれば足場', () => {
    const board = makeBoard(AIR);
    const bottom: Cell = [0, 0, 0]; // L=0=Lmin
    expect(hasFooting(bottom, board)).toBe(true);
    const mid: Cell = [2, 2, 0]; // L=2、下は空気
    expect(hasFooting(mid, board)).toBe(false);
    // 直下セルを occluder にすると足場になる
    board.occluderSet.add(cellKey([1, 1, 0]));
    expect(hasFooting(mid, board)).toBe(true);
  });
});

describe('moveRange / ZOC・飛行・歩行', () => {
  it('飛行ユニットは move ステップ以内の通行セルへ届く（空中も可）', () => {
    const board = makeBoard(AIR);
    const u = unit(1, 'player', 'witch', [0, 0, 0]);
    const { dests } = moveRange(u, [u], board);
    expect(dests.size).toBeGreaterThan(12); // 複数歩ぶん広がる
    for (const k of dests) {
      expect(board.arenaSet.has(k)).toBe(true);
      expect(board.occluderSet.has(k)).toBe(false);
    }
  });

  it('歩行ユニットは足場のないセルへ入れない', () => {
    const board = makeBoard(AIR); // 空気のみ → 足場は層0だけ
    const u = unit(1, 'player', 'knight', [0, 0, 0]);
    const { dests } = moveRange(u, [u], board);
    expect(dests.size).toBeGreaterThan(0);
    for (const k of dests) expect(layer(keyToCell(k))).toBe(0); // 层0 に張り付く
  });

  it('浮遊が付与された歩行ユニットは空中へ入れる', () => {
    const board = makeBoard(AIR);
    const u = unit(1, 'player', 'knight', [0, 0, 0]);
    u.levitate = 2;
    expect(isFlying(u)).toBe(true);
    const { dests } = moveRange(u, [u], board);
    const hasAir = [...dests].some((k) => layer(keyToCell(k)) > 0);
    expect(hasAir).toBe(true);
  });

  it('敵 ZOC セルに入ると移動終了（通過不可）、進入自体は可能', () => {
    const board = makeBoard(AIR);
    const me = unit(1, 'player', 'witch', [0, 0, 0]);
    const foe = unit(2, 'enemy', 'gargoyle', [4, 4, 0]);
    const { dests, parent } = moveRange(me, [me, foe], board);
    const zoc = zocSet([me, foe], 'enemy');
    // ZOC セルに入る経路はあるが、その先（親が ZOC セル）の到達点は存在しない
    let enteredZoc = false;
    for (const k of dests) {
      const p = parent.get(k);
      if (zoc.has(k)) enteredZoc = true;
      if (p !== undefined && p !== cellKey(me.pos)) {
        expect(zoc.has(p)).toBe(false); // ZOC セルを親（通過点）にできない
      }
    }
    expect(enteredZoc).toBe(true);
    // 敵の占有セル自体は到達不可
    expect(dests.has(cellKey(foe.pos))).toBe(false);
  });

  it('味方は通過できるが停止できない', () => {
    const board = makeBoard(AIR);
    const me = unit(1, 'player', 'witch', [0, 0, 0]);
    const ally = unit(2, 'player', 'winged', [1, 1, 0]);
    const { dests } = moveRange(me, [me, ally], board);
    expect(dests.has(cellKey(ally.pos))).toBe(false);
    // 味方の向こう側（2ステップ先）には行ける
    const beyond: Cell = [2, 2, 0];
    expect(dests.has(cellKey(beyond))).toBe(true);
  });

  it('pathTo は開始→目的の連結経路を返す', () => {
    const board = makeBoard(AIR);
    const u = unit(1, 'player', 'witch', [0, 0, 0]);
    const { dests, parent } = moveRange(u, [u], board);
    const goal = keyToCell([...dests].sort()[0]);
    const path = pathTo(u.pos, goal, parent);
    expect(path[0]).toEqual(u.pos);
    expect(path[path.length - 1]).toEqual(goal);
    for (let i = 1; i < path.length; i++) {
      expect(gridDist(path[i - 1], path[i])).toBeCloseTo(Math.SQRT2, 5);
    }
  });
});

describe('losStatus / 射線と遮蔽', () => {
  it('空気のみなら clear、壁に完全に遮られると blocked', () => {
    expect(losStatus([0, 0, 0], [4, 4, 0], AIR)).toBe('clear');
    // P と Q の間に厚い球（半径2）を置く
    const wall: Terrain = {
      sdf: (p: Vec3) => Math.hypot(p[0] - 2, p[1] - 2, p[2]) - 2,
      mesh: () => DUMMY_MESH,
    };
    expect(losStatus([0, 0, 0], [4, 4, 0], wall)).toBe('blocked');
  });

  it('表面をかすめる射線は cover になる', () => {
    // 中点付近で sdf が 0.5 程度になる細い球
    const graze: Terrain = {
      sdf: (p: Vec3) => Math.hypot(p[0] - 2, p[1] - 2, p[2] - 0.5) - 0.1,
      mesh: () => DUMMY_MESH,
    };
    expect(losStatus([0, 0, 0], [4, 4, 0], graze)).toBe('cover');
  });

  it('隣接は常に clear（近接は射線不要）', () => {
    const wall: Terrain = { sdf: () => -1, mesh: () => DUMMY_MESH };
    expect(losStatus([0, 0, 0], [1, 1, 0], wall)).toBe('clear');
  });
});

describe('forecast / 命中・ダメージ補正', () => {
  it('高所から攻撃すると命中+10・ダメージ+1、低所は逆', () => {
    const board = makeBoard(AIR);
    void board;
    const atk = unit(1, 'player', 'winged', [0, 0, 2]); // L=1
    const def = unit(2, 'enemy', 'gargoyle', [1, 1, 0]); // L=1 → 同層にしてから比較
    const flat = forecast(atk, [1, -1, 0], def, [atk, def], AIR); // L=0 → 低所(-1)
    const high = forecast(atk, [1, 1, 2], def, [atk, def], AIR); // L=2 → 高所(+1)
    expect(high.hit - flat.hit).toBe(20); // ±10 の差
    expect(high.dmg - flat.dmg).toBe(2); // ±1 の差
  });

  it('隣接味方1体につき命中+8（上限24）', () => {
    const atk = unit(1, 'player', 'winged', [0, 0, 0]);
    const def = unit(2, 'enemy', 'gargoyle', [1, 1, 0]);
    const solo = forecast(atk, atk.pos, def, [atk, def], AIR);
    const ally = unit(3, 'player', 'knight', [1, -1, 0]); // atk に隣接
    const backed = forecast(atk, atk.pos, def, [atk, def, ally], AIR);
    expect(backed.hit - solo.hit).toBe(8);
  });

  it('命中は 5..100 に clamp される', () => {
    const atk = unit(1, 'player', 'cleric', [0, 0, 0]); // hit 80
    const def = unit(2, 'enemy', 'gargoyle', [1, 1, 0]);
    const f = forecast(atk, atk.pos, def, [atk, def], AIR);
    expect(f.hit).toBeGreaterThanOrEqual(5);
    expect(f.hit).toBeLessThanOrEqual(100);
  });
});

describe('exchange / 反撃', () => {
  it('近接同士は反撃あり、弓の隣接攻撃は minRange 的に不可', () => {
    const knight = unit(1, 'player', 'knight', [0, 0, 0]);
    const skel = unit(2, 'enemy', 'skeleton', [1, 1, 0]);
    const ex = exchange(knight, knight.pos, skel, [knight, skel], AIR);
    expect(ex.counter).not.toBeNull();

    const archer = unit(3, 'player', 'archer', [0, 0, 0]);
    // 弓は隣接に撃てない
    expect(canAttackFrom(archer, archer.pos, skel, AIR)).toBe(false);
    // 距離2ステップ（例: [2,2,0] は距離2.83 ≤ 4）なら撃てるし、近接からの反撃は届かない
    const far = unit(4, 'enemy', 'skeleton', [2, 2, 0]);
    expect(canAttackFrom(archer, archer.pos, far, AIR)).toBe(true);
    const ex2 = exchange(archer, archer.pos, far, [archer, far], AIR);
    expect(ex2.counter).toBeNull();
  });
});

describe('スキル / ヒール・浮遊', () => {
  it('ヒールは負傷した射程内の味方のみ、浮遊は歩行の味方のみ', () => {
    const cleric = unit(1, 'player', 'cleric', [0, 0, 0]);
    const knight = unit(2, 'player', 'knight', [1, 1, 0]);
    expect(canUseSkill(cleric, cleric.pos, 'heal', knight)).toBe(false); // 無傷
    knight.hp -= 4;
    expect(canUseSkill(cleric, cleric.pos, 'heal', knight)).toBe(true);
    // 浮遊: 歩行の knight に可、飛行の witch に不可
    expect(canUseSkill(cleric, cleric.pos, 'levitate', knight)).toBe(true);
    const witch = unit(3, 'player', 'witch', [1, -1, 0]);
    expect(canUseSkill(cleric, cleric.pos, 'levitate', witch)).toBe(false);
    // 敵には不可
    const foe = unit(4, 'enemy', 'skeleton', [1, 1, 0]);
    foe.hp -= 2;
    expect(canUseSkill(cleric, cleric.pos, 'heal', foe)).toBe(false);
  });
});

describe('landingCell / 浮遊切れの降着', () => {
  it('足場があればそのまま、空中なら下方の足場セルへ落ちる', () => {
    const board = makeBoard(AIR);
    const ground: Cell = [0, 0, 0];
    expect(landingCell(ground, board, [], 1)).toEqual(ground);
    const air: Cell = [2, 2, 0]; // L=2 の空中
    const landed = landingCell(air, board, [], 1);
    expect(layer(landed)).toBeLessThan(layer(air));
    expect(hasFooting(landed, board)).toBe(true);
  });
});

describe('配置 / spawnAnchors・deployZone・autoDeploy', () => {
  it('両アンカーは足場のある通行セルで、長手軸の両端に分かれる', () => {
    const board = makeBoard(slabTerrain(0.3)); // 底面が地面
    const { player, enemy } = spawnAnchors(board);
    for (const c of [player, enemy]) {
      expect(board.arenaSet.has(cellKey(c))).toBe(true);
      expect(board.occluderSet.has(cellKey(c))).toBe(false);
      expect(hasFooting(c, board)).toBe(true);
    }
    expect(gridDist(player, enemy)).toBeGreaterThan(3);
  });

  it('autoDeploy は全ユニットを配置ゾーン内の相異なるセルへ置く（歩行は足場）', () => {
    const board = makeBoard(slabTerrain(0.3));
    const { player } = spawnAnchors(board);
    const zone = deployZone(player, board);
    const units = createRoster('player', 1);
    autoDeploy(units, player, zone, board);
    const seen = new Set<string>();
    for (const u of units) {
      const k = cellKey(u.pos);
      expect(zone.has(k)).toBe(true);
      expect(seen.has(k)).toBe(false);
      seen.add(k);
      if (!isFlying(u)) expect(hasFooting(u.pos, board)).toBe(true);
    }
  });

  it('deployZone はアンカー近傍の通行セルだけを含む', () => {
    const board = makeBoard(slabTerrain(0.3));
    const { player } = spawnAnchors(board);
    const zone = deployZone(player, board);
    expect(zone.size).toBeGreaterThan(6);
    for (const k of zone) {
      expect(board.occluderSet.has(k)).toBe(false);
      expect(gridDist(keyToCell(k), player)).toBeLessThanOrEqual(4);
    }
  });
});

describe('zocSet', () => {
  it('生存する指定陣営ユニットの12近傍の合併になる', () => {
    const a = unit(1, 'enemy', 'skeleton', [0, 0, 0]);
    const b = unit(2, 'enemy', 'skeleton', [4, 4, 0]);
    const dead = unit(3, 'enemy', 'skeleton', [2, 2, 2]);
    dead.alive = false;
    const z = zocSet([a, b, dead], 'enemy');
    expect(z.size).toBe(24); // 重ならない2ユニット分
    for (const n of neighbors(a.pos)) expect(z.has(cellKey(n))).toBe(true);
    for (const n of neighbors(dead.pos)) expect(z.has(cellKey(n))).toBe(false);
  });
});
