// スキル・マスタリー・実績のオーケストレーション(rogue.ts 分割A2)。
// zustand ストアは1つのまま(state/rogue.ts の useRogue)。ここは共有コンテキスト
// (set/get・pushLog・logAction・他モジュールへ回すアクション末尾処理)を受け取る
// ファクトリとして切り出す。関数本文は rogue.ts に直書きされていた頃と1文字も
// 変えていない — 参照だけ deps/戻り値経由に置き換えてある。
//
// recoverTrap は beastsTurn(A3で state/rogue/combatActions.ts へ)/endTurn(rogue.ts に
// 残置。A5 で移設予定)を呼ぶため deps 経由で借りる。equipSkill の片手持ち(katate)解除・
// unequipSkill の消灯(hiShobo)解除も同様に deps(discover。A4で state/rogue/moveActions.ts
// へ)経由。

import type { StoreApi } from 'zustand';
import type { RogueState } from '../rogue';
import * as masteryStore from '../masteryStore';
import * as codexStore from '../codexStore';
import * as sfx from '../../audio/sfx';
import { ITEMS } from '../../model/loot';
import { FEATS, type FeatId } from '../../model/rogue/feats';
import {
  MASTERY_NAME,
  SKILL_NODES,
  COUNTER_NODES,
  masteryLevels,
  unlockedNodes,
  equippedCost,
  type MasterySystem,
  type MasteryCounters,
  type NodeId,
} from '../../model/rogue/mastery';

export interface SkillsDeps {
  set: StoreApi<RogueState>['setState'];
  get: StoreApi<RogueState>['getState'];
  pushLog(msg: string): void;
  /** 状態を変えるアクションの入口で呼ぶ(将来の再生器 rogue-26 向けの記録のみ)。 */
  logAction(code: string, ...args: (number | string)[]): void;
  /** 1ターン分のアクション末尾で busy/reach を締めくくる共通処理(rogue.ts 側)。 */
  settleAfterAction(): void;
  /** 敵の1ターン(state/rogue/combatActions.ts の createCombat が返す。A3 で移設済み)。 */
  beastsTurn(): boolean;
  /** ターン経過の帳尻(rogue.ts 側。A5 で移設予定)。 */
  endTurn(): void;
  /** たいまつの明かりの再発見(state/rogue/moveActions.ts の createMove が返す。A4 で移設済み)。 */
  discover(): void;
}

