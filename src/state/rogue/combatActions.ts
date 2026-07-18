// 戦闘オーケストレーション(rogue.ts 分割A3)。プレイヤーの近接/投擲攻撃・敵の1ターン・
// 罠・砲塔・討伐処理をまとめて切り出す。A2(skills.ts)と同じく zustand ストアは1つの
// まま(state/rogue.ts の useRogue)。ここは共有コンテキスト(set/get・pushLog/pushFx・
// applyEvents・checkDead・endTurn・settleAfterAction・sleep・sfx/triggerPose/animateUnit・
// rand・runSeq/itemSeq のアクセサ・skills の一部)を受け取るファクトリとして切り出す。
// 関数本文は rogue.ts に直書きされていた頃と1文字も変えていない — 参照だけ
// deps/戻り値経由に置き換えてある。
//
// killBeast は skills.incrementMastery/maybeUnlockFeat を呼ぶため、rogue.ts は
// createSkills を先に作ってその戻り値(の一部)を渡す。逆に recoverTrap(skills.ts)は
// beastsTurn を呼ぶため、rogue.ts 側では「後から束縛」(let combat + サンク)で
// この循環を解いている。

import type { StoreApi } from 'zustand';
import type { RogueState } from '../rogue';
import * as codexStore from '../codexStore';
import type { SfxName } from '../../audio/sfx';
import type { PlayerPose } from '../playerPose';
import { cellKey, type Cell } from '../../model/fcc';
import { adjacent, distW, stepDist, lineOfSight } from '../../model/dungeon';
import { BEASTS } from '../../model/beasts';
import { ITEMS, stackDmg, stackCount, stackAtk, itemLabel } from '../../model/loot';
import type { Beast, BeastStatus, Decoy, PlacedTrap, Turret, RogueFx, GameEvent } from '../../model/rogue/types';
import { BURN_DMG, depthOf, playerAtk, weaponReach, weaponSweep } from '../../model/rogue/rules';
import { knotActive, rankOf, cdOf, type MasteryCounters } from '../../model/rogue/mastery';
import type { FeatId } from '../../model/rogue/feats';
import {
  beastStrike as beastStrikeCalc,
  beastStrikeDecoy as beastStrikeDecoyCalc,
  damageEvents,
  statusAppliedEvents,
  turretTarget,
  absorbBarrier,
} from '../../model/rogue/combat';
import {
  stepCandidates as stepCandidatesPure,
  checkAggro,
  chooseTarget,
  chooseFleeStep,
  outOfTerritory,
  chooseChaseStep,
} from '../../model/rogue/beastAI';

/**
 * 討伐コンテキスト(rogue-24)。マスタリー加算の判定材料。
 * preAwake は「攻撃を仕掛ける直前の覚醒状態」— 近接/投擲は攻撃時に敵を起こすため、
 * 呼び出し元が事前に捕捉して渡す(背討ちの倍率判定も同じ値を使う)。
 */
interface KillCtx {
  unarmed?: boolean;
  preAwake?: boolean;
  viaTrap?: boolean;
  weapon?: boolean;
}

export interface CombatDeps {
  set: StoreApi<RogueState>['setState'];
  get: StoreApi<RogueState>['getState'];
  pushLog(msg: string): void;
  pushFx(e: Omit<RogueFx, 'id' | 'start'>): void;
  /** model/rogue/combat.ts など純関数が返す GameEvent[] をまとめて実行する(rogue.ts 側)。 */
  applyEvents(events: readonly GameEvent[]): void;
  /** HP0 なら死亡処理へ(rogue.ts 側)。true で死亡。 */
  checkDead(): boolean;
  /** ターン経過の帳尻(rogue.ts 側。A5 で移設予定)。 */
  endTurn(): void;
  /** 1ターン分のアクション末尾で busy/reach を締めくくる共通処理
      (state/rogue/moveActions.ts の createMove が返す。A4 で移設済み)。 */
  settleAfterAction(): void;
  /** 演出待ち(timeScale 込み。rogue.ts 側)。 */
  sleep(ms: number): Promise<void>;
  sfx: { play(name: SfxName): void };
  triggerPose(name: PlayerPose, ms: number): void;
  animateUnit(id: number, path: Cell[]): number;
  rand(): number;
  /** リスタート世代(rogue.ts のモジュール変数 runSeq)。await を跨ぐ処理の打ち切り判定に使う。 */
  getRunSeq(): number;
  /** 地上アイテムの id 採番(rogue.ts のモジュール変数 itemSeq)。 */
  nextItemSeq(): number;
  /** マスタリー・実績(state/rogue/skills.ts の createSkills が返す一部)。 */
  skills: {
    incrementMastery(delta: Partial<MasteryCounters>): void;
    maybeUnlockFeat(id: FeatId): void;
  };
}

