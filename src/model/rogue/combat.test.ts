// 障壁の吸収(rogue-21)・回避判定(rogue-22)の単体テスト。上書き式の値そのものは store 側で検証する。
import { describe, it, expect } from 'vitest';
import { absorbBarrier, beastStrike } from './combat';
import type { Beast, PlayerState } from './types';

function bat(): Beast {
  return {
    id: 1,
    kind: 'bat',
    pos: [0, 0, 0],
    hp: 5,
    maxHp: 5,
    barrier: 0,
    home: [0, 0, 0],
    homeChamber: 0,
    layerFloor: -999,
    layerCeil: 999,
    awake: true,
    alive: true,
    status: null,
    carry: null,
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

describe('absorbBarrier(rogue-21)', () => {
  it('障壁がダメージを全部受け止めると HP へは通らない', () => {
    expect(absorbBarrier(8, 3, false)).toEqual({ barrier: 5, hpDmg: 0 });
  });

  it('障壁を超えたぶんだけ HP へ通る', () => {
    expect(absorbBarrier(2, 5, false)).toEqual({ barrier: 0, hpDmg: 3 });
  });

  it('障壁ゼロなら素通し', () => {
    expect(absorbBarrier(0, 4, false)).toEqual({ barrier: 0, hpDmg: 4 });
  });

  it('酸は障壁への削りだけ2倍(受け止めきれば HP は無傷)', () => {
    expect(absorbBarrier(8, 3, true)).toEqual({ barrier: 2, hpDmg: 0 });
  });

  it('酸で障壁が足りないとき、防げた元ダメージは floor(barrier/2)', () => {
    // 障壁5・ダメージ4(必要10): 防げるのは floor(5/2)=2 → HP へ 2。
    expect(absorbBarrier(5, 4, true)).toEqual({ barrier: 0, hpDmg: 2 });
  });
});

describe('beastStrike の回避判定(rogue-22)', () => {
  it('盾なしは回避判定の乱数を引かない(盾ありより rng() 呼び出しが1回少ない)', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.99; // 回避%(最大でも数十%)には掛からない値
    };
    beastStrike(bat(), basePlayer(), rng);
    const withoutShield = calls;

    calls = 0;
    beastStrike(bat(), basePlayer({ shield: { item: 'shield', q: 0 } }), rng);
    const withShield = calls;

    expect(withoutShield).toBe(1); // ダメージの irnd(-1,1) のみ
    expect(withShield).toBe(withoutShield + 1); // 先頭の回避判定ぶん+1
  });

  it('回避判定に成功すると、ダメージ0・状態異常なしで「盾で受け流した」ログが出る', () => {
    const rng = () => 0; // 0*100=0 < evade(10) で必ず回避成功
    const player = basePlayer({ shield: { item: 'shield', q: 0 } });
    const { dmg, events, status } = beastStrike(bat(), player, rng);
    expect(dmg).toBe(0);
    expect(status).toBeNull();
    expect(events.some((e) => e.kind === 'log' && e.msg.includes('受け流した'))).toBe(true);
  });

  it('回避判定に失敗すると通常どおりダメージが出る', () => {
    const rng = () => 0.99; // 回避率10%には掛からない → 通常ダメージ計算へ
    const player = basePlayer({ shield: { item: 'shield', q: 0 } });
    const { dmg } = beastStrike(bat(), player, rng);
    expect(dmg).toBeGreaterThan(0);
  });

  it('jutsu(盾術・rogue-23)を渡すと回避%が底上げされる(盾10%+5%=15%の境目で判定が変わる)', () => {
    // rng*100=12 は素の盾10%には掛からず失敗するが、jutsu込みの15%には掛かって回避成功する。
    const rng = () => 0.12;
    const player = basePlayer({ shield: { item: 'shield', q: 0 } });
    const withoutJutsu = beastStrike(bat(), player, rng);
    expect(withoutJutsu.dmg).toBeGreaterThan(0);
    const withJutsu = beastStrike(bat(), player, rng, [{ id: 'jutsu', rank: 1 }]);
    expect(withJutsu.dmg).toBe(0);
  });

  it('二刀流(rogue-30): 盾スロットに武器が入っていても盾ボーナスは乗らない(kind ガード)', () => {
    // 盾10%+jutsuII12%=22%なら rng*100=12 でヒットするはずの値だが、盾スロットの中身が
    // 武器(kind==='weapon')なら playerEvade は0を返すので回避判定の乱数自体を引かない。
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.12;
    };
    const player = basePlayer({ shield: { item: 'dagger', q: 0 } });
    const { dmg } = beastStrike(bat(), player, rng, [{ id: 'jutsu', rank: 2 }]);
    expect(dmg).toBeGreaterThan(0); // 回避が発生しない
    expect(calls).toBe(1); // ダメージの irnd(-1,1) のみ(盾なし相当・回避判定の乱数を引かない)
  });

  it('二刀流(rogue-30): 盾スロットの武器では回避成功時のログが「盾で受け流した」にならない', () => {
    // kenHaisui(背水・素手回避)で盾を使わずに回避を成立させ、ログ文言が「かわした」側になることを見る。
    const rng = () => 0; // 必ず回避成功
    const player = basePlayer({ shield: { item: 'dagger', q: 0 }, weapon: null, hp: 1, barrier: 0 });
    const { dmg, events } = beastStrike(bat(), player, rng, [{ id: 'kenHaisui', rank: 1 }]);
    expect(dmg).toBe(0);
    expect(events.some((e) => e.kind === 'log' && e.msg.includes('かわした'))).toBe(true);
    expect(events.some((e) => e.kind === 'log' && e.msg.includes('盾で受け流した'))).toBe(false);
  });
});
