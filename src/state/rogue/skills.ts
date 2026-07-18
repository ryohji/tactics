// スキル・マスタリー・実績のオーケストレーション(rogue.ts 分割A2)。zustand ストアは1つのまま
// (state/rogue.ts の useRogue)。ここは共有コンテキスト(set/get・pushLog・logAction・他モジュール
// へ回すアクション末尾処理)を受け取るファクトリとして切り出す。関数本文は rogue.ts に直書き
// されていた頃と1文字も変えていない — 参照だけ deps/戻り値経由に置き換えてある
// (rogue-27 で装着スキルをランク付き(EquippedSkill)へ、装着ロジックを takeable/EXCLUDES 基準へ
// 改訂。draftCandidates/unlockedNodes は削除し、mastery.ts の takeable/draftLanes へ移行)。
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
import { ITEMS, itemLabel } from '../../model/loot';
import { cellKey, neighbors, type CellKey } from '../../model/fcc';
import { FEATS, type FeatId } from '../../model/rogue/feats';
import {
  MASTERY_NAME,
  SKILL_NODES,
  EXCLUDES,
  masteryLevels,
  takeable,
  equippedCost,
  rankOf,
  maxRank,
  type MasterySystem,
  type MasteryCounters,
  type NodeId,
  type EquippedSkill,
} from '../../model/rogue/mastery';

/** ランク表示(装着済みノードを深めたときのログ用)。ランク1は「新規装着」側で扱う。 */
const RANK_LABEL: Record<number, string> = { 2: 'Ⅱ', 3: 'Ⅲ' };

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
  /** 地上アイテムの id 採番(rogue.ts のモジュール変数 itemSeq。rogue-30: nitoryu 解除の足元落下用)。 */
  nextItemSeq(): number;
}