export function createSkills(deps: SkillsDeps) {
  const { set, get, pushLog, logAction, settleAfterAction, beastsTurn, endTurn, discover } = deps;

  /**
   * マスタリー(永続カウンタ)を加算し、レベルアップしたらログを出す(rogue-23)。
   * カウンタは死んでも残る(masteryStore.ts が localStorage に保存)。
   */
  function incrementMastery(delta: Partial<MasteryCounters>): void {
    const cur = masteryStore.readMastery();
    const before = masteryLevels(cur);
    const next: MasteryCounters = {
      weaponKills: cur.weaponKills + (delta.weaponKills ?? 0),
      evades: cur.evades + (delta.evades ?? 0),
      absorbed: cur.absorbed + (delta.absorbed ?? 0),
      fistKills: cur.fistKills + (delta.fistKills ?? 0),
      stealthKills: cur.stealthKills + (delta.stealthKills ?? 0),
      trapKills: cur.trapKills + (delta.trapKills ?? 0),
      dimCollapses: cur.dimCollapses + (delta.dimCollapses ?? 0),
    };
    masteryStore.writeMastery(next);
    const after = masteryLevels(next);
    (Object.keys(after) as MasterySystem[]).forEach((sys) => {
      if (after[sys] > before[sys]) {
        pushLog(`${MASTERY_NAME[sys]}の心得が深まった(Lv${after[sys]})`);
      }
    });
    // 実績「罠師の誇り」(rogue-25): 罠での討伐が累計5に達した瞬間だけ解除。
    if (delta.trapKills && cur.trapKills < 5 && next.trapKills >= 5) maybeUnlockFeat('trapper5');
  }

  /**
   * 実績(永続。rogue-25)を解除する。既に解除済みなら何もしない(feats 集合で判定)。
   * 新規解除時のみログ+効果音を出す。
   */
  function maybeUnlockFeat(id: FeatId): void {
    if (codexStore.readCodex().feats.includes(id)) return;
    codexStore.unlockFeat(id);
    pushLog(`実績解除: ${FEATS[id].name}`);
    sfx.play('pickup');
  }

  /** 現在のマスタリーで解禁済みかつ未装着のノード id 列。 */
  function undraftedUnlockedNodes(): NodeId[] {
    const levels = masteryLevels(masteryStore.readMastery());
    const equipped = get().skillEquipped;
    return unlockedNodes(levels).filter((id) => !equipped.includes(id));
  }

  /** 「支度」パネルか関門ドラフトが開いている(rogue-23。ゲーム操作をブロックする)。 */
  function skillModalOpen(): boolean {
    const s = get();
    return s.skillOutfitting || s.skillDraft !== null;
  }

  // --- スキル(マスタリー×スロット。rogue-23) ------------------------------------
  // equipSkill/unequipSkill/finishOutfitting/skipDraft は「支度」「関門ドラフト」の
  // モーダル表示中だけ動く(busy 相当のゲーム操作ブロック中でも、この4つだけは通す)。

  const actions = {
    equipSkill: (id: NodeId) => {
      logAction('SE', id);
      const s = get();
      const inOutfitting = s.skillOutfitting;
      const inDraft = s.skillDraft !== null;
      if (!inOutfitting && !inDraft) return;
      // 支度中は解禁済み全ノードから、ドラフト中は提示された候補からのみ選べる。
      if (inOutfitting) {
        if (!unlockedNodes(masteryLevels(masteryStore.readMastery())).includes(id)) return;
      } else if (!s.skillDraft!.includes(id)) {
        return;
      }
      if (s.skillEquipped.includes(id)) return;
      // 反撃系(受け反撃/見切り)は同時装着不可(rogue-24 の横断ルール)。
      if (
        COUNTER_NODES.includes(id) &&
        s.skillEquipped.some((x) => COUNTER_NODES.includes(x) && x !== id)
      ) {
        pushLog('反撃の技はひとつしか身につけられない');
        return;
      }
      if (equippedCost(s.skillEquipped) + SKILL_NODES[id].cost > s.skillSlots) {
        pushLog('スロットが足りない(外して組み替える)');
        return;
      }
      set({ skillEquipped: [...s.skillEquipped, id] });
      pushLog(`${SKILL_NODES[id].name} を装着した`);
      sfx.play('select');
      if (inDraft) {
        set({ skillDraft: null });
        settleAfterAction();
      }
    },

    unequipSkill: (id: NodeId) => {
      logAction('SU', id);
      const s = get();
      if (!s.skillOutfitting && s.skillDraft === null) return;
      if (!s.skillEquipped.includes(id)) return;
      const player = s.player;
      // 片手扱い(katate)を外すと、両手武器+盾の組み合わせが不整合になる — 盾を pack へ。
      if (id === 'katate' && player.weapon && ITEMS[player.weapon.item].twoHanded && player.shield) {
        player.pack.push(player.shield);
        player.shield = null;
        pushLog('盾を背負い直した(片手扱いを解除)');
        set({ player: { ...player, pack: [...player.pack] } });
      }
      // 消灯(hiShobo)を外したとき消灯状態なら「絞る」へ戻す(rogue-24)。
      if (id === 'hiShobo' && s.lightLevel === 3) {
        set({ lightLevel: 0 });
        pushLog('たいまつに火を戻した(絞る)');
        discover();
      }
      set({ skillEquipped: get().skillEquipped.filter((x) => x !== id) });
      pushLog(`${SKILL_NODES[id].name} を外した`);
      sfx.play('cancel');
    },

    recoverTrap: (id: number) => {
      logAction('RT', id);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      if (!s.skillEquipped.includes('wanaKaishu')) return;
      const t = s.traps.find((x) => x.id === id);
      if (!t) return;
      const player = s.player;
      player.pack.push({ item: t.item, q: t.q });
      set({ traps: s.traps.filter((x) => x.id !== id), player: { ...player, pack: [...player.pack] } });
      sfx.play('pickup');
      pushLog(`${ITEMS[t.item].name} を回収した`);
      // 回収も1ターン。
      beastsTurn();
      endTurn();
      settleAfterAction();
    },

    finishOutfitting: () => {
      logAction('SF');
      if (!get().skillOutfitting) return;
      set({ skillOutfitting: false });
      pushLog('準備を終えて潜った。');
      settleAfterAction();
    },

    skipDraft: () => {
      logAction('SX');
      if (get().skillDraft === null) return;
      set({ skillDraft: null });
      pushLog('スキルの選択を見送った。');
      settleAfterAction();
    },
  };

  return { incrementMastery, maybeUnlockFeat, undraftedUnlockedNodes, skillModalOpen, actions };
}
