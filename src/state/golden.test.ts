// ゴールデンテスト(rogue-17 Phase 0)。固定シード+固定操作列を再生し、
// 最終状態の要約をスナップショットへ固定する。設計整理(リファクタリング)で
// 挙動 — 特に**乱数の呼び出し順** — が変わっていないことの回帰検知が目的。
// 意図した挙動変更で割れたときだけ `vitest -u` で更新し、コミットに明記する。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cellKey, layer } from '../model/fcc';
import { distW, stepDist } from '../model/dungeon';
import { useRogue, seedRogueRng } from './rogue';
import * as masteryStore from './masteryStore';
import { INITIAL_MASTERY } from '../model/rogue/mastery';

async function run(ms = 3000) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  // 同一ワーカーの永続層(kvStore のインメモリフォールバック)を他テストと共有
  // しうるため、マスタリーを必ず初期値へ戻す。rogue-32 で「未覚醒への攻撃」でも
  // マスタリーが育つようになり、汚染があるとボットの初回ランに支度モーダルが
  // 開いて固定方針が詰まる(全体実行時のみ落ちる flake の根)。
  masteryStore.writeMastery({ ...INITIAL_MASTERY });
});

/** 隣接して生きている敵のうち最小 id(いなければ null)。 */
function pickTarget(): number | null {
  const s = useRogue.getState();
  const c = s.beasts
    .filter((b) => b.alive && stepDist(s.player.pos, b.pos) <= 1)
    .sort((a, b) => a.id - b.id);
  return c[0]?.id ?? null;
}

/**
 * 固定方針(下手だが決定的):
 * 1. 隣接する敵がいれば最小 id を殴る
 * 2. HP が半分未満で水薬があれば飲む
 * 3. こちらに気づいた敵がいれば待って迎え撃つ
 * 4. それ以外は最小 id の未踏スタブへ自動歩行(拡張・湧き・発見を回す)
 * 戦闘・回復・自動歩行・広間拡張・深層降下をひととおり通すのが目的
 * (罠アイテムは rogue-27 でスキル化され、素のボットは罠を使わない)。
 */
async function playTurn(_i: number): Promise<void> {
  const s = useRogue.getState();
  const target = pickTarget();
  if (target !== null) {
    s.clickBeast(target);
    return run(3000);
  }
  const potion = s.player.pack.findIndex((it) => it.item === 'potion');
  if (s.player.hp < s.player.maxHp / 2 && potion >= 0) {
    s.useItem(potion);
    return run(1000);
  }
  if (s.beasts.some((b) => b.alive && b.awake && stepDist(s.player.pos, b.pos) <= 6)) {
    s.wait(); // 近づく敵を迎え撃つ
    return run(3000);
  }
  // 最小 id の未踏スタブへ「最も近づく」reach セルを選んで進む。
  // 経路も発見も明かり任せなので、これで通路が照らされ拡張・湧きが回る。
  const stub = s.dungeon.stubs
    .filter((st) => !st.used)
    .sort((a, b) => layer(a.exit) - layer(b.exit) || a.id - b.id)[0]; // 深い出口を優先
  const goal = stub ? stub.exit : s.player.pos;
  const cells = [...s.reach.cells].sort(
    (a, b) => distW(a, goal) - distW(b, goal) || cellKey(a).localeCompare(cellKey(b)),
  );
  if (cells[0]) {
    s.clickCell(cells[0]);
    return run(3000);
  }
  s.wait();
  return run(3000);
}

describe('ゴールデン(挙動保持の回帰検知)', () => {
  it('シード12345・固定方針120手の最終状態が変わらない', async () => {
    useRogue.getState().restart(12345);
    seedRogueRng(999);
    for (let i = 0; i < 120; i++) {
      if (useRogue.getState().phase !== 'play') break;
      await playTurn(i);
    }
    const s = useRogue.getState();
    expect({
      phase: s.phase,
      turn: s.turn,
      pos: s.player.pos,
      hp: s.player.hp,
      maxHp: s.player.maxHp,
      weapon: s.player.weapon,
      armor: s.player.armor,
      pack: s.player.pack,
      kills: s.kills,
      maxDepth: s.maxDepth,
      lightLevel: s.lightLevel,
      beastsAlive: s.beasts.filter((b) => b.alive).length,
      beastSample: s.beasts.slice(0, 4).map((b) => ({ ...b })),
      groundItems: s.items.length,
      discovered: s.discovered.size,
      open: s.dungeon.open.size,
      chambers: s.dungeon.chambers.length,
      stubs: s.dungeon.stubs.length,
      visited: [...s.visitedChambers].sort((a, b) => a - b),
      deathCause: s.deathCause,
    }).toMatchSnapshot();
  });
});
