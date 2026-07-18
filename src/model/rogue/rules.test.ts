// isoDate・dailySeed(rogue-20「本日の迷宮」)の純関数テスト。
// playerAtk/playerEvade は rogue-27 でランク付き(EquippedSkill)へ移行。

import { describe, it, expect } from 'vitest';
import { isoDate, dailySeed, playerAtk, playerEvade, straightSteps, knockbackPath, dashCells, sightRadius } from './rules';
import { LIGHT } from './types';
import { cellKey, OFFSETS, type Cell } from '../fcc';
import type { Dungeon } from '../dungeon';
import type { PlayerState } from './types';
import type { EquippedSkill, NodeId } from './mastery';

/** 純関数テスト用の最小 Dungeon(open 集合以外は使われないダミー値)。 */
function fakeDungeon(openCells: readonly Cell[]): Dungeon {
  return {
    open: new Set(openCells.map(cellKey)),
    chambers: [],
    stubs: [],
    slots: new Map(),
    seed: 0,
    rng: () => 0,
    rev: 0,
    cutLayer: 1_000_000,
  };
}

function basePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    pos: [0, 0, 0],
    hp: 24,
    maxHp: 24,
    weapon: null,
    armor: null,
    shield: null,
    pack: [],
    relics: [],
    barrier: 0,
    status: null,
    immune: 0,
    ...overrides,
  };
}

/** id・rank から EquippedSkill 配列を組む(テスト用の簡略記法)。 */
function eq(...entries: [NodeId, number][]): EquippedSkill[] {
  return entries.map(([id, rank]) => ({ id, rank }));
}

describe('isoDate', () => {
  it('YYYY-MM-DD 形式に整形する(月・日は0埋め)', () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(isoDate(new Date(2026, 10, 23))).toBe('2026-11-23');
  });
});

describe('dailySeed(本日の迷宮)', () => {
  it('同じ日付なら時刻が違っても同じシードになる(決定性)', () => {
    const a = dailySeed(new Date(2026, 6, 12, 0, 0, 1));
    const b = dailySeed(new Date(2026, 6, 12, 23, 59, 59));
    expect(a).toBe(b);
  });

  it('日付が違えば通常は違うシードになる', () => {
    const a = dailySeed(new Date(2026, 6, 12));
    const b = dailySeed(new Date(2026, 6, 13));
    expect(a).not.toBe(b);
  });

  it('常に有効な整数シードを返す', () => {
    const s = dailySeed(new Date(2026, 6, 12));
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
  });
});

describe('playerEvade(盾の回避%。rogue-22)', () => {
  it('盾なしは0、盾装備で品質込みの回避%が上がる', () => {
    expect(playerEvade(basePlayer())).toBe(0);
    expect(playerEvade(basePlayer({ shield: { item: 'shield', q: 0 } }))).toBe(10);
    expect(playerEvade(basePlayer({ shield: { item: 'shield', q: 2 } }))).toBe(14);
  });
});

