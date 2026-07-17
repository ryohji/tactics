// 層(ストラタム)のオーケストレーション(rogue.ts 分割A5)。checkStratum(警告/崩落の
// 判定)・triggerCollapse(崩落の発動)に加え、endTurn(ターン経過の帳尻)もここへ同梱する。
// A2〜A4 と同じく zustand ストアは1つのまま(state/rogue.ts の useRogue)。関数本文は
// rogue.ts に直書きされていた頃と1文字も変えていない — 参照だけ deps/戻り値経由に
// 置き換えてある。
//
// endTurn の置き場について: endTurn は combat/skills/move の3モジュールすべてから
// 呼ばれる横断的なヘルパだが、本体の最後で checkStratum を直接呼ぶ(同一モジュール内
// 呼び出しで完結する)。逆に moveActions.ts に置くと、checkStratum/triggerCollapse
// (stratum 側)を deps 経由で呼び返す循環になり、共有コンテキストがかえって増える。
// checkDead(毒 DoT 用)・recordRun(死亡直後の記録)は state/rogue/runEnd.ts から
// deps 経由で借りる — runEnd.ts はこちらを呼び返さない一方向の依存なので、
// rogue.ts では runEnd → stratum の順に生成する。
//
// stratumWarned(層ごとに1度だけ出す警告ログのフラグ)もモジュール変数としてここへ
// 移した。restart/resume からのリセットは resetStratumWarned() 経由で行う。

import type { StoreApi } from 'zustand';
import type { RogueState } from '../rogue';
import * as scoreboard from '../scoreboard';
import * as masteryStore from '../masteryStore';
import * as bgm from '../../audio/bgm';
import type { SfxName } from '../../audio/sfx';
import { layer, keyToCell, type CellKey } from '../../model/fcc';
import { collapseAbove } from '../../model/dungeon';
import { LIGHT, STRATUM_DEPTH, isDimLight, type RogueFx } from '../../model/rogue/types';
import { depthOf } from '../../model/rogue/rules';
import {
  draftLanes,
  formatEquippedForRecord,
  hasAnyMastery,
  masteryLevels,
  rankOf,
  type MasteryCounters,
} from '../../model/rogue/mastery';
import type { FeatId } from '../../model/rogue/feats';

// 現在の層で「もうすぐ崩落する」警告を出したか(層ごとに restart/崩落でリセット)。
let stratumWarned = false;

/** restart/resume から: 新しいランに切り替わったら警告フラグを引き継がない。 */
export function resetStratumWarned(): void {
  stratumWarned = false;
}

export interface StratumDeps {
  set: StoreApi<RogueState>['setState'];
  get: StoreApi<RogueState>['getState'];
  pushLog(msg: string): void;
  pushFx(e: Omit<RogueFx, 'id' | 'start'>): void;
  sfx: { play(name: SfxName): void };
  rand(): number;
  /** HP0 なら死亡処理へ(state/rogue/runEnd.ts の createRunEnd が返す)。true で死亡。 */
  checkDead(): boolean;
  /** ローカルスコアボードへの記録(state/rogue/runEnd.ts の createRunEnd が返す)。 */
  recordRun(escaped: boolean): void;
  /** マスタリー・実績(state/rogue/skills.ts の createSkills が返す一部)。 */
  skills: {
    maybeUnlockFeat(id: FeatId): void;
    incrementMastery(delta: Partial<MasteryCounters>): void;
  };
  /** 到達範囲の再計算(state/rogue/moveActions.ts の createMove が返す。まだ存在しない
      ためサンクで渡す)。 */
  refreshReach(): void;
  /** 毎ターン終わりの自動保存(rogue.ts 側)。 */
  autoSave(): void;
}

