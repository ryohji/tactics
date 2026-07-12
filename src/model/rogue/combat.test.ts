// 障壁の吸収(rogue-21)の単体テスト。上書き式の値そのものは store 側で検証する。
import { describe, it, expect } from 'vitest';
import { absorbBarrier } from './combat';

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