describe('スキルノードの効果(rogue-23。rogue-27でランク制。rogue-35で研鑽を廃止・両手保持/盾術を増強)', () => {
  const dagger = { item: 'dagger', q: 0 } as const; // 片手武器
  const spear = { item: 'spear', q: 0 } as const; // 両手武器(twoHanded)
  const shield = { item: 'shield', q: 0 } as const;

  it('eq 省略時は素の値のまま(既存呼び出し元への後方互換)', () => {
    const p = basePlayer({ weapon: dagger });
    expect(playerAtk(p)).toBe(playerAtk(p, []));
  });

  it('ryote(両手保持): 片手武器・盾スロットが空のときだけ攻撃+3(rogue-35: +2→+3)', () => {
    const bare = basePlayer({ weapon: dagger, shield: null });
    const withShield = basePlayer({ weapon: dagger, shield });
    const twoHanded = basePlayer({ weapon: spear, shield: null });
    expect(playerAtk(bare, eq(['ryote', 1]))).toBe(playerAtk(bare) + 3);
    expect(playerAtk(withShield, eq(['ryote', 1]))).toBe(playerAtk(withShield)); // 盾で埋まっていると発動しない
    expect(playerAtk(twoHanded, eq(['ryote', 1]))).toBe(playerAtk(twoHanded)); // 両手武器には効かない
  });

  it('katate(片手扱い): 両手武器+盾の同時装備中のみ攻撃−2', () => {
    const dualWield = basePlayer({ weapon: spear, shield }); // katate があって初めて成立する組み合わせ
    const twoHandedOnly = basePlayer({ weapon: spear, shield: null });
    expect(playerAtk(dualWield, eq(['katate', 1]))).toBe(playerAtk(dualWield) - 2);
    expect(playerAtk(twoHandedOnly, eq(['katate', 1]))).toBe(playerAtk(twoHandedOnly)); // 盾が無ければ発動しない
  });

  it('jutsu(盾術): 盾装備中の回避+ランク段階(8/12/16。rogue-35で増強・盾なしには効かない)', () => {
    const withShield = basePlayer({ shield });
    const withoutShield = basePlayer({ shield: null });
    expect(playerEvade(withShield, eq(['jutsu', 1]))).toBe(playerEvade(withShield) + 8);
    expect(playerEvade(withShield, eq(['jutsu', 2]))).toBe(playerEvade(withShield) + 12);
    expect(playerEvade(withShield, eq(['jutsu', 3]))).toBe(playerEvade(withShield) + 16);
    expect(playerEvade(withoutShield, eq(['jutsu', 1]))).toBe(0);
  });

  it('keikai(警戒・rogue-35): 遠隔攻撃への回避+10%(盾不要・掲盾と加算)', () => {
    const bare = basePlayer();
    expect(playerEvade(bare, eq(['keikai', 1]), true) - playerEvade(bare, [], true)).toBe(10);
    expect(playerEvade(bare, eq(['keikai', 1]), false)).toBe(playerEvade(bare, [], false)); // 近接には効かない
    const withShieldAndTateKakage = basePlayer({ shield });
    expect(
      playerEvade(withShieldAndTateKakage, eq(['keikai', 1], ['tateKakage', 1]), true) -
        playerEvade(withShieldAndTateKakage, [], true),
    ).toBe(30); // 掲盾+20と加算
  });
});

describe('二刀流(左手武器)の盾ボーナス kind ガード(rogue-30)', () => {
  const dagger = { item: 'dagger', q: 0 } as const; // 片手武器(左手に入りうる)
  const shield = { item: 'shield', q: 0 } as const;

  it('盾スロットに武器が入っていると盾の基礎回避%が乗らない', () => {
    expect(playerEvade(basePlayer({ shield: dagger }))).toBe(0);
    expect(playerEvade(basePlayer({ shield }))).toBe(10); // 本物の盾なら乗る(対照)
  });

  it('jutsu(盾術)の回避加算は盾スロットが本物の盾(kind===shield)のときだけ乗る', () => {
    const withWeapon = basePlayer({ shield: dagger });
    const withShield = basePlayer({ shield });
    expect(playerEvade(withWeapon, eq(['jutsu', 2]))).toBe(0);
    expect(playerEvade(withShield, eq(['jutsu', 2]))).toBe(10 + 12);
  });

  it('掲盾(tateKakage)の遠隔回避加算も盾スロットが本物の盾のときだけ乗る', () => {
    const withWeapon = basePlayer({ shield: dagger });
    const withShield = basePlayer({ shield });
    expect(playerEvade(withWeapon, eq(['tateKakage', 1]), true)).toBe(0);
    expect(playerEvade(withShield, eq(['tateKakage', 1]), true)).toBe(10 + 20);
  });
});

