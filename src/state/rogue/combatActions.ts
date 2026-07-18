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
import { OFFSETS, cellKey, type Cell, type CellKey } from '../../model/fcc';
import { adjacent, distW, stepDist, lineOfSight } from '../../model/dungeon';
import { BEASTS } from '../../model/beasts';
import { ITEMS, stackDmg, stackCount, stackAtk, itemLabel } from '../../model/loot';
import type { Beast, BeastStatus, Decoy, PlacedTrap, Turret, RogueFx, GameEvent, PlayerState, LightLevel } from '../../model/rogue/types';
import { PLAYER_ID, isDimLight } from '../../model/rogue/types';
import { BURN_DMG, depthOf, playerAtk, weaponReach, weaponSweep, knockbackPath, straightSteps } from '../../model/rogue/rules';
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
  /** 素手(武器null)での討伐(fistKills)。既存: 近接・連撃・突進の素手時のみ。 */
  unarmed?: boolean;
  preAwake?: boolean;
  /** 罠(triggerTrap経由)での討伐(trapKills)。既存どおり他フラグと排他。 */
  viaTrap?: boolean;
  /** 片手武器かつ盾なしでの討伐(oneHandFreeKills・rogue-35)。 */
  oneHandFree?: boolean;
  /** 両手武器での討伐(twoHandKills・rogue-35)。 */
  twoHand?: boolean;
  /** HP満タンでの討伐(unhurtKills・rogue-35)。 */
  unhurt?: boolean;
  /** HP25%以下での討伐(lowHpKills・rogue-35)。 */
  lowHp?: boolean;
  /** 「絞る」以下の明かりでの討伐(darkKills・rogue-35)。 */
  dark?: boolean;
  /** 投げナイフでの討伐(knifeKills・rogue-35。跳弾の連鎖ヒットも対象)。 */
  knife?: boolean;
}

/**
 * 討伐時マスタリー用の装備・HP・明かりフラグ(rogue-35)。武器の構え(素手/片手フリー/
 * 両手)・HP状態・明かりは「討伐した方法」でなく「討伐した瞬間の状態」で決まるため、
 * 近接・投擲・投げナイフ・連撃・突進のどの経路でも同じ組み立てを使う
 * (罠(viaTrap)・投げナイフ(knife)は呼び出し元が個別に追加する)。
 */