export function createStratum(deps: StratumDeps) {
  const { set, get, pushLog, pushFx, sfx, rand, checkDead, recordRun, skills, refreshReach, autoSave } =
    deps;

  /**
   * 層の崩落(rogue-19b)を発動する: cutLayer より上を崩落させ、二度と戻れなくする。
   * dungeon 本体は collapseAbove が刈る。ここでは store 側の他の集合(discovered・
   * cellChamber・地上アイテム・罠・砲塔・囮・敵)を同じ cutLayer で刈り、stratum を進める。
   */
  function triggerCollapse(stratum: number): void {
    const s = get();
    const cutLayer = -4 * (STRATUM_DEPTH * (stratum + 1) - 1);
    collapseAbove(s.dungeon, cutLayer);
    const alive = (k: CellKey) => layer(keyToCell(k)) <= cutLayer;
    // 崩落で置き去りの罠を自動破棄(rogue-28)。
    const remainingTraps = s.traps.filter((t) => layer(t.pos) <= cutLayer);
    const trapRemoved = s.traps.length > remainingTraps.length;
    set({
      discovered: new Set([...s.discovered].filter(alive)),
      discoveredRev: s.discoveredRev + 1,
      cellChamber: new Map([...s.cellChamber].filter(([k]) => alive(k))),
      items: s.items.filter((i) => layer(i.pos) <= cutLayer),
      traps: remainingTraps,
      trapCooldown: trapRemoved ? 0 : s.trapCooldown,
      turrets: s.turrets.filter((t) => layer(t.pos) <= cutLayer),
      decoys: s.decoys.filter((d) => layer(d.pos) <= cutLayer),
      beasts: s.beasts.filter((b) => layer(b.pos) <= cutLayer),
      stratum: stratum + 1,
      exploreRev: s.exploreRev + 1,
    });
    pushLog('背後で巣が崩れ落ちた。もう戻れない —');
    // 崩落で置き去りの罠があれば通知(rogue-28)。
    if (trapRemoved) pushLog('崩落で仕掛けた罠は失われた(編み直せる)');
    // 実績「最初の関門」(rogue-25): 崩落を1度通過する(毎回呼んでも feats の冪等性で二重解除しない)。
    skills.maybeUnlockFeat('firstGate');
    // 実績「無傷の関門」(rogue-25): HP満タンで関門を通過する。
    if (get().player.hp === get().player.maxHp) skills.maybeUnlockFeat('pureGate');
    // 灯火マスタリー(rogue-24): 「絞る」以下の暗さで関門を通過した実績。
    if (isDimLight(get().lightLevel)) {
      skills.incrementMastery({ dimCollapses: 1 });
      skills.maybeUnlockFeat('darkGate'); // 実績「暗闇行」(rogue-25)
    }
    // 崩落の衝撃で障壁は剥がれる(rogue-21。層を跨いだ持ち越しをさせない)。
    const p = get().player;
    if (p.barrier > 0) {
      p.barrier = 0;
      set({ player: { ...p } });
      pushLog('崩落の衝撃で障壁が剥がれた。');
    }
    sfx.play('death');
    stratumWarned = false;

    // 関門(rogue-23。rogue-27でスロット上限8・天秤ドラフト+見送り権へ改訂):
    // スロット+1(上限8)。見送り権(skillFreePick)を持っていればそれを消費して自由選択
    // ('free')を出す(rng を引かない)。無ければ draftLanes で3枠を引く — 候補ゼロなら
    // 乱数を一切引かず、ドラフトも出さない(マスタリー未育成のプレイヤーとゴールデン
    // テストの経路で乱数列を守る既存規律)。
    const newSlots = Math.min(8, get().skillSlots + 1);
    set({ skillSlots: newSlots });
    if (get().skillFreePick) {
      set({ skillFreePick: false, skillDraft: 'free' });
      pushLog('見送っていた選択の権利で、心得を自由に選べる。');
    } else {
      const levels = masteryLevels(masteryStore.readMastery());
      // rogue-27: wanaAmi ランクIは系統レベル0でも常時候補になりうるため、
      // hasAnyMastery(何か1つでも育っているか)が false なら draftLanes 自体を呼ばず
      // rng を一切引かない(真にマスタリー0のプレイヤー・ゴールデンテストの乱数列を守る。
      // mastery.ts の hasAnyMastery 参照)。
      const draft = hasAnyMastery(levels) ? draftLanes(get().skillEquipped, levels, rand) : [];
      set({ skillDraft: draft.length > 0 ? draft : null });
      if (draft.length > 0) pushLog('関門の先へ進む前に、新たな心得を選べる。');
    }

    // 共有スコアボード(rogue-26): 関門通過時点のスナップショットを送信(進行中=潜行中扱い)。
    // 死亡/生還の確定は runEnd.recordRun 側。fire-and-forget・URL 未設定は no-op。
    const s2 = get();
    void scoreboard.submitRun(
      scoreboard.buildRunPayload(
        {
          seed: s2.seed,
          turn: s2.turn,
          kills: s2.kills,
          maxDepth: s2.maxDepth,
          stratum: s2.stratum,
          deathCause: s2.deathCause,
          skillEquipped: formatEquippedForRecord(s2.skillEquipped),
        },
        { runId: scoreboard.getRunId(), name: scoreboard.readPlayerName(), escaped: false, dead: false },
      ),
    );

    refreshReach();
    autoSave();
  }

  /**
   * 層の関門(rogue-19b): 深度が警告ライン(STRATUM_DEPTH*(stratum+1))・
   * 崩落ライン(その+2)を跨いだかを見る。endTurn(移動に限らずすべてのターン
   * 消費行動の後)から呼ぶ — wait で足踏みしていても境界を越えていれば発火する。
   */
  function checkStratum(): void {
    const s = get();
    if (s.phase !== 'play') return;
    const depth = depthOf(s.player.pos);
    const warnAt = STRATUM_DEPTH * (s.stratum + 1);
    if (depth >= warnAt + 2) {
      triggerCollapse(s.stratum);
      return;
    }
    if (depth >= warnAt && !stratumWarned) {
      stratumWarned = true;
      pushLog('頭上の土がきしみ、砂がこぼれ落ちる…(これより深くへ進むと戻れない)');
    }
  }

  /** ターン経過の帳尻(ターン数・自然回復・罠の装填クールダウン)。明かりが強いほど回復が早い。 */
  function endTurn(): void {
    const turn = get().turn + 1;
    const { player, lightLevel, skillEquipped } = get();
    // 罠編み(wanaAmi・rogue-27): 装填クールダウンをターンごとに1ずつ回復する。
    if (get().trapCooldown > 0) set({ trapCooldown: get().trapCooldown - 1 });
    // 篝火(hiKagari・rogue-24): 「広げる」中は回復間隔−1(最低2)。
    const regenEvery =
      lightLevel === 2 && rankOf(skillEquipped, 'hiKagari') >= 1
        ? Math.max(2, LIGHT[lightLevel].regenEvery - 1)
        : LIGHT[lightLevel].regenEvery;
    if (turn % regenEvery === 0 && player.hp > 0) {
      if (player.hp < player.maxHp) {
        player.hp += 1;
        set({ player: { ...player } });
      } else if (rankOf(skillEquipped, 'tenka') >= 1 && player.barrier < 24) {
        // 転化(rogue-23): HP満タン時の自然回復ティックが障壁+1に変わる(上限24)。
        player.barrier = Math.min(24, player.barrier + 1);
        pushFx({ kind: 'popup', at: player.pos, text: '障壁+1', color: '#67d3e0', dur: 700 });
        set({ player: { ...player } });
      }
    }
    // プレイヤーの状態異常(rogue-21)。毒は障壁を素通りして HP 直撃。
    if (player.status && player.hp > 0) {
      if (player.status.kind === 'poison') {
        player.hp = Math.max(0, player.hp - 1);
        pushFx({ kind: 'popup', at: player.pos, text: '1', color: '#a78bfa', dur: 700 });
        if (player.hp <= 0) set({ deathCause: '毒' });
      }
      player.status = { ...player.status, turns: player.status.turns - 1 };
      if (player.status.turns <= 0) {
        pushLog(player.status.kind === 'poison' ? '毒が抜けた。' : '頭がはっきりした。');
        player.status = null;
      }
      set({ player: { ...player } });
      checkDead();
    }
    // 解毒の水薬の予防(rogue-21)は毎ターン1ずつ減る。
    if (player.immune > 0) {
      player.immune -= 1;
      set({ player: { ...player } });
    }
    set({ turn });
    bgm.setBgmDepth(depthOf(player.pos)); // BGM は深度で曲調が変わる
    autoSave();
    checkStratum(); // 層の警告/崩落(移動に限らずすべてのターン消費行動の後で見る)
    // 死亡直後のこの1回だけ通る(死亡後は phase!=='play' 判定で二度と endTurn まで来ない)。
    if (get().phase === 'dead') recordRun(false);
  }

  return { checkStratum, triggerCollapse, endTurn };
}