describe('rogue-24 のノード補正(playerAtk / playerEvade。rogue-27でランク制)', () => {
  const base = (over: Partial<PlayerState> = {}): PlayerState => ({
    pos: [0, 0, 0],
    hp: 24,
    maxHp: 24,
    weapon: null,
    armor: null,
    shield: null,
    pack: [],
    relics: [],
    barrier: 0,
    status: null,
    immune: 0,
    ...over,
  });

  it('拳打: 素手のときだけ攻撃+3/+5/+7(ランク別)', () => {
    expect(playerAtk(base(), eq(['kenPunch', 1])) - playerAtk(base())).toBe(3);
    expect(playerAtk(base(), eq(['kenPunch', 2])) - playerAtk(base())).toBe(5);
    expect(playerAtk(base(), eq(['kenPunch', 3])) - playerAtk(base())).toBe(7);
    const armed = base({ weapon: { item: 'dagger', q: 0 } });
    expect(playerAtk(armed, eq(['kenPunch', 1]))).toBe(playerAtk(armed));
  });

  it('無傷の型: HP満タンのときだけ攻撃+2', () => {
    expect(playerAtk(base(), eq(['kenMuku', 1])) - playerAtk(base())).toBe(2);
    const hurt = base({ hp: 23 });
    expect(playerAtk(hurt, eq(['kenMuku', 1]))).toBe(playerAtk(hurt));
  });

  it('背水: HP25%以下かつ障壁0のとき攻撃+3・回避+25', () => {
    const low = base({ hp: 6 });
    expect(playerAtk(low, eq(['kenHaisui', 1])) - playerAtk(low)).toBe(3);
    expect(playerEvade(low, eq(['kenHaisui', 1])) - playerEvade(low)).toBe(25);
    const withBarrier = base({ hp: 6, barrier: 8 });
    expect(playerAtk(withBarrier, eq(['kenHaisui', 1]))).toBe(playerAtk(withBarrier));
    expect(playerEvade(withBarrier, eq(['kenHaisui', 1]))).toBe(playerEvade(withBarrier));
  });

  it('絞り撃ち: 「絞る」以下の明かりでのみ攻撃+2(消灯でも効く)', () => {
    expect(playerAtk(base(), eq(['hiShibori', 1]), 0) - playerAtk(base())).toBe(2);
    expect(playerAtk(base(), eq(['hiShibori', 1]), 3) - playerAtk(base())).toBe(2);
    expect(playerAtk(base(), eq(['hiShibori', 1]), 1)).toBe(playerAtk(base()));
    expect(playerAtk(base(), eq(['hiShibori', 1]), 2)).toBe(playerAtk(base()));
  });

  it('掲盾: 盾装備中の遠隔攻撃に対してのみ回避+20', () => {
    const shielded = base({ shield: { item: 'shield', q: 0 } });
    expect(playerEvade(shielded, eq(['tateKakage', 1]), true) - playerEvade(shielded)).toBe(20);
    expect(playerEvade(shielded, eq(['tateKakage', 1]), false)).toBe(playerEvade(shielded));
    expect(playerEvade(base(), eq(['tateKakage', 1]), true)).toBe(0); // 盾なしは対象外
  });

  it('結び「甲拳」(rogue-27 S2): 拳打×硬化の同時装着中、素手かつ障壁1以上で攻撃+2', () => {
    const knot = eq(['kenPunch', 1], ['kouka', 1]);
    const withBarrier = base({ barrier: 5 });
    const noBarrier = base({ barrier: 0 });
    const armed = base({ barrier: 5, weapon: { item: 'dagger', q: 0 } });
    // 拳打+3 に加えて甲拳+2。
    expect(playerAtk(withBarrier, knot) - playerAtk(withBarrier)).toBe(5);
    expect(playerAtk(noBarrier, knot) - playerAtk(noBarrier)).toBe(3); // 障壁0では発動しない
    expect(playerAtk(armed, knot)).toBe(playerAtk(armed, eq(['kouka', 1]))); // 武器持ちには効かない
    // 親が片方だけ(結び不成立)では素の拳打のみ。
    expect(playerAtk(withBarrier, eq(['kenPunch', 1])) - playerAtk(withBarrier)).toBe(3);
  });
});