function equipmentKillFlags(player: PlayerState, lightLevel: LightLevel): KillCtx {
  const weaponDef = player.weapon ? ITEMS[player.weapon.item] : null;
  return {
    unarmed: player.weapon === null,
    oneHandFree: !!weaponDef && !weaponDef.twoHanded && player.shield === null,
    twoHand: !!weaponDef && !!weaponDef.twoHanded,
    unhurt: player.hp === player.maxHp,
    lowHp: player.hp * 4 <= player.maxHp,
    dark: isDimLight(lightLevel),
  };
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
  /** たいまつの明かりの再発見(state/rogue/moveActions.ts の createMove が返す。突進の移動後に使う)。 */
  discover(): void;
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
    discover,
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
      // 返し(kaeshi・rogue-35): 回避成功時、隣接の攻撃者へ攻1/3→1/2→3/4 の固定反撃。
      // 盾でも素手でも発動する(旧・盾術IIの受け反撃と身軽IIの見切りを統合)。
      // 矢返し(yagaeshi): 返しランク2以上に限り、遠隔攻撃なら非隣接の射手にも届く。
      const kaeshiRank = rankOf(skillEquipped, 'kaeshi');
      const adjacentAttacker = stepDist(b.pos, player.pos) === 1;
      const yagaeshiReach = ranged && kaeshiRank >= 2 && knotActive(skillEquipped, 'yagaeshi');
      const counterActive = kaeshiRank >= 1 && (adjacentAttacker || yagaeshiReach);
      if (counterActive) {
        const atk = playerAtk(player, skillEquipped, get().lightLevel);
        const counter =
          kaeshiRank >= 3 ? Math.floor((atk * 3) / 4) : kaeshiRank >= 2 ? Math.floor(atk / 2) : Math.floor(atk / 3);
        if (counter > 0) {
          pushLog(adjacentAttacker ? '受け流しざま反撃した!' : '矢を弾き、射手へ打ち返した!');
          damageBeast(b, counter, '#93c5fd'); // 討伐マスタリーの対象外(近接/薙ぎ/投擲のみ)
          set({ beasts: [...get().beasts] });
        }
      }
      // 静水(seisui・rogue-35): 回避成功時、次の自分の近接攻撃+2の1回限りフラグを立てる。
      if (knotActive(skillEquipped, 'seisui')) {
        set({ seisuiCharge: true });
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

  /**
   * ダメージ適用(死亡処理込み)。生存していれば false。
   * 障壁(rogue-36)がある敵はまず障壁から削れ、余りが HP へ抜ける。障壁が
   * 削り切られた瞬間は「障壁が砕けた!」を出す(プレイヤー側と同じ演出)。
   */
  function damageBeast(b: Beast, dmg: number, color = '#fecaca', kill?: KillCtx): boolean {
    const hadBarrier = b.barrier;
    if (hadBarrier > 0) {
      const { barrier, hpDmg } = absorbBarrier(hadBarrier, dmg, false);
      b.barrier = barrier;
      b.hp = Math.max(0, b.hp - hpDmg);
      applyEvents(damageEvents(b.pos, dmg, color));
      if (barrier === 0) {
        pushLog(`${BEASTS[b.kind].name} の障壁が砕けた!`);
        pushFx({ kind: 'popup', at: b.pos, text: '障壁破壊', color: '#67d3e0', dur: 900 });
      }
    } else {
      b.hp = Math.max(0, b.hp - dmg);
      applyEvents(damageEvents(b.pos, dmg, color));
    }
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
      // 背討ちの接近パッシブ(rogue-37): 装着中は、気配感知(senses)でない未覚醒の敵の
      // 隣(FCC距離√2)まで踏み込んでも気づかれない(覚醒判定そのものをスキップ)。
      const shinSegiriRank = rankOf(get().skillEquipped, 'shinSegiri');
      const shinSegiriPassive = shinSegiriRank >= 1 && !def.senses && adjacent(b.pos, player.pos);
      if (!b.awake && !shinSegiriPassive && checkAggro(b, def, player.pos, lightLevel, aggroFactor)) {
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
      let territoryFactor = shinShinobiRank >= 3 ? 0.6 : shinShinobiRank >= 2 ? 0.75 : 1;
      // 影歩き(kagearuki・rogue-35): 消灯中はさらに半減。
      if (lightLevel === 3 && knotActive(get().skillEquipped, 'kagearuki')) territoryFactor *= 0.5;
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
    // 静水(seisui・rogue-35): 次の近接攻撃+2の1回限りフラグ(このアクションの最初の1発だけ消費)。
    let seisuiBonus = get().seisuiCharge ? 2 : 0;
    if (seisuiBonus > 0) set({ seisuiCharge: false });
    for (const b of targets) {
      const def = BEASTS[b.kind];
      const skillEquipped = get().skillEquipped;
      // 攻撃前の覚醒状態を捕捉(rogue-24)— 背討ちの倍率と隠密マスタリーの両方がこの値を使う。
      const preAwake = b.awake;
      const lightLevel = get().lightLevel;
      let dmg =
        Math.max(1, playerAtk(player, skillEquipped, lightLevel) - (b.defOverride ?? def.def) + irnd(-1, 1)) +
        seisuiBonus;
      seisuiBonus = 0; // 1回で消費(薙ぎ払いの2体目以降には乗らない)
      // 個体の強化判定(門番・深度係数等による atk/defOverride 持ち)。闇討ちの除外条件。
      const isElite = !!def.gatekeeper || b.atkOverride !== undefined || b.defOverride !== undefined;
      // 闇討ち(yamiuchi・rogue-27): 消灯中の背討ちは一般敵を即死させる
      // (門番・強化個体・気配感知の敵には効かない)。成立しなければ従来の背討ち×2へ。
      if (!preAwake && !def.senses && !isElite && lightLevel === 3 && knotActive(skillEquipped, 'yamiuchi')) {
        dmg = b.hp + b.barrier; // 障壁ごと貫いて即死させる(rogue-36)
        pushLog('闇討ち!');
      } else if (!preAwake && !def.senses && rankOf(skillEquipped, 'shinSegiri') >= 1) {
        // 背討ち(shinSegiri): 未覚醒の敵へは×2。ただし気配感知(senses)の敵には無効。
        dmg *= 2;
        pushLog('背後から急所を突いた!');
      }
      b.awake = true;
      pushLog(`${def.name} に ${dmg}ダメージ`);
      // 隠密マスタリー加算(rogue-32): 攻撃前に未覚醒なら加算(倒す必要なし)。
      if (preAwake === false) skills.incrementMastery({ stealthStrikes: 1 });
      const died = damageBeast(b, dmg, '#fecaca', equipmentKillFlags(player, lightLevel));
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
    // マスタリー加算(rogue-24。rogue-35でノード単位の11カウンタへ再編)。1回の討伐で
    // 複数カウンタに同時加算されうる(例: 片手武器・盾なし・無傷での討伐 → 3つ同時)。
    // 隠密マスタリー(stealthStrikes)は rogue-32 より未覚醒への攻撃「命中」時に加算されるため、
    // killBeast(討伐確定時)では加算しない。
    if (ctx) {
      const delta: Partial<MasteryCounters> = {};
      if (ctx.unarmed) delta.fistKills = 1;
      if (ctx.viaTrap) delta.trapKills = 1;
      if (ctx.oneHandFree) delta.oneHandFreeKills = 1;
      if (ctx.twoHand) delta.twoHandKills = 1;
      if (ctx.unhurt) delta.unhurtKills = 1;
      if (ctx.lowHp) delta.lowHpKills = 1;
      if (ctx.dark) delta.darkKills = 1;
      if (ctx.knife) delta.knifeKills = 1;
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
    const lightLevel = get().lightLevel;
    b.awake = true;
    sfx.play('hit');
    pushLog(`投げナイフが ${def.name} に ${dmg}ダメージ`);
    // 隠密マスタリー加算(rogue-32): 攻撃前に未覚醒なら加算(倒す必要なし)。
    if (preAwakeKnife === false) skills.incrementMastery({ stealthStrikes: 1 });
    const diedByKnife = damageBeast(b, dmg, '#fecaca', { ...equipmentKillFlags(player, lightLevel), knife: true });
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
          if (preAwakeNear === false) skills.incrementMastery({ stealthStrikes: 1 });
          near.awake = true;
          damageBeast(near, rico, '#fecaca', { ...equipmentKillFlags(player, lightLevel), knife: true });
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
    // アイテムを pack から1個だけ消費(rogue-33: 武具も n 消費。n>=2 なら枠は残る)。
    const newPack = [...player.pack];
    const n = stackCount(item);
    if (n >= 2) {
      newPack[index] = { ...item, n: n - 1 };
    } else {
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
    if (preAwake === false) skills.incrementMastery({ stealthStrikes: 1 });
    damageBeast(b, dmg, '#fecaca', equipmentKillFlags(player, get().lightLevel));
    // 武具は対象セルへ落ちる(倒しても落ちる=拾い直せる)。落ちるのは単品。水薬は消滅。
    if (itemDef.kind !== 'potion') {
      get().items.push({ id: nextItemSeq(), stack: { item: item.item, q: item.q }, pos: b.pos });
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
    // 静水(seisui・rogue-35): 次の近接攻撃+2の1回限りフラグ(1ヒット目だけ消費)。
    let seisuiBonus = get().seisuiCharge ? 2 : 0;
    if (seisuiBonus > 0) set({ seisuiCharge: false });

    for (let hitNum = 0; hitNum < 2; hitNum++) {
      if (!b.alive) break; // 1撃目で死んだら2撃目なし。

      b.awake = true;
      const lightLevel = get().lightLevel;
      let dmg =
        Math.max(1, playerAtk(player, skillEq, lightLevel) - (b.defOverride ?? def.def) + irnd(-1, 1)) + seisuiBonus;
      seisuiBonus = 0;

      // 各ヒットは meleeAttack と同じ計算(闇討ち・背討ちを含む)。
      if (!preAwake && !def.senses && !isElite && lightLevel === 3 && knotActive(skillEq, 'yamiuchi')) {
        dmg = b.hp + b.barrier; // 障壁ごと貫いて即死させる(rogue-36)
        if (hitNum === 0) pushLog('闇討ち!');
      } else if (!preAwake && !def.senses && rankOf(skillEq, 'shinSegiri') >= 1) {
        dmg *= 2;
        if (hitNum === 0) pushLog('背後から急所を突いた!');
      }

      pushLog(`${def.name} に ${dmg}ダメージ`);
      // 隠密マスタリー加算: 1ヒット目で未覚醒なら1回だけ加算。
      if (!stealthCounted && preAwake === false) {
        skills.incrementMastery({ stealthStrikes: 1 });
        stealthCounted = true;
      }
      const died = damageBeast(b, dmg, '#fecaca', equipmentKillFlags(player, lightLevel));

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

  /**
   * 盾打ち(tateuchi・rogue-35): 隣接する敵1体を反対方向へノックバック+固定ダメージ
   * (3+盾品質。押し先が塞がっていれば押せずダメージのみ)。盾装備中のみ。装填6ターン。
   * ノックバック先(位置変更)は moveBeast を通す(§4: 罠誘爆はここで自動的に乗る)。
   */
  async function tateuchi(clicked: Beast): Promise<void> {
    const run = getRunSeq();
    const s = get();
    if (s.phase !== 'play' || s.busy) return;
    if (rankOf(s.skillEquipped, 'tateuchi') < 1 || cdOf(s.cooldowns, 'tateuchi') > 0) return;
    const hasShield = s.player.shield !== null && ITEMS[s.player.shield.item].kind === 'shield';
    if (!hasShield) return;
    if (stepDist(s.player.pos, clicked.pos) > 1) return;
    const b = s.beasts.find((x) => x.id === clicked.id && x.alive);
    if (!b) return;

    triggerPose('attack', 600);
    set({ busy: true, reach: { cells: [], parent: new Map() } });
    sfx.play('melee');
    await sleep(140);
    if (getRunSeq() !== run) return;

    const player = get().player;
    const lightLevel = get().lightLevel;
    const skillEq = get().skillEquipped;
    const shieldQ = player.shield!.q;
    let dmg = 3 + shieldQ;
    // 衝波(shouha・rogue-35): 盾打ち+硬化の結び。ノックバックが2マスになり、
    // 押し先が(2マス分)塞がっていれば+2ダメージ。
    const shouha = knotActive(skillEq, 'shouha');
    const maxSteps = shouha ? 2 : 1;
    const occupied = new Set<CellKey>([
      ...get()
        .beasts.filter((x) => x.alive && x.id !== b.id)
        .map((x) => cellKey(x.pos)),
      cellKey(player.pos),
      ...get().turrets.map((t) => cellKey(t.pos)),
      ...get().decoys.map((d) => cellKey(d.pos)),
    ]);
    const path = knockbackPath(get().dungeon, (k) => !occupied.has(k), player.pos, b.pos, maxSteps);
    if (shouha && path.length < maxSteps) dmg += 2;
    const def = BEASTS[b.kind];
    b.awake = true; // 打たれた敵は目を覚ます(他の攻撃と同じ)
    pushLog(`盾で ${def.name} を打った(${dmg}ダメージ)`);
    const died = damageBeast(b, dmg, '#93c5fd', equipmentKillFlags(player, lightLevel));
    if (!died && path.length > 0) moveBeast(b, path[path.length - 1]);

    const cd = { ...get().cooldowns, tateuchi: 6 };
    set({ cooldowns: cd });
    sfx.play('hit');
    set({ beasts: [...get().beasts] });
    await sleep(240);
    if (getRunSeq() !== run) return;
    beastsTurn();
    endTurn();
    settleAfterAction();
  }

  /**
   * 突進(tosshin・rogue-35): 直線に最大2マス移動(通過・終点は空セルのみ)し、終点で
   * 隣接する敵1体へ通常近接攻撃(敵に当てず移動だけでも可)。装填6ターン。
   * dest は MoveMarkers/clickCell から渡される「発見済みの直線2歩以内の空セル」(rogue.ts
   * の dashCells で候補を作る)— ここでもう一度、実際に踏める経路として再確認する。
   */
  async function tosshin(dest: Cell): Promise<void> {
    const run = getRunSeq();
    const s = get();
    if (s.phase !== 'play' || s.busy) return;
    if (rankOf(s.skillEquipped, 'tosshin') < 1 || cdOf(s.cooldowns, 'tosshin') > 0) return;

    const occupied = new Set<CellKey>([
      ...s.traps.map((t) => cellKey(t.pos)),
      ...s.turrets.map((t) => cellKey(t.pos)),
      ...s.decoys.map((d) => cellKey(d.pos)),
      ...s.beasts.filter((x) => x.alive).map((x) => cellKey(x.pos)),
    ]);
    const passable = (k: CellKey) => s.discovered.has(k) && !occupied.has(k);
    let path: Cell[] | null = null;
    for (const dir of OFFSETS) {
      const p = straightSteps(s.dungeon, passable, s.player.pos, dir, 2);
      const idx = p.findIndex((c) => cellKey(c) === cellKey(dest));
      if (idx >= 0) {
        path = p.slice(0, idx + 1);
        break;
      }
    }
    if (!path || path.length === 0) return;

    triggerPose('attack', 500);
    set({ busy: true, uiMode: 'walk', reach: { cells: [], parent: new Map() } });
    sfx.play('step');
    animateUnit(PLAYER_ID, [s.player.pos, ...path]);
    await sleep(180);
    if (getRunSeq() !== run) return;

    const player = get().player;
    player.pos = path[path.length - 1];
    set({ player: { ...player } });
    discover();

    const cd = { ...get().cooldowns, tosshin: 6 };
    set({ cooldowns: cd });

    const target = get()
      .beasts.filter(
        (x) => x.alive && get().discovered.has(cellKey(x.pos)) && stepDist(player.pos, x.pos) === 1,
      )
      .sort((a, z) => a.id - z.id)[0];
    if (!target) {
      pushLog('突進した');
      set({ beasts: [...get().beasts] });
      await sleep(120);
      if (getRunSeq() !== run) return;
      beastsTurn();
      endTurn();
      settleAfterAction();
      return;
    }

    sfx.play('melee');
    await sleep(140);
    if (getRunSeq() !== run) return;
    const b = get().beasts.find((x) => x.id === target.id && x.alive);
    if (b) {
      const def = BEASTS[b.kind];
      const skillEq = get().skillEquipped;
      const preAwake = b.awake;
      const lightLevel = get().lightLevel;
      let dmg = Math.max(1, playerAtk(player, skillEq, lightLevel) - (b.defOverride ?? def.def) + irnd(-1, 1));
      if (get().seisuiCharge) {
        dmg += 2;
        set({ seisuiCharge: false });
      }
      const isElite = !!def.gatekeeper || b.atkOverride !== undefined || b.defOverride !== undefined;
      if (!preAwake && !def.senses && !isElite && lightLevel === 3 && knotActive(skillEq, 'yamiuchi')) {
        dmg = b.hp + b.barrier; // 障壁ごと貫いて即死させる(rogue-36)
        pushLog('闇討ち!');
      } else if (!preAwake && !def.senses && rankOf(skillEq, 'shinSegiri') >= 1) {
        dmg *= 2;
        pushLog('背後から急所を突いた!');
      }
      b.awake = true;
      pushLog(`突進の一撃! ${def.name} に ${dmg}ダメージ`);
      if (preAwake === false) skills.incrementMastery({ stealthStrikes: 1 });
      const died = damageBeast(b, dmg, '#fecaca', equipmentKillFlags(player, lightLevel));
      if (!died && rankOf(skillEq, 'hiEnjin') >= 1 && rand() < 0.3) {
        b.status = { kind: 'burn', turns: 2 };
        pushLog(`${def.name} に火が移った!`);
      }
    }
    sfx.play('hit');
    set({ beasts: [...get().beasts] });
    await sleep(200);
    if (getRunSeq() !== run) return;
    beastsTurn();
    endTurn();
    settleAfterAction();
  }

  /**
   * 替り身(kawarimi・rogue-35): 隣接する敵1体と場所を入れ替える(攻撃なし)。疑似同士討ち:
   * 入れ替えの瞬間、旧位置(プレイヤーの元の位置)に隣接する覚醒中の近接敵(入れ替えた
   * 本人を除く)の一撃(固定・乱数なし)が入れ替わった敵に落ちる。装填8ターン。
   * 敵の新位置(プレイヤーの旧位置)への移動は moveBeast を通す(§4: 罠誘爆が自動で乗る)。
   */
  async function kawarimi(clicked: Beast): Promise<void> {
    const run = getRunSeq();
    const s = get();
    if (s.phase !== 'play' || s.busy) return;
    if (rankOf(s.skillEquipped, 'kawarimi') < 1 || cdOf(s.cooldowns, 'kawarimi') > 0) return;
    if (stepDist(s.player.pos, clicked.pos) > 1) return;
    const b = s.beasts.find((x) => x.id === clicked.id && x.alive);
    if (!b) return;

    set({ busy: true, reach: { cells: [], parent: new Map() } });
    sfx.play('select');
    await sleep(140);
    if (getRunSeq() !== run) return;

    const player = get().player;
    const oldPlayerPos = player.pos;
    const oldBeastPos = b.pos;
    animateUnit(PLAYER_ID, [oldPlayerPos, oldBeastPos]);
    player.pos = oldBeastPos;
    set({ player: { ...player } });
    discover();
    moveBeast(b, oldPlayerPos); // 位置変更ヘルパ経由 — triggerTrap も自動で乗る(§4)
    set({ beasts: [...get().beasts] });
    pushLog('替り身!');

    // 疑似同士討ち: 旧位置に隣接する覚醒中の近接敵(本人除く)の一撃が入れ替わった敵に落ちる。
    if (b.alive) {
      const attackers = get().beasts.filter(
        (x) => x.alive && x.id !== b.id && x.awake && stepDist(oldPlayerPos, x.pos) === 1 && !BEASTS[x.kind].ranged,
      );
      for (const atk of attackers) {
        if (!b.alive) break;
        const dmg = atk.atkOverride ?? BEASTS[atk.kind].atk;
        pushLog(`${BEASTS[atk.kind].name} が入れ替わった ${BEASTS[b.kind].name} を巻き込んだ!`);
        damageBeast(b, dmg, '#fbbf24');
      }
      set({ beasts: [...get().beasts] });
    }

    const cd = { ...get().cooldowns, kawarimi: 8 };
    set({ cooldowns: cd });
    await sleep(200);
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
    tateuchi,
    tosshin,
    kawarimi,
  };
}
