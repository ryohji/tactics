// 戦闘・罠発動・砲塔照準の純関数(rogue-17 で state/rogue.ts から分離)。
// 対象オブジェクト(Beast/Decoy/PlayerState)の hp・status 更新は呼び出し側
// (store)が行う。ここは「ダメージ量・発生イベント・照準対象」の計算だけを担い、
// ログ/効果音/エフェクトの実行(副作用)は返り値の GameEvent[] を store が
// 実行する(discoverInto と同じ「明示引数を受け取る純関数」の方針)。

import type { Cell } from '../fcc';
import { distW } from '../dungeon';
import { BEASTS } from '../beasts';
import type { Beast, BeastStatus, Decoy, GameEvent, PlayerState, PlayerStatus, Turret } from './types';
import { irnd, playerDef, playerEvade } from './rules';
import type { EquippedSkill } from './mastery';
import { ITEMS } from '../loot';

/** 毒(rogue-21)の持続ターン(命中時)。 */
const POISON_HIT_TURNS = 3;
/** 混乱(rogue-21)の持続ターン(命中時)。罠(幻惑)の混乱とは別枠の短さ。 */
const CONFUSE_HIT_TURNS = 2;

/** 攻撃力-防御力+乱数(-1..1)、最低1。敵→プレイヤー攻撃と近接攻撃が共有する基本式。 */
export function rollAtkDamage(atk: number, def: number, rng: () => number): number {
  return Math.max(1, atk - def + irnd(rng, -1, 1));
}

/**
 * 状態異常の付与(同種は長い方で上書き、別種は新しい方に置き換える。スロットはひとつ)。
 * incoming が null なら current のまま。
 */
function mergePlayerStatus(current: PlayerStatus | null, incoming: PlayerStatus | null): PlayerStatus | null {
  if (!incoming) return current;
  if (current && current.kind === incoming.kind) {
    return { kind: incoming.kind, turns: Math.max(current.turns, incoming.turns) };
  }
  return incoming;
}

const PLAYER_STATUS_TEXT: Record<PlayerStatus['kind'], { text: string; color: string; verb: string }> = {
  poison: { text: '🟣毒', color: '#a78bfa', verb: '毒を浴びた' },
  confuse: { text: '💫混乱', color: '#f472b6', verb: '混乱した' },
};

/**
 * 敵→プレイヤーの一撃。ダメージ量・発生イベント・(あれば)新しい状態異常を返す。
 * 障壁の吸収は呼び出し側(store)が absorbBarrier で行う — ここは生ダメージのみ。
 * 状態異常の抽選(毒/混乱)も rng を共有するのでここで行う(呼び出し順の再現性のため)。
 * player.immune が残っていれば新規の状態異常は付与しない(解毒の水薬の予防)。
 *
 * 回避判定(rogue-22): ダメージ計算の前に、盾の回避%だけ判定する。盾なし(evade=0)なら
 * 乱数を一切引かない(盾を装備していない既存ランの乱数列を守るため)。回避成功は
 * ダメージ0・状態異常抽選なしで即返す。skills(rogue-23)は jutsu(盾術)の回避+5%に効く
 * (省略時は素の回避% — 既存呼び出し元・テストへの後方互換)。硬化(kouka)の被ダメ軽減や
 * 受け反撃(盾術II・rogue-27)は store 側(state/rogue/combatActions.ts)がこの返り値を見て配線する。
 */
export function beastStrike(
  b: Beast,
  player: PlayerState,
  rng: () => number,
  skills: readonly EquippedSkill[] = [],
  ranged = false,
): { dmg: number; events: GameEvent[]; status: PlayerStatus | null } {
  const def = BEASTS[b.kind];
  // ranged(rogue-24): 遠隔攻撃なら掲盾(tateKakage)の回避が上乗せされる。
  const evade = playerEvade(player, skills, ranged);
  if (evade > 0 && rng() * 100 < evade) {
    // rogue-30(二刀流): 盾スロットに左手武器が入っている場合は「盾で受け流した」と言わない
    // (playerEvade も kind==='shield' のときだけ盾ボーナスを乗せるため、ログ文言も揃える)。
    const hasShield = player.shield !== null && ITEMS[player.shield.item].kind === 'shield';
    return {
      dmg: 0,
      events: [
        { kind: 'fx', fx: { kind: 'popup', at: player.pos, text: '回避!', color: '#93c5fd', dur: 900 } },
        { kind: 'sfx', name: 'cancel' },
        { kind: 'log', msg: `${def.name} の攻撃を${hasShield ? '盾で受け流した' : 'かわした'}!` },
      ],
      status: player.status,
    };
  }
  const dmg = rollAtkDamage(b.atkOverride ?? def.atk, playerDef(player), rng);
  const events: GameEvent[] = [
    { kind: 'fx', fx: { kind: 'hit', at: player.pos, dur: 320 } },
    { kind: 'fx', fx: { kind: 'popup', at: player.pos, text: `${dmg}`, color: '#fca5a5', dur: 900 } },
    { kind: 'sfx', name: 'hit' },
    { kind: 'log', msg: `${def.name} の攻撃! ${dmg}ダメージ` },
  ];
  let incoming: PlayerStatus | null = null;
  if (player.immune <= 0) {
    if (def.poisonChance && rng() < def.poisonChance) {
      incoming = { kind: 'poison', turns: POISON_HIT_TURNS };
    } else if (def.confuseChance && rng() < def.confuseChance) {
      incoming = { kind: 'confuse', turns: CONFUSE_HIT_TURNS };
    }
  }
  if (incoming) {
    const t = PLAYER_STATUS_TEXT[incoming.kind];
    events.push(
      { kind: 'fx', fx: { kind: 'popup', at: player.pos, text: t.text, color: t.color, dur: 900 } },
      { kind: 'log', msg: `${t.verb}!` },
    );
  }
  return { dmg, events, status: mergePlayerStatus(player.status, incoming) };
}