describe('sightRadius(rogue-35: 心眼の視界+1)', () => {
  it('心眼なしは明かり段階の see そのまま', () => {
    for (const l of [0, 1, 2, 3] as const) {
      expect(sightRadius(l, [])).toBe(LIGHT[l].see);
    }
  });

  it('心眼装着中は「絞る」(0)・「消す」(3)で+1、普通・広げるでは変わらない', () => {
    const eq: [NodeId, number][] = [['shingan', 1]];
    expect(sightRadius(0, eq.map(([id, rank]) => ({ id, rank })))).toBe(LIGHT[0].see + 1);
    expect(sightRadius(3, eq.map(([id, rank]) => ({ id, rank })))).toBe(LIGHT[3].see + 1);
    expect(sightRadius(1, eq.map(([id, rank]) => ({ id, rank })))).toBe(LIGHT[1].see);
    expect(sightRadius(2, eq.map(([id, rank]) => ({ id, rank })))).toBe(LIGHT[2].see);
  });
});

describe('straightSteps(rogue-35: ずらし動詞の共通経路ヘルパ)', () => {
  it('通過可能セルが続く限り maxSteps 歩まで進む', () => {
    const dir = OFFSETS[0];
    const c1: Cell = [dir[0], dir[1], dir[2]];
    const c2: Cell = [dir[0] * 2, dir[1] * 2, dir[2] * 2];
    const dungeon = fakeDungeon([[0, 0, 0], c1, c2]);
    const path = straightSteps(dungeon, () => true, [0, 0, 0], dir, 2);
    expect(path).toEqual([c1, c2]);
  });

  it('遮られたら手前で止まる(0歩なら空配列)', () => {
    const dir = OFFSETS[0];
    const c1: Cell = [dir[0], dir[1], dir[2]];
    // c1 は open だが passable(occupied扱い)で拒否 → 0歩。
    const dungeon = fakeDungeon([[0, 0, 0], c1]);
    expect(straightSteps(dungeon, () => false, [0, 0, 0], dir, 2)).toEqual([]);
    // c2 が open でない(壁)場合は1歩で止まる。
    const dungeon2 = fakeDungeon([[0, 0, 0], c1]);
    expect(straightSteps(dungeon2, () => true, [0, 0, 0], dir, 2)).toEqual([c1]);
  });
});

describe('knockbackPath(rogue-35: 盾打ちのノックバック方向。決定論)', () => {
  it('攻撃者→対象の延長方向(同じオフセット)へ押す', () => {
    const dir = OFFSETS[0];
    const target: Cell = [dir[0], dir[1], dir[2]];
    const pushed: Cell = [dir[0] * 2, dir[1] * 2, dir[2] * 2];
    const dungeon = fakeDungeon([[0, 0, 0], target, pushed]);
    const path = knockbackPath(dungeon, () => true, [0, 0, 0], target, 1);
    expect(path).toEqual([pushed]);
  });

  it('全12方向で同じ規則が成り立つ(常に自分自身のオフセット方向へ延長)', () => {
    for (const dir of OFFSETS) {
      const target: Cell = [dir[0], dir[1], dir[2]];
      const pushed: Cell = [dir[0] * 2, dir[1] * 2, dir[2] * 2];
      const dungeon = fakeDungeon([[0, 0, 0], target, pushed]);
      const path = knockbackPath(dungeon, () => true, [0, 0, 0], target, 1);
      expect(path).toEqual([pushed]);
    }
  });

  it('押し先が塞がっていれば押せない(空配列)', () => {
    const dir = OFFSETS[0];
    const target: Cell = [dir[0], dir[1], dir[2]];
    const pushed: Cell = [dir[0] * 2, dir[1] * 2, dir[2] * 2];
    const dungeon = fakeDungeon([[0, 0, 0], target, pushed]);
    expect(knockbackPath(dungeon, () => false, [0, 0, 0], target, 1)).toEqual([]);
  });

  it('衝波(shouha)の2マス版: maxSteps=2 で2歩目まで押す', () => {
    const dir = OFFSETS[0];
    const target: Cell = [dir[0], dir[1], dir[2]];
    const p1: Cell = [dir[0] * 2, dir[1] * 2, dir[2] * 2];
    const p2: Cell = [dir[0] * 3, dir[1] * 3, dir[2] * 3];
    const dungeon = fakeDungeon([[0, 0, 0], target, p1, p2]);
    expect(knockbackPath(dungeon, () => true, [0, 0, 0], target, 2)).toEqual([p1, p2]);
  });

  it('決定論: 同じ入力なら常に同じ経路になる', () => {
    const dir = OFFSETS[3];
    const target: Cell = [dir[0], dir[1], dir[2]];
    const pushed: Cell = [dir[0] * 2, dir[1] * 2, dir[2] * 2];
    const dungeon = fakeDungeon([[0, 0, 0], target, pushed]);
    const a = knockbackPath(dungeon, () => true, [0, 0, 0], target, 1);
    const b = knockbackPath(dungeon, () => true, [0, 0, 0], target, 1);
    expect(a).toEqual(b);
  });
});