export function createCombat(deps: CombatDeps) {
  const {
    set,
    get,
    pushLog,
    pushFx,
    applyEvents,
    checkDead,
    endTurn,
    settleAfterAction,
    sleep,
    sfx,
    triggerPose,
    animateUnit,
    rand,
    getRunSeq,
    nextItemSeq,
    skills,
  } = deps;

  /** a..b の整数(両端含む)。 */
  function irnd(a: number, b: number): number {
    return a + Math.floor(rand() * (b - a + 1));
  }

  /** 敵→プレイヤーの一撃(ranged=true は遠隔攻撃。掲盾の回避対象)。 */
  function beastStrike(b: Beast, ranged = false): void {
    const { player, skillEquipped } = get();
    const def = BEASTS[b.kind];
    const { dmg: rawDmg, events, status } = beastStrikeCalc(b, player, rand, skillEquipped, ranged);
    if (rawDmg === 0) {
      // 盾の回避成功(rogue-22)。マスタリー(盾=回避)を積む(rogue-23)。
      skills.incrementMastery({ evades: 1 });
      applyEvents(events);
      // 受け反撃(盾術IIランク以上・rogue-27)/ 見切り(身軽IIランク以上・素手時): 固定値の反撃。
      // jutsu>=2 と kenMigaru>=2 は EXCLUDES で同時装着できないため、同時成立はしない。
      // 隣接の攻撃者のみに反撃する(rogue-27の意図的差分: 遠隔への反撃は結び「矢返し」の役割)。
      // 矢返し(yagaeshi・rogue-27): jutsu 系の受け反撃に限り、遠隔攻撃なら非隣接の射手にも届く。
      // rogue-30(二刀流): 盾スロットには左手武器も入りうる — 盾術の受け反撃は本物の盾
      // (kind==='shield')を構えているときだけ(kenMigaru の見切りは素手条件のみで盾不要)。
      const hasShield = player.shield !== null && ITEMS[player.shield.item].kind === 'shield';
      const jutsuRank = rankOf(skillEquipped, 'jutsu');
      const kenMigaruRank = rankOf(skillEquipped, 'kenMigaru');
      const adjacentAttacker = stepDist(b.pos, player.pos) === 1;
      const jutsuCounter = jutsuRank >= 2 && hasShield;
      const yagaeshiReach = ranged && jutsuCounter && knotActive(skillEquipped, 'yagaeshi');
      const counterActive =
        (jutsuCounter || (kenMigaruRank >= 2 && player.weapon === null)) && (adjacentAttacker || yagaeshiReach);
      if (counterActive) {
        const activeRank = jutsuCounter ? jutsuRank : kenMigaruRank;
        const atk = playerAtk(player, skillEquipped, get().lightLevel);
        const counter = activeRank >= 3 ? Math.floor((atk * 3) / 4) : Math.floor(atk / 2);
        if (counter > 0) {
          pushLog(adjacentAttacker ? '受け流しざま反撃した!' : '矢を弾き、射手へ打ち返した!');
          damageBeast(b, counter, '#93c5fd'); // 武技(討伐)マスタリーの対象外(近接/薙ぎ/投擲のみ)
          set({ beasts: [...get().beasts] });
        }
      }
      // 錬鉄の受け(rentetsu・rogue-27): 回避成功時、障壁+1(上限24)。
      if (knotActive(skillEquipped, 'rentetsu')) {
        player.barrier = Math.min(24, player.barrier + 1);
      }
      set({ player: { ...player } });
      checkDead();
      return;
    }
    // 硬化(kouka・rogue-23): 障壁が1以上ある間、被ダメージ−(ランク2以上で2、それ以外1。
    // 最低1。absorbBarrier前。rogue-27でランク制へ)。
    let dmg = rawDmg;
    const koukaRank = rankOf(skillEquipped, 'kouka');
    if (player.barrier > 0 && koukaRank >= 2) dmg = Math.max(1, dmg - 2);
    else if (player.barrier > 0 && koukaRank >= 1) dmg = Math.max(1, dmg - 1);
    // 障壁がまず削れ、余りが HP へ(酸は障壁への削りだけ2倍)。
    const hadBarrierAmt = player.barrier;
    const { barrier, hpDmg } = absorbBarrier(hadBarrierAmt, dmg, !!def.acidBarrier);
    if (hadBarrierAmt - barrier > 0) skills.incrementMastery({ absorbed: hadBarrierAmt - barrier }); // 甲殻マスタリー
    player.barrier = barrier;
    player.status = status;
    player.hp = Math.max(0, player.hp - hpDmg);
    applyEvents(events);
    if (hadBarrierAmt > 0 && barrier === 0) {
      pushLog('障壁が砕けた!');
      pushFx({ kind: 'popup', at: player.pos, text: '障壁破壊', color: '#67d3e0', dur: 900 });
    }
    set({ player: { ...player } });
    if (player.hp <= 0) set({ deathCause: def.name }); // checkDead が使う死因
    checkDead();
  }

  /** 敵→囮の一撃。壊れたら除去。 */
  function hitDecoy(b: Beast, d: Decoy): void {
    const { dmg, events } = beastStrikeDecoyCalc(b, d, rand);
    d.hp -= dmg;
    applyEvents(events);
    if (d.hp <= 0) {
      pushFx({ kind: 'death', at: d.pos, dur: 600 });
      pushLog('囮人形が壊れた');
      set({ decoys: get().decoys.filter((x) => x.id !== d.id) });
    } else {
      set({ decoys: [...get().decoys] });
    }
  }

  /** ダメージ適用(死亡処理込み)。生存していれば false。 */
  function damageBeast(b: Beast, dmg: number, color = '#fecaca', kill?: KillCtx): boolean {
    b.hp = Math.max(0, b.hp - dmg);
    applyEvents(damageEvents(b.pos, dmg, color));
    if (b.hp === 0) {
      killBeast(b, kill);
      return true;
    }
    return false;
  }

  /**
   * 罠1つを b に対して発動する(rogue-27: 罠のスキル化。ダメージは trap.power 固定・
   * kind 分岐は廃止)。生存すれば結び kakei(延焼2T)・nemuriito(昏睡2T)を付与する
   * (両方成立時は後段の nemuriito が上書きする — 敵の状態異常は単一スロットのため。
   * 詳細は完了記録の「仕様からの逸脱」参照)。
   */
  function fireTrap(t: PlacedTrap, b: Beast): void {
    const name = BEASTS[b.kind].name;
    sfx.play('hit');
    pushLog(`${name} が罠を踏んだ!`);
    const died = damageBeast(b, t.power, '#fecaca', { viaTrap: true });
    if (!died) {
      const eq = get().skillEquipped;
      let status: BeastStatus | null = null;
      if (knotActive(eq, 'kakei')) status = { kind: 'burn', turns: 2 };
      if (knotActive(eq, 'nemuriito')) status = { kind: 'sleep', turns: 2 };
      if (status) {
        b.status = status;
        applyEvents(statusAppliedEvents(name, b.pos, status));
      }
    }
  }

  /** 連鎖対象(罠編みランクIII・rogue-27): t に隣接する自分の罠(1ホップ限定)。 */
  function chainedTrapsFor(t: PlacedTrap): PlacedTrap[] {
    const { traps, skillEquipped } = get();
    return rankOf(skillEquipped, 'wanaAmi') >= 3
      ? traps.filter((x) => x.id !== t.id && adjacent(x.pos, t.pos))
      : [];
  }

  /** 連鎖誘爆の適用: 誘爆先のセルに敵が居れば発動、居なければ空振りログのみ。 */
  function detonateChain(chained: readonly PlacedTrap[]): void {
    for (const c of chained) {
      const victim = get().beasts.find((x) => x.alive && cellKey(x.pos) === cellKey(c.pos));
      pushFx({ kind: 'hit', at: c.pos, dur: 320 });
      if (victim) {
        pushLog('罠が誘爆した!');
        fireTrap(c, victim);
      } else {
        pushLog('罠が誘爆した(空振り)');
      }
    }
  }

  /** b が今のセルの罠を踏んだら発動(罠は消費)。連鎖(罠編みランクIII)は隣接罠を1ホップ誘爆。 */
  function triggerTrap(b: Beast): void {
    const { traps } = get();
    const k = cellKey(b.pos);
    const t = traps.find((x) => cellKey(x.pos) === k);
    if (!t) return;
    const chained = chainedTrapsFor(t);
    set({ traps: traps.filter((x) => x.id !== t.id && !chained.some((c) => c.id === x.id)) });
    fireTrap(t, b);
    detonateChain(chained);
  }

  /**
   * 遠隔起爆(罠編みランクIII・rogue-27): プレイヤーが自分の罠をクリックして即時発動する。
   * 乱数は一切引かない。そのセルに敵が居れば発動、居なければ空発動(連鎖は起きる)。
   * id が見つからなければ false(呼び出し元はターンを消費しない)。
   */
  function detonateTrap(id: number): boolean {
    const { traps, beasts } = get();
    const t = traps.find((x) => x.id === id);
    if (!t) return false;
    const chained = chainedTrapsFor(t);
    set({ traps: traps.filter((x) => x.id !== t.id && !chained.some((c) => c.id === x.id)) });
    const victim = beasts.find((x) => x.alive && cellKey(x.pos) === cellKey(t.pos));
    if (victim) {
      pushLog('罠を起爆した!');
      fireTrap(t, victim);
    } else {
      pushLog('罠を起爆した(空振り)');
    }
    detonateChain(chained);
    return true;
  }

  /** b の移動先候補(空洞・他の敵/プレイヤー/囮が居ない)。 */
  function stepCandidates(b: Beast): Cell[] {
    const s = get();
    return stepCandidatesPure(s.dungeon, b, s.beasts, s.player.pos, s.decoys);
  }

  function moveBeast(b: Beast, to: Cell): void {
    animateUnit(b.id, [b.pos, to]);
    b.pos = to;
    triggerTrap(b);
  }

  /** 砲塔の斉射(敵ターンの最後)。 */
  function turretsFire(): void {
    const s = get();
    if (s.turrets.length === 0) return;
    const range = ITEMS.turret.range ?? 8;
    const remaining: Turret[] = [];
    for (const t of s.turrets) {
      const target = turretTarget(t, s.beasts, range);
      if (target) {
        pushFx({ kind: 'bolt', from: t.pos, to: target.pos, dur: 240 });
        sfx.play('magic');
        target.awake = true;
        pushLog(`魔導砲塔が ${BEASTS[target.kind].name} を撃った`);
        damageBeast(target, stackDmg({ item: 'turret', q: t.q }));
      }
      t.turns -= 1;
      if (t.turns > 0) remaining.push(t);
      else pushLog('魔導砲塔が沈黙した');
    }
    set({ turrets: remaining, beasts: [...get().beasts] });
  }

  /**
   * 敵の1ターン。状態異常 → 気づき判定 → 追跡/攻撃(ターゲットはプレイヤーと囮の近い方)。
   * 最後に砲塔の斉射。「新たに気づかれた」or「攻撃を受けた」なら true(自動歩行の中断)。
   */
  function beastsTurn(): boolean {
    let interrupted = false;
    const { beasts, discovered } = get();
    for (const b of beasts) {
      if (!b.alive) continue;
      if (get().phase !== 'play') break;
      const { player, lightLevel } = get();
      const def = BEASTS[b.kind];

      // --- 状態異常 ---
      if (b.status) {
        const st = b.status;
        if (st.kind === 'burn') {
          pushLog(`${def.name} は延焼している`);
          if (damageBeast(b, BURN_DMG, '#fdba74')) continue;
        }
        st.turns -= 1;
        if (st.turns <= 0) b.status = null;
        if (st.kind === 'sleep') continue; // 行動不能
        if (st.kind === 'confuse') {
          // 不動種(胞子茸)は混乱してもふらつかない(rogue-21)。
          const cands = def.stationary ? [] : stepCandidates(b);
          if (cands.length > 0) moveBeast(b, cands[irnd(0, cands.length - 1)]);
          continue; // ふらつくだけ
        }
        if (st.kind === 'fear') {
          // 恐慌: 縄張り・階層を忘れてプレイヤーから遠ざかる(不動種は動けない)。
          const best = def.stationary ? null : chooseFleeStep(b, stepCandidates(b), player.pos);
          if (best) moveBeast(b, best);
          continue;
        }
        // burn は通常行動へ続く
      }

      // 気づき: 明かりを広げているほど遠くから気づかれる。
      // 忍び足(shinShinobi・rogue-27): ランクIで−20%、ランクIIIで−35%(ランクIIは追跡距離のみ強化)。
      const shinShinobiRank = rankOf(get().skillEquipped, 'shinShinobi');
      const aggroFactor = shinShinobiRank >= 3 ? 0.65 : shinShinobiRank >= 1 ? 0.8 : 1;
      if (!b.awake && checkAggro(b, def, player.pos, lightLevel, aggroFactor)) {
        b.awake = true;
        interrupted = true;
        pushLog(`${def.name} がこちらに気づいた!`);
        if (discovered.has(cellKey(b.pos))) {
          pushFx({ kind: 'popup', at: b.pos, text: '!', color: '#fbbf24', dur: 800 });
          sfx.play('alert');
        }
        continue; // 気づいたターンは動かない(猶予)
      }
      if (!b.awake) continue;

      // ターゲット: プレイヤーと囮のうち最も近いもの。
      const { pos: tgtPos, decoy: tgtDecoy } = chooseTarget(b, player.pos, get().decoys);

      if (adjacent(b.pos, tgtPos)) {
        if (tgtDecoy) {
          hitDecoy(b, tgtDecoy);
        } else {
          beastStrike(b);
          interrupted = true;
        }
        continue;
      }

      // 縄張りから離れすぎたら追跡を諦める(ターゲット基準)。
      // 遠隔攻撃(rogue-24): 射程内かつ射線が通れば、離れたまま撃つ。
      if (def.ranged && distW(b.pos, tgtPos) <= def.ranged.range && lineOfSight(get().dungeon.open, b.pos, tgtPos)) {
        pushFx({ kind: 'bolt', from: b.pos, to: tgtPos, dur: 240 });
        sfx.play('magic');
        if (tgtDecoy) {
          hitDecoy(b, tgtDecoy);
        } else {
          beastStrike(b, true);
          interrupted = true;
        }
        continue;
      }

      // 追跡を諦める距離(shinShinobi・rogue-27): ランクIIで−25%、ランクIIIで−40%(旧 shinKehai を統合)。
      const territoryFactor = shinShinobiRank >= 3 ? 0.6 : shinShinobiRank >= 2 ? 0.75 : 1;
      if (outOfTerritory(b, def, tgtPos, territoryFactor)) {
        b.awake = false;
        pushLog(`${def.name} は追跡を諦めた`);
        continue;
      }

      // 追跡: 縄張り・階層制限内でターゲットへ最も近づく空洞セルへ1歩。
      // 不動種(胞子茸)はその場から動かない(rogue-21)。
      if (def.stationary) continue;
      const best = chooseChaseStep(b, def, stepCandidates(b), tgtPos);
      if (best) moveBeast(b, best);
    }
    set({ beasts: [...get().beasts] });
    turretsFire();
    return interrupted;
  }

  /** プレイヤー→敵の近接攻撃。 */
  /** 近接攻撃。薙ぎ払い武器はリーチ内の敵全員に、通常はクリックした1体に当たる。 */
  async function meleeAttack(clicked: Beast): Promise<void> {
    const run = getRunSeq();
    triggerPose('attack', 600); // プレイヤーモデルの攻撃モーション
    set({ busy: true, reach: { cells: [], parent: new Map() } });
    const player = get().player;
    const targets = weaponSweep(player)
      ? get().beasts.filter(
          (x) =>
            x.alive &&
            stepDist(player.pos, x.pos) <= weaponReach(player) &&
            get().discovered.has(cellKey(x.pos)),
        )
      : [clicked];
    if (targets.length > 1) pushLog('薙ぎ払い!');
    sfx.play('melee');
    await sleep(140);
    if (getRunSeq() !== run) return;
    let diedCount = 0; // 実績「群れ祓い」(rogue-25): 1回の近接攻撃での撃破数
    for (const b of targets) {
      const def = BEASTS[b.kind];
      const skillEquipped = get().skillEquipped;
      // 攻撃前の覚醒状態を捕捉(rogue-24)— 背討ちの倍率と隠密マスタリーの両方がこの値を使う。
      const preAwake = b.awake;
      const lightLevel = get().lightLevel;
      let dmg = Math.max(1, playerAtk(player, skillEquipped, lightLevel) - (b.defOverride ?? def.def) + irnd(-1, 1));
      // 個体の強化判定(門番・深度係数等による atk/defOverride 持ち)。闇討ちの除外条件。
      const isElite = !!def.gatekeeper || b.atkOverride !== undefined || b.defOverride !== undefined;
      // 闇討ち(yamiuchi・rogue-27): 消灯中の背討ちは一般敵を即死させる
      // (門番・強化個体・気配感知の敵には効かない)。成立しなければ従来の背討ち×2へ。
      if (!preAwake && !def.senses && !isElite && lightLevel === 3 && knotActive(skillEquipped, 'yamiuchi')) {
        dmg = b.hp;
        pushLog('闇討ち!');
      } else if (!preAwake && !def.senses && rankOf(skillEquipped, 'shinSegiri') >= 1) {
        // 背討ち(shinSegiri): 未覚醒の敵へは×2。ただし気配感知(senses)の敵には無効。
        dmg *= 2;
        pushLog('背後から急所を突いた!');
      }
      b.awake = true;
      pushLog(`${def.name} に ${dmg}ダメージ`);
      const unarmed = player.weapon === null;
      // 隠密マスタリー加算(rogue-32): 攻撃前に未覚醒なら加算(倒す必要なし)。
      if (preAwake === false) skills.incrementMastery({ stealthKills: 1 });
      const died = damageBeast(b, dmg, '#fecaca', { weapon: !unarmed, unarmed });
      if (died) diedCount++;
      // 延焼の刃(hiEnjin): 装着中のみ乱数を引く(30%で延焼2ターン)。倒した敵には不要。
      if (!died && rankOf(skillEquipped, 'hiEnjin') >= 1 && rand() < 0.3) {
        b.status = { kind: 'burn', turns: 2 };
        pushLog(`${def.name} に火が移った!`);
      }
      // 二刀流(nitoryu・rogue-30): 本手のダメージ適用後、対象が生存し、左手に武器があり、
      // nitoryu ランク≥1 なら、左手の攻の半分の追撃ダメージを与える。
      if (!died && player.shield && rankOf(skillEquipped, 'nitoryu') >= 1) {
        const leftWeapon = player.shield;
        if (ITEMS[leftWeapon.item].kind === 'weapon' && !ITEMS[leftWeapon.item].twoHanded) {
          const leftAtk = stackAtk(leftWeapon);
          const counterDmg = Math.max(1, Math.floor(leftAtk / 2 + 0.5));
          const def_name = BEASTS[b.kind].name;
          pushLog(`左手の${itemLabel(leftWeapon)}が追い打ち(${counterDmg}ダメージ)`);
          const counterDied = damageBeast(b, counterDmg, '#fbbf24');
          // 延焼の刃は追撃ヒットにも1回転がす。
          if (!counterDied && rankOf(skillEquipped, 'hiEnjin') >= 1 && rand() < 0.3) {
            b.status = { kind: 'burn', turns: 2 };
            pushLog(`${def_name} に火が移った!`);
          }
          if (counterDied) diedCount++;
        }
      }
    }
    if (diedCount >= 3) skills.maybeUnlockFeat('sweep3');
    sfx.play('hit');
    set({ beasts: [...get().beasts] });
    await sleep(240);
    if (getRunSeq() !== run) return;
    beastsTurn();
    endTurn();
    settleAfterAction();
  }

  function killBeast(b: Beast, ctx?: KillCtx): void {
    b.alive = false;
    set({ kills: get().kills + 1 });
    pushFx({ kind: 'death', at: b.pos, dur: 700 });
    sfx.play('death');
    pushLog(`${BEASTS[b.kind].name} を倒した!`);
    // 討伐図鑑(rogue-25・永続): 種ごとの討伐数・初討伐深度。
    codexStore.recordBeastKill(b.kind, depthOf(b.pos));
    // 門番討伐(rogue-24): 心得の器(スキルスロット)が広がる。実績(rogue-25)は
    // スロット上限に関わらず毎回判定する(feats 集合の冪等性で二重解除は起きない)。
    if (BEASTS[b.kind].gatekeeper) {
      skills.maybeUnlockFeat('gatekeeper');
      if (get().skillSlots < 8) {
        set({ skillSlots: get().skillSlots + 1 });
        pushLog('門番を討った — 心得の器が広がる(スロット+1)');
        sfx.play('pickup');
      }
    }
    // マスタリー加算(rogue-24)。1回の討伐で複数系統に同時加算されうる
    // (例: 素手で敵を倒す → 拳闘)。隠密マスタリーは rogue-32 より
    // 未覚醒への攻撃時に加算されるため、killBeast では加算しない。
    if (ctx) {
      const delta: Partial<MasteryCounters> = {};
      if (ctx.weapon) delta.weaponKills = 1;
      if (ctx.unarmed) delta.fistKills = 1;
      if (ctx.viaTrap) delta.trapKills = 1;
      if (Object.keys(delta).length > 0) skills.incrementMastery(delta);
    }
    // 胞子爆発(rogue-21): 死亡時、隣接するプレイヤーに状態異常(予防中は無効)。
    const burst = BEASTS[b.kind].deathBurst;
    if (burst) {
      const p = get().player;
      if (stepDist(p.pos, b.pos) <= 1 && p.immune <= 0) {
        p.status =
          p.status?.kind === burst
            ? { kind: burst, turns: Math.max(p.status.turns, 2) }
            : { kind: burst, turns: 2 };
        set({ player: { ...p } });
        pushLog('胞子が弾けて視界がゆがむ…');
        pushFx({ kind: 'popup', at: p.pos, text: '💫', color: '#f472b6', dur: 900 });
      }
    }
    // ホーム広間の掃討判定(壁色の明化キー)。
    if (!get().beasts.some((x) => x.alive && x.id !== b.id && x.homeChamber === b.homeChamber)) {
      if (get().visitedChambers.has(b.homeChamber)) pushLog('この空間は静かになった…');
      set({ exploreRev: get().exploreRev + 1 });
    }
    // 戦利品は湧き時に前倒し抽選済み(rogue-19b)。倒れたらそれを落とすだけ。
    if (b.carry) {
      get().items.push({ id: nextItemSeq(), stack: b.carry, pos: b.pos });
      set({ items: [...get().items] });
    }
  }

  /** 投げナイフ。 */
  async function throwKnife(b: Beast): Promise<void> {
    const run = getRunSeq();
    const { player } = get();
    const idx = player.pack.findIndex((x) => x.item === 'knife');
    if (idx < 0) return;
    const knife = player.pack[idx];
    triggerPose('throw', 500); // プレイヤーモデルの投擲モーション
    set({ busy: true, uiMode: 'walk', reach: { cells: [], parent: new Map() } });
    // 個数消費: n >= 2 なら n-1、n === 1 で枠削除。
    const n = stackCount(knife);
    if (n >= 2) {
      player.pack[idx] = { ...knife, n: n - 1 };
    } else {
      player.pack.splice(idx, 1);
    }
    set({ player: { ...player, pack: [...player.pack] } });
    pushFx({ kind: 'bolt', from: player.pos, to: b.pos, dur: 260 });
    sfx.play('arrow');
    await sleep(280);
    if (getRunSeq() !== run) return;
    const def = BEASTS[b.kind];
    const dmg = Math.max(1, stackDmg(knife) - Math.floor((b.defOverride ?? def.def) / 2) + irnd(-1, 1));
    // 攻撃前の覚醒状態を捕捉(melee と同じ流儀)。
    const preAwakeKnife = b.awake;
    b.awake = true;
    sfx.play('hit');
    pushLog(`投げナイフが ${def.name} に ${dmg}ダメージ`);
    // 隠密マスタリー加算(rogue-32): 攻撃前に未覚醒なら加算(倒す必要なし)。
    if (preAwakeKnife === false) skills.incrementMastery({ stealthKills: 1 });
    const diedByKnife = damageBeast(b, dmg, '#fecaca', { weapon: true });
    // 跳弾(knifeRico): 命中時、対象に隣接する敵1体(最小id)へ半分ダメージ(乱数なし)。
    if (rankOf(get().skillEquipped, 'knifeRico') >= 1) {
      const near = get()
        .beasts.filter((x) => x.alive && x.id !== b.id && adjacent(x.pos, b.pos))
        .sort((a, z) => a.id - z.id)[0];
      if (near) {
        const rico = Math.floor(dmg / 2);
        if (rico > 0) {
          pushLog(`ナイフが跳ねて ${BEASTS[near.kind].name} へ!`);
          const preAwakeNear = near.awake;
          // 跳弾も隠密マスタリーの対象(未覚醒への攻撃は1回数える)。
          if (preAwakeNear === false) skills.incrementMastery({ stealthKills: 1 });
          near.awake = true;
          damageBeast(near, rico, '#fecaca', { weapon: true });
        }
      }
    }
    void diedByKnife;
    set({ beasts: [...get().beasts] });
    await sleep(200);
    if (getRunSeq() !== run) return;
    beastsTurn();
    endTurn();
    settleAfterAction();
  }

  /**
   * アイテム投擲(rogue-28)。武具(weapon/armor/shield)は対象セルへ落ちて拾い直せる。
   * 水薬は消滅。relic・装置(turret/decoy)は投げられない。
   * 射程: FCC 歩数 4(必中・乱数なし)。
   */
  async function throwItem(index: number, beastId: number): Promise<void> {
    const run = getRunSeq();
    const { player, beasts } = get();
    if (index < 0 || index >= player.pack.length) return;
    const item = player.pack[index];
    const itemDef = ITEMS[item.item];
    // 投げられない種類は拒否(relic・turret・decoy)。
    if (!['weapon', 'armor', 'shield', 'potion'].includes(itemDef.kind)) return;
    // 対象敵を探す。
    const b = beasts.find((x) => x.id === beastId && x.alive);
    if (!b) return;
    // 射程判定: FCC 歩数 4 以下。
    if (distW(player.pos, b.pos) > 4) return;
    triggerPose('throw', 500);
    // throwItemIndex を残すと次のナイフ投擲モードで武具を投げてしまう — ここで必ず消す。
    set({ busy: true, uiMode: 'walk', throwItemIndex: undefined, reach: { cells: [], parent: new Map() } });
    // アイテムを pack から除去。
    const newPack = [...player.pack];
    if (itemDef.kind === 'potion') {
      // 水薬は n 消費。
      const n = stackCount(item);
      if (n >= 2) {
        newPack[index] = { ...item, n: n - 1 };
      } else {
        newPack.splice(index, 1);
      }
    } else {
      // 武具は枠ごと削除。
      newPack.splice(index, 1);
    }
    set({ player: { ...player, pack: newPack } });
    pushFx({ kind: 'bolt', from: player.pos, to: b.pos, dur: 260 });
    sfx.play('arrow');
    await sleep(280);
    if (getRunSeq() !== run) return;
    const def = BEASTS[b.kind];
    // 攻撃前の覚醒状態を捕捉(melee・throwKnife と同じ流儀)。
    const preAwake = b.awake;
    b.awake = true;
    // ダメージ計算(固定値・乱数なし)。
    let dmg = 0;
    if (itemDef.kind === 'weapon') {
      dmg = Math.floor(stackAtk(item) / 2) + 2;
    } else if (itemDef.kind === 'armor' || itemDef.kind === 'shield') {
      dmg = 3 + item.q;
    } else if (itemDef.kind === 'potion') {
      dmg = 2;
    }
    sfx.play('hit');
    // ログは投げた1つ分のラベル(束の ×n を出さない)。
    pushLog(`${itemLabel({ item: item.item, q: item.q })} が ${def.name} に ${dmg}ダメージ`);
    // 隠密マスタリー加算(rogue-32): 攻撃前に未覚醒なら加算(倒す必要なし)。
    if (preAwake === false) skills.incrementMastery({ stealthKills: 1 });
    damageBeast(b, dmg, '#fecaca', { weapon: true });
    // 武具は対象セルへ落ちる(倒しても落ちる=拾い直せる)。水薬は消滅。
    if (itemDef.kind !== 'potion') {
      get().items.push({ id: nextItemSeq(), stack: item, pos: b.pos });
      set({ items: [...get().items] });
    }
    set({ beasts: [...get().beasts] });
    await sleep(200);
    if (getRunSeq() !== run) return;
    beastsTurn();
    endTurn();
    settleAfterAction();
  }

  /** 連撃(rengeki・rogue-30): 素手で隣接の敵へ2連撃。装填6ターン。 */
  async function rengeki(clicked: Beast): Promise<void> {
    const run = getRunSeq();
    // 事前確認(rogue-30 spec): phase/busy/rank/CD/素手/隣接。
    const s = get();
    if (s.phase !== 'play' || s.busy) return;
    if (rankOf(s.skillEquipped, 'rengeki') < 1 || cdOf(s.cooldowns, 'rengeki') > 0) return;
    if (s.player.weapon !== null) return;
    if (stepDist(s.player.pos, clicked.pos) > 1) return;

    const b = s.beasts.find((x) => x.id === clicked.id && x.alive);
    if (!b) return;

    triggerPose('attack', 600);
    set({ busy: true, reach: { cells: [], parent: new Map() } });
    sfx.play('melee');
    await sleep(140);
    if (getRunSeq() !== run) return;

    const player = get().player;
    const skillEq = get().skillEquipped;
    const def = BEASTS[b.kind];
    // 覚醒判定(preAwake)は1回目の攻撃前に1度だけ捕捉して両ヒットで共有。
    const preAwake = b.awake;
    // 隠密マスタリー(rogue-32): 2ヒットでも1回だけ加算。
    let stealthCounted = false;

    // 個体の強化判定(門番・深度係数等)。闇討ちの除外条件は meleeAttack と同じ
    // (preAwake/lightLevel は両ヒットで固定なので、hitNum に依らず一度だけ評価できるが、
    // meleeAttack と同じ計算式であることを明示するためループ内でも再評価する)。
    const isElite = !!def.gatekeeper || b.atkOverride !== undefined || b.defOverride !== undefined;

    for (let hitNum = 0; hitNum < 2; hitNum++) {
      if (!b.alive) break; // 1撃目で死んだら2撃目なし。

      b.awake = true;
      const lightLevel = get().lightLevel;
      let dmg = Math.max(1, playerAtk(player, skillEq, lightLevel) - (b.defOverride ?? def.def) + irnd(-1, 1));

      // 各ヒットは meleeAttack と同じ計算(闇討ち・背討ちを含む)。
      if (!preAwake && !def.senses && !isElite && lightLevel === 3 && knotActive(skillEq, 'yamiuchi')) {
        dmg = b.hp;
        if (hitNum === 0) pushLog('闇討ち!');
      } else if (!preAwake && !def.senses && rankOf(skillEq, 'shinSegiri') >= 1) {
        dmg *= 2;
        if (hitNum === 0) pushLog('背後から急所を突いた!');
      }

      pushLog(`${def.name} に ${dmg}ダメージ`);
      // 隠密マスタリー加算: 1ヒット目で未覚醒なら1回だけ加算。
      if (!stealthCounted && preAwake === false) {
        skills.incrementMastery({ stealthKills: 1 });
        stealthCounted = true;
      }
      const died = damageBeast(b, dmg, '#fecaca', { unarmed: true });

      // 延焼の刃: 各ヒットごとに判定。
      if (!died && rankOf(skillEq, 'hiEnjin') >= 1 && rand() < 0.3) {
        b.status = { kind: 'burn', turns: 2 };
        pushLog(`${def.name} に火が移った!`);
      }
    }
    // 連撃は単体攻撃(最大1体撃破)— 群れ祓い(3体撃破)の対象外なので実績判定はしない。

    // クールダウン設定。
    const cd = { ...get().cooldowns, rengeki: 6 };
    set({ cooldowns: cd });

    sfx.play('hit');
    set({ beasts: [...get().beasts] });
    await sleep(240);
    if (getRunSeq() !== run) return;
    beastsTurn();
    endTurn();
    settleAfterAction();
  }

  return {
    beastStrike,
    hitDecoy,
    damageBeast,
    killBeast,
    fireTrap,
    triggerTrap,
    detonateTrap,
    turretsFire,
    beastsTurn,
    stepCandidates,
    moveBeast,
    meleeAttack,
    rengeki,
    throwKnife,
    throwItem,
  };
}