/**
 * 障壁のダメージ吸収(rogue-21)。酸(acid)は障壁への削りだけ2倍、HP直撃分は等倍
 * (障壁で防ぎきれた元ダメージ量は floor(barrier/cost) で計算)。
 */
export function absorbBarrier(
  barrier: number,
  dmg: number,
  acid: boolean,
): { barrier: number; hpDmg: number } {
  if (barrier <= 0) return { barrier: 0, hpDmg: dmg };
  const cost = acid ? 2 : 1;
  const needed = dmg * cost;
  if (barrier >= needed) return { barrier: barrier - needed, hpDmg: 0 };
  const blocked = Math.floor(barrier / cost);
  return { barrier: 0, hpDmg: dmg - blocked };
}

/** 敵→囮の一撃(防御力の減算なし)。 */
export function beastStrikeDecoy(
  b: Beast,
  d: Decoy,
  rng: () => number,
): { dmg: number; events: GameEvent[] } {
  const dmg = Math.max(1, BEASTS[b.kind].atk + irnd(rng, -1, 1));
  return {
    dmg,
    events: [
      { kind: 'fx', fx: { kind: 'popup', at: d.pos, text: `${dmg}`, color: '#d6c9a8', dur: 900 } },
      { kind: 'sfx', name: 'melee' },
    ],
  };
}

/** ダメージ演出イベント(ヒットフラッシュ+数字ポップ)。killed 判定は呼び出し側(hp==0)。 */
export function damageEvents(at: Cell, dmg: number, color: string): GameEvent[] {
  return [
    { kind: 'fx', fx: { kind: 'hit', at, dur: 320 } },
    { kind: 'fx', fx: { kind: 'popup', at, text: `${dmg}`, color, dur: 900 } },
  ];
}

/**
 * 罠が発動して敵が生存したときの状態異常通知(結び kakei/nemuriito・rogue-27)。
 * ダメージ量自体は trap.power(呼び出し側の state/rogue/combatActions.ts の fireTrap が
 * damageBeast へ渡す)なので、ここでは状態異常のログ/演出だけを担う。
 */
const TRAP_STATUS_TEXT: Record<BeastStatus['kind'], { text: string; color: string; verb: string }> = {
  burn: { text: '延焼', color: '#fdba74', verb: '延焼した' },
  confuse: { text: '混乱', color: '#f472b6', verb: '混乱した' },
  fear: { text: '恐慌', color: '#a78bfa', verb: '恐慌に陥った' },
  sleep: { text: '昏睡', color: '#60a5fa', verb: '昏睡した' },
};

/** 状態異常が新規に付与されたときの通知イベント(ダメージ演出とは別枠)。 */
export function statusAppliedEvents(name: string, at: Cell, status: BeastStatus): GameEvent[] {
  const t = TRAP_STATUS_TEXT[status.kind];
  return [
    { kind: 'fx', fx: { kind: 'popup', at, text: t.text, color: t.color, dur: 900 } },
    { kind: 'log', msg: `${name} は${t.verb}!` },
  ];
}

/** 砲塔の照準: 射程内で最も近い生存個体(いなければ undefined)。 */
export function turretTarget(t: Turret, beasts: readonly Beast[], range: number): Beast | undefined {
  return beasts
    .filter((b) => b.alive && distW(t.pos, b.pos) <= range)
    .sort((a, b) => distW(t.pos, a.pos) - distW(t.pos, b.pos))[0];
}
