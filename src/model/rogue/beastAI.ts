// 敵1体の意思決定(rogue-17 で state/rogue.ts beastsTurn から分離)。
// すべて純関数(乱数を使う分岐 — confuse の移動先抽選 — は呼び出し側が rng を渡す)。
// 実際の状態変更(b.pos の代入・triggerTrap の発動・damageBeast 連鎖)は
// store 側が担う(killBeast が討伐数・ロット・掃討判定まで広く扱うため)。

import { OFFSETS, cellKey, layer, type Cell, type CellKey } from '../fcc';
import { distW, type Dungeon } from '../dungeon';
import type { BeastDef } from '../beasts';
import { LIGHT, type Beast, type Decoy, type LightLevel } from './types';

/** b の移動先候補(空洞・他の敵/プレイヤー/囮が居ない)。 */
export function stepCandidates(
  dungeon: Dungeon,
  b: Beast,
  otherBeasts: readonly Beast[],
  playerPos: Cell,
  decoys: readonly Decoy[],
): Cell[] {
  const occupied = new Set<CellKey>(
    otherBeasts.filter((x) => x.alive && x.id !== b.id).map((x) => cellKey(x.pos)),
  );
  occupied.add(cellKey(playerPos));
  for (const d of decoys) occupied.add(cellKey(d.pos));
  const out: Cell[] = [];
  for (const o of OFFSETS) {
    const n: Cell = [b.pos[0] + o[0], b.pos[1] + o[1], b.pos[2] + o[2]];
    if (dungeon.open.has(cellKey(n)) && !occupied.has(cellKey(n))) out.push(n);
  }
  return out;
}

/**
 * 気づき判定: 明かりを広げているほど遠くから気づかれる。
 * aggroFactor は隠密スキル(忍び足=0.8)などの距離係数(rogue-24)。
 */
export function checkAggro(
  b: Beast,
  def: BeastDef,
  playerPos: Cell,
  lightLevel: LightLevel,
  aggroFactor = 1,
): boolean {
  const dW = distW(b.pos, playerPos);
  const dL = Math.abs(layer(b.pos) - layer(playerPos));
  return dW <= def.aggroR * LIGHT[lightLevel].aggro * aggroFactor && dL <= def.vAggro;
}

/** ターゲット: プレイヤーと囮のうち最も近いもの。 */
export function chooseTarget(
  b: Beast,
  playerPos: Cell,
  decoys: readonly Decoy[],
): { pos: Cell; decoy: Decoy | null } {
  let tgtPos = playerPos;
  let tgtDecoy: Decoy | null = null;
  for (const d of decoys) {
    if (distW(b.pos, d.pos) < distW(b.pos, tgtPos)) {
      tgtPos = d.pos;
      tgtDecoy = d;
    }
  }
  return { pos: tgtPos, decoy: tgtDecoy };
}

/** 恐慌: ターゲットから最も遠ざかる候補(なければ null)。 */
export function chooseFleeStep(b: Beast, candidates: readonly Cell[], awayFrom: Cell): Cell | null {
  let best: Cell | null = null;
  let bd = distW(b.pos, awayFrom);
  for (const n of candidates) {
    const d = distW(n, awayFrom);
    if (d > bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

/**
 * 縄張りから離れすぎたか(ターゲット基準。追跡を諦める条件)。
 * territoryFactor は隠密スキル(気配遮断=0.75)などの距離係数(rogue-24)。
 */
export function outOfTerritory(b: Beast, def: BeastDef, target: Cell, territoryFactor = 1): boolean {
  return distW(b.pos, target) > (def.territoryR + def.aggroR) * territoryFactor;
}

/** 追跡: 縄張り・階層制限内でターゲットへ最も近づく候補(なければ null)。 */
export function chooseChaseStep(
  b: Beast,
  def: BeastDef,
  candidates: readonly Cell[],
  target: Cell,
): Cell | null {
  let best: Cell | null = null;
  let bd = distW(b.pos, target);
  for (const n of candidates) {
    const nl = layer(n);
    if (nl < b.layerFloor || nl > b.layerCeil) continue;
    if (distW(n, b.home) > def.territoryR) continue;
    const d = distW(n, target);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}