describe('dashCells(rogue-35: 突進の移動先候補)', () => {
  it('発見済み・空セルなら12方向×最大2歩を候補に含む', () => {
    const dir = OFFSETS[0];
    const c1: Cell = [dir[0], dir[1], dir[2]];
    const c2: Cell = [dir[0] * 2, dir[1] * 2, dir[2] * 2];
    const dungeon = fakeDungeon([[0, 0, 0], c1, c2]);
    const discovered = new Set([cellKey([0, 0, 0]), cellKey(c1), cellKey(c2)]);
    const cells = dashCells({
      player: { pos: [0, 0, 0] } as PlayerState,
      dungeon,
      discovered,
      beasts: [],
      traps: [],
      turrets: [],
      decoys: [],
    });
    expect(cells).toEqual(expect.arrayContaining([c1, c2]));
  });

  it('未発見セルは候補にならない', () => {
    const dir = OFFSETS[0];
    const c1: Cell = [dir[0], dir[1], dir[2]];
    const c2: Cell = [dir[0] * 2, dir[1] * 2, dir[2] * 2];
    const dungeon = fakeDungeon([[0, 0, 0], c1, c2]);
    const discovered = new Set([cellKey([0, 0, 0]), cellKey(c1)]); // c2 は未発見
    const cells = dashCells({
      player: { pos: [0, 0, 0] } as PlayerState,
      dungeon,
      discovered,
      beasts: [],
      traps: [],
      turrets: [],
      decoys: [],
    });
    expect(cells).toContainEqual(c1);
    expect(cells).not.toContainEqual(c2);
  });

  it('敵が居るセルは候補にならない(通過も終点もできない)', () => {
    const dir = OFFSETS[0];
    const c1: Cell = [dir[0], dir[1], dir[2]];
    const c2: Cell = [dir[0] * 2, dir[1] * 2, dir[2] * 2];
    const dungeon = fakeDungeon([[0, 0, 0], c1, c2]);
    const discovered = new Set([cellKey([0, 0, 0]), cellKey(c1), cellKey(c2)]);
    const cells = dashCells({
      player: { pos: [0, 0, 0] } as PlayerState,
      dungeon,
      discovered,
      beasts: [
        {
          id: 1,
          kind: 'bat',
          pos: c1,
          hp: 1,
          home: c1,
          homeChamber: 0,
          layerFloor: -999,
          layerCeil: 999,
          awake: true,
          alive: true,
          status: null,
          carry: null,
        },
      ],
      traps: [],
      turrets: [],
      decoys: [],
    });
    expect(cells).not.toContainEqual(c1);
    expect(cells).not.toContainEqual(c2); // c1 が塞がれているので c2 へも通過できない
  });
});