export function createSkills(deps: SkillsDeps) {
  const { set, get, pushLog, logAction, settleAfterAction, beastsTurn, endTurn, discover, nextItemSeq } = deps;

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

  /** 「支度」パネルか関門ドラフトが開いている(rogue-23。ゲーム操作をブロックする)。 */
  function skillModalOpen(): boolean {
    const s = get();
    return s.skillOutfitting || s.skillDraft !== null;
  }

  // --- スキル(マスタリー×スロット。rogue-23。rogue-27でランク制へ) ------------------------
  // equipSkill/unequipSkill/finishOutfitting/skipDraft は「支度」「関門ドラフト」の
  // モーダル表示中だけ動く(busy 相当のゲーム操作ブロック中でも、この4つだけは通す)。

  const actions = {
    equipSkill: (id: NodeId) => {
      logAction('SE', id);
      const s = get();
      const inOutfitting = s.skillOutfitting;
      const draftArray = Array.isArray(s.skillDraft) ? s.skillDraft : null;
      const inFree = s.skillDraft === 'free';
      if (!inOutfitting && !draftArray && !inFree) return;

      // 支度中・見送り権('free')中は解禁済みの次ランク全体(takeable)から、
      // 関門ドラフト(配列)中は提示された候補からのみ選べる。
      const levels = masteryLevels(masteryStore.readMastery());
      if (inOutfitting || inFree) {
        if (!takeable(s.skillEquipped, levels).some((c) => c.id === id)) return;
      } else if (draftArray) {
        if (!draftArray.some((c) => c.id === id)) return;
      }

      const cur = rankOf(s.skillEquipped, id);
      const target = cur + 1;
      const node = SKILL_NODES[id];
      if (target > maxRank(id)) return; // 安全弁(takeable/draft候補が既にここまで来ないはず)

      // 排他(EXCLUDES・rogue-27): 両立しない相手ノードが該当ランク以上で装着中なら拒否。
      const blocked = EXCLUDES.some(([[a, aMin], [b, bMin]]) => {
        if (a === id && target >= aMin && rankOf(s.skillEquipped, b) >= bMin) return true;
        if (b === id && target >= bMin && rankOf(s.skillEquipped, a) >= aMin) return true;
        return false;
      });
      if (blocked) {
        pushLog('両立しない心得だ');
        return;
      }

      // コスト差分(ランクアップは差分だけ、新規は costs[0] そのもの)。
      const costDelta = node.costs[target - 1] - (target > 1 ? node.costs[target - 2] : 0);
      if (equippedCost(s.skillEquipped) + costDelta > s.skillSlots) {
        pushLog('スロットが足りない(外して組み替える)');
        return;
      }

      const already = s.skillEquipped.some((e) => e.id === id);
      const nextEquipped: EquippedSkill[] = already
        ? s.skillEquipped.map((e) => (e.id === id ? { id, rank: target } : e))
        : [...s.skillEquipped, { id, rank: target }];
      set({ skillEquipped: nextEquipped });
      pushLog(already ? `${node.name} を深めた(${RANK_LABEL[target]})` : `${node.name} を装着した`);
      sfx.play('select');
      if (draftArray || inFree) {
        set({ skillDraft: null });
        settleAfterAction();
      }
    },

    unequipSkill: (id: NodeId) => {
      logAction('SU', id);
      const s = get();
      if (!s.skillOutfitting && s.skillDraft === null) return;
      if (!s.skillEquipped.some((e) => e.id === id)) return;
      const player = s.player;
      // 片手扱い(katate)を外すと、両手武器+盾の組み合わせが不整合になる — 盾を pack へ。
      if (id === 'katate' && player.weapon && ITEMS[player.weapon.item].twoHanded && player.shield) {
        player.pack.push(player.shield);
        player.shield = null;
        pushLog('盾を背負い直した(片手扱いを解除)');
        set({ player: { ...player, pack: [...player.pack] } });
      }
      // 二刀流(nitoryu)を外すと左手の武器が不整合になる — pack へ退避する
      // (katate の盾退避パターンと同じ。rogue-30)。pack が満杯なら足元へ落とす。
      if (id === 'nitoryu' && player.shield && ITEMS[player.shield.item].kind === 'weapon') {
        const leftWeapon = player.shield;
        player.shield = null;
        if (player.pack.length < 10) {
          player.pack.push(leftWeapon);
          pushLog(`${itemLabel(leftWeapon)} を仕舞った(二刀流を解除)`);
        } else {
          const items = get().items;
          items.push({ id: nextItemSeq(), stack: leftWeapon, pos: player.pos });
          set({ items: [...items] });
          pushLog(`${itemLabel(leftWeapon)} が持ちきれず足元に落ちた(二刀流を解除)`);
        }
        set({ player: { ...player, pack: [...player.pack] } });
      }
      // 消灯(hiShobo)を外したとき消灯状態なら「絞る」へ戻す(rogue-24)。
      if (id === 'hiShobo' && s.lightLevel === 3) {
        set({ lightLevel: 0 });
        pushLog('たいまつに火を戻した(絞る)');
        discover();
      }
      // ノードごと外す(全ランク返却)。
      set({ skillEquipped: get().skillEquipped.filter((e) => e.id !== id) });
      pushLog(`${SKILL_NODES[id].name} を外した`);
      sfx.play('cancel');
    },

    recoverTrap: (id: number) => {
      logAction('RT', id);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      // 罠を解く(rogue-24 の遠隔回収 → rogue-27: 罠編みランクII以上に統合)。
      // アイテムには戻らず、装填クールダウンが0になる(=即座に編み直せる)。
      if (rankOf(s.skillEquipped, 'wanaAmi') < 2) return;
      const t = s.traps.find((x) => x.id === id);
      if (!t) return;
      const cd = { ...s.cooldowns, wanaAmi: 0 };
      set({ traps: s.traps.filter((x) => x.id !== id), cooldowns: cd });
      sfx.play('pickup');
      pushLog('罠を解いた(すぐ編み直せる)');
      // 回収も1ターン。
      beastsTurn();
      endTurn();
      settleAfterAction();
    },

    dismantleTrap: (id: number) => {
      logAction('DT', id);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      // 罠編みランク1以上で隣接解体が可能。
      if (rankOf(s.skillEquipped, 'wanaAmi') < 1) return;
      const t = s.traps.find((x) => x.id === id);
      if (!t) return;
      // プレイヤーの足元または隣接(placeableCells と同じ判定: 足元 + neighbors)。
      const reachableCells = new Set<CellKey>([
        cellKey(s.player.pos),
        ...neighbors(s.player.pos).map(cellKey),
      ]);
      if (!reachableCells.has(cellKey(t.pos))) {
        pushLog('近づけば解体できる');
        return;
      }
      // 罠を除去(trapCooldown はリセットしない — rankIII の即再装填と違う)。
      set({ traps: s.traps.filter((x) => x.id !== id) });
      pushLog('罠を解体した');
      // 解体も1ターン。
      beastsTurn();
      endTurn();
      settleAfterAction();
    },

    finishOutfitting: () => {
      logAction('SF');
      if (!get().skillOutfitting) return;
      set({ skillOutfitting: false });
      pushLog('支度を整えた。');
      settleAfterAction();
    },

    skipDraft: () => {
      logAction('SX');
      if (get().skillDraft === null) return;
      set({ skillDraft: null, skillFreePick: true });
      pushLog('スキルの選択を見送った(次の関門で自由に選べる)');
      settleAfterAction();
    },
  };

  return { incrementMastery, maybeUnlockFeat, skillModalOpen, actions };
}
