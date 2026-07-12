// 敵ロスター(rogue-21)の湧きテーブルのテスト。
import { describe, it, expect } from 'vitest';
import { lcg } from './dungeon';
import { BEASTS, spawnTable, ratPackSize, gatekeeperFor, depthScale, type BeastKind } from './beasts';

describe('spawnTable(rogue-21)', () => {
  it('minDepth は出現帯の設計どおり昇順', () => {
    const order: BeastKind[] = [
      'bat', 'rat', 'spider', 'ghoul', 'snake', 'soldier',
      'wisp', 'slime', 'mushnub', 'shade', 'drake', 'colossus',
    ];
    for (let i = 1; i < order.length; i++) {
      expect(BEASTS[order[i]].minDepth).toBeGreaterThanOrEqual(BEASTS[order[i - 1]].minDepth);
    }
  });

  it('プールは直近解禁の4種(深度12なら soldier/wisp/slime/mushnub)', () => {
    const kinds = new Set<BeastKind>();
    const rng = lcg(1);
    for (let i = 0; i < 300; i++) for (const k of spawnTable(12, rng)) kinds.add(k);
    expect([...kinds].sort()).toEqual(['mushnub', 'slime', 'soldier', 'wisp']);
  });

  it('ネズミは群れで湧く(深度で 2/3/4 体)', () => {
    expect(ratPackSize(2)).toBe(2);
    expect(ratPackSize(8)).toBe(3);
    expect(ratPackSize(16)).toBe(4);
    // 深度3(rat 解禁帯)で rat が出たら、必ず 2 匹連続で並ぶ。
    const rng = lcg(7);
    for (let i = 0; i < 100; i++) {
      const t = spawnTable(3, rng);
      const rats = t.filter((k) => k === 'rat').length;
      expect(rats % 2).toBe(0); // 1抽選=2匹なので偶数
    }
  });

  it('浅すぎる深度では新性質の敵が出ない(対抗手段が先の原則)', () => {
    const rng = lcg(3);
    for (let i = 0; i < 100; i++) {
      for (const k of spawnTable(5, rng)) {
        expect(BEASTS[k].poisonChance ?? 0).toBe(0); // 毒ヘビは深度7〜
        expect(BEASTS[k].acidBarrier ?? false).toBe(false);
      }
    }
  });
});

describe('rogue-24: 門番と深度係数', () => {
  it('門番は層番号でバイオーム巡回し、ステータスが層でスケールする', () => {
    expect(gatekeeperFor(1).kind).toBe('kingMush');
    expect(gatekeeperFor(2).kind).toBe('giant');
    expect(gatekeeperFor(3).kind).toBe('yeti');
    expect(gatekeeperFor(4).kind).toBe('kingMush');
    expect(gatekeeperFor(2).hp).toBeGreaterThan(gatekeeperFor(1).hp);
    expect(gatekeeperFor(3).atk).toBeGreaterThan(gatekeeperFor(1).atk);
  });

  it('門番は spawnTable のプールに現れない', () => {
    const rng = lcg(9);
    for (let i = 0; i < 200; i++) {
      for (const k of spawnTable(30, rng)) {
        expect(BEASTS[k].gatekeeper ?? false).toBe(false);
      }
    }
  });

  it('深度係数は24以下で1、以深で単調増加', () => {
    expect(depthScale(8)).toBe(1);
    expect(depthScale(24)).toBe(1);
    expect(depthScale(32)).toBeCloseTo(1.15);
    expect(depthScale(40)).toBeGreaterThan(depthScale(32));
  });
});
