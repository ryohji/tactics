// バランスシミュレータ(rogue-19a)のランナー。1シード・1方策を最後まで
// (または maxTurns まで)ヘッドレスに実行し、結果を要約する。Three/React 非依存。

import { useRogue, seedRogueRng } from '../state/rogue';
import * as masteryStore from '../state/masteryStore';
import { INITIAL_MASTERY } from '../model/rogue/mastery';
import type { Policy } from './policies';

export interface RunResult {
  seed: number;
  policy: string;
  /** escaped(rogue-25): ボットは脱出を選ばないため、実質 play/dead のみ観測される。 */
  phase: 'play' | 'dead' | 'escaped';
  turns: number;
  maxDepth: number;
  kills: number;
  deathCause: string | null;
  hp: number;
  lightLevel: number;
  discovered: number;
  chambers: number;
  /** 通過済みの層数(rogue-19b)。0 なら一度も崩落を踏んでいない。 */
  stratum: number;
  /** 所持品の種類別個数(装備中の武器・防具は含まない)。 */
  packSummary: Record<string, number>;
}

/** シード seed・方策 policyName(policy) を最大 maxTurns 手まで実行する。 */
export async function runOne(
  seed: number,
  policyName: string,
  policy: Policy,
  maxTurns = 1500,
): Promise<RunResult> {
  // マスタリー(kvStore 永続)は同一プロセス内で前のシードから持ち越されるため、
  // ラン開始前に必ず初期化する(rogue-32: 未覚醒への攻撃で育つようになり、
  // 放置すると2シード目以降の開始時に支度モーダルが開いてボットが詰まる)。
  masteryStore.writeMastery({ ...INITIAL_MASTERY });
  useRogue.getState().restart(seed);
  seedRogueRng(seed);
  let i = 0;
  while (useRogue.getState().phase === 'play' && i < maxTurns) {
    // ラン中の成長で支度・関門ドラフトが開いたら常に見送る(ボットはスキルを使わない)。
    const s0 = useRogue.getState();
    if (s0.skillOutfitting) s0.finishOutfitting();
    else if (s0.skillDraft !== null) s0.skipDraft();
    await policy(i);
    i++;
  }
  const s = useRogue.getState();
  const packSummary: Record<string, number> = {};
  for (const it of s.player.pack) {
    packSummary[it.item] = (packSummary[it.item] ?? 0) + 1;
  }
  return {
    seed,
    policy: policyName,
    phase: s.phase,
    turns: s.turn,
    maxDepth: s.maxDepth,
    kills: s.kills,
    deathCause: s.deathCause,
    hp: s.player.hp,
    lightLevel: s.lightLevel,
    discovered: s.discovered.size,
    chambers: s.dungeon.chambers.length,
    stratum: s.stratum,
    packSummary,
  };
}
