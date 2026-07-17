// 移動・探索オーケストレーション(rogue.ts 分割A4)。A2(skills.ts)/A3(combatActions.ts)
// と同じく zustand ストアは1つのまま(state/rogue.ts の useRogue)。ここは共有コンテキスト
// (set/get・pushLog/pushFx・logAction・sfx/animateUnit/rand・combat.beastsTurn・endTurn・
// skills の一部・beastSeq/itemSeq/runSeq のアクセサ・weaveTrapAt)を受け取るファクトリとして
// 切り出す。関数本文は rogue.ts に直書きされていた頃と1文字も変えていない — 参照だけ
// deps/戻り値経由に置き換えてある。
//
// walkPath が使っていた traveling モジュール変数・sleep(timeScale込み)はセットでここへ
// 移した(cancelTravel と一体のため)。setTimeScaleForTest/sleep は rogue.ts から
// 引き続き再輸出・再利用される(combatActions.ts の sleep デップにもそのまま渡す)。
// runSeq 自体は buildInitial/restart/resume でも直に触るため rogue.ts に残置し、ここへは
// getRunSeq/bumpRunSeq のアクセサで渡す。
//
// discover/refreshReach/settleAfterAction は skills.ts(recoverTrap 等)や rogue.ts 本体
// (cycleLight・checkStratum・triggerCollapse・resume・useItem・mergeItem・weaveTrapAt)からも
// 呼ばれるため createMove の戻り値として公開する。findPath 系・confusedStep・stepPlayer・
// walkPath はこのモジュール内の clickCell/travelTo/travelToChamber/cancelTravel/wait からしか
// 呼ばれないため非公開のまま。
//
// wait は「移動」そのものではないが、combat.beastsTurn/endTurn/settleAfterAction の並びが
// clickCell 系の各アクションと同じで、settleAfterAction 側と密結合なためここへ含めた。
//
// 循環参照: move は combat.beastsTurn と skills の一部(skillModalOpen/maybeUnlockFeat)を
// 使うが、skills は move.discover/move.settleAfterAction を使う(recoverTrap 等)。rogue.ts
// 側で skills → move → combat の順に生成し、まだ存在しないオブジェクトへの参照はサンク
// (() => combat.beastsTurn() 等)で「後から束縛」して解く(A3 と同じ流儀)。

import type { StoreApi } from 'zustand';
import type { RogueState } from '../rogue';
import * as codexStore from '../codexStore';
import type { SfxName } from '../../audio/sfx';
import { OFFSETS, cellKey, type Cell, type CellKey } from '../../model/fcc';
import { maybeExpand, type Chamber } from '../../model/dungeon';
import { itemLabel, stackable, stackCount } from '../../model/loot';
import { spawnChamber } from '../../model/rogue/spawn';
import { discoverInto } from '../../model/rogue/visibility';
import {
  computeReach as computeReachPure,
  findPath as findPathPure,
  findPathWhere as findPathWherePure,
  pathFromReach,
  type Reach,
} from '../../model/rogue/reach';
import { LIGHT, PLAYER_ID, EXPAND_R, REACH_STEPS, type RogueFx } from '../../model/rogue/types';
import { depthOf, beastAt } from '../../model/rogue/rules';
import { STEP_MS } from '../unitAnim';
import type { FeatId } from '../../model/rogue/feats';

// 演出待ちの時間スケール(既定1)。シミュレータ(rogue-19a)が待ち時間だけを
// 詰めて headless 高速実行するためのフック。挙動・乱数列には影響しない。
let timeScale = 1;

/** テスト/シミュレータ用: 演出待ちの時間スケールを変える。scale=0 で実質即解決。 */
export function setTimeScaleForTest(scale: number): void {
  timeScale = scale;
}

/** 演出待ち(timeScale 込み)。combatActions.ts の sleep デップにもこの関数を渡す。 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms * timeScale));
}

export interface MoveDeps {
  set: StoreApi<RogueState>['setState'];
  get: StoreApi<RogueState>['getState'];
  pushLog(msg: string): void;
  pushFx(e: Omit<RogueFx, 'id' | 'start'>): void;
  /** 状態を変えるアクションの入口で呼ぶ(将来の再生器 rogue-26 向けの記録のみ)。 */
  logAction(code: string, ...args: (number | string)[]): void;
  sfx: { play(name: SfxName): void };
  animateUnit(id: number, path: Cell[]): number;
  rand(): number;
  /** 敵の1ターン(state/rogue/combatActions.ts の createCombat が返す)。 */
  combat: { beastsTurn(): boolean };
  /** ターン経過の帳尻(rogue.ts 側。A5 で移設予定)。 */
  endTurn(): void;
  /** 「支度」/関門ドラフト表示中かの判定と実績解除(state/rogue/skills.ts の createSkills が返す一部)。 */
  skills: {
    skillModalOpen(): boolean;
    maybeUnlockFeat(id: FeatId): void;
  };
  /** リスタート世代(rogue.ts のモジュール変数 runSeq)の読み取り。await を跨ぐ処理の打ち切り判定に使う。 */
  getRunSeq(): number;
  /** cancelTravel から: runSeq を進めて進行中の walkPath ループを打ち切る。 */
  bumpRunSeq(): void;
  /** 地上物の id 採番(rogue.ts のモジュール変数 beastSeq/itemSeq)。 */
  nextBeastSeq(): number;
  nextItemSeq(): number;
  /** place モードでの罠編み設置(rogue-27。rogue.ts 側に残置)。 */
  weaveTrapAt(c: Cell): void;
}

export function createMove(deps: MoveDeps) {
  const {
    set,
    get,
    pushLog,
    pushFx,
    logAction,
    sfx,
    animateUnit,
    rand,
    combat,
    endTurn,
    skills,
    getRunSeq,
    bumpRunSeq,
    nextBeastSeq,
    nextItemSeq,
    weaveTrapAt,
  } = deps;

  // ファストトラベル(walkPath)が進行中か。cancelTravel はこのときだけ runSeq を進めて
  // 打ち切る(攻撃演出など他の busy 処理を巻き込まないためのガード)。
  let traveling = false;

  /** たいまつの明かり: プレイヤーから空洞づたいに(明かり段階の半径)以内を発見済みに。 */
  /** たいまつの明かり: プレイヤーから空洞づたいに(明かり段階の半径)以内を発見済みに。 */
  function discover(): void {
    const { dungeon, discovered, player, lightLevel } = get();
    const grew = discoverInto(dungeon, player.pos, LIGHT[lightLevel].see, discovered);
    if (grew) set({ discoveredRev: get().discoveredRev + 1 });
  }

  /** 新しく生成された広間に敵と宝を湧かせる(セル→広間対応の登録も担う)。 */
  function populate(ch: Chamber): void {
    const { dungeon, beasts, items, cellChamber } = get();
    for (const k of ch.cells) cellChamber.set(k, ch.id);
    const spawned = spawnChamber(
      dungeon,
      ch,
      nextBeastSeq,
      nextItemSeq,
    );
    set({ beasts: [...beasts, ...spawned.beasts], items: [...items, ...spawned.items] });
  }

  /** クリック可能な移動先(発見済み空洞・敵なし・BFS≤REACH_STEPS)。 */
  function computeReach(): Reach {
    const { dungeon, discovered, beasts, player, phase } = get();
    if (phase !== 'play') return { cells: [], parent: new Map() };
    const occupied = new Set(beasts.filter((b) => b.alive).map((b) => cellKey(b.pos)));
    return computeReachPure(dungeon, discovered, occupied, player.pos, REACH_STEPS);
  }

  function refreshReach(): void {
    // 到達範囲が変わる=状況が動いた。タッチの2段階選択(armedKey)も解除する。
    // スキルモーダル表示中は移動マーカーを出さない(操作ブロック)。
    set({
      reach: skills.skillModalOpen() ? { cells: [], parent: new Map() } : computeReach(),
      armedKey: null,
    });
  }

  /**
   * 1ターン分のアクション末尾で busy/reach を締めくくる共通処理。スキルモーダルが
   * 開いていれば busy を true のまま維持し(ゲーム操作をブロック)、そうでなければ
   * false に戻す。
   */
  function settleAfterAction(): void {
    set({ busy: skills.skillModalOpen() });
    refreshReach();
  }

  /** 発見済み空洞を通る任意長の最短経路(生きた敵のセルは避ける)を述語で探す。 */
  function findPathWhere(isGoal: (k: CellKey) => boolean): Cell[] | null {
    const { dungeon, discovered, beasts, player } = get();
    const occupied = new Set(beasts.filter((b) => b.alive).map((b) => cellKey(b.pos)));
    return findPathWherePure(dungeon, discovered, occupied, player.pos, isGoal);
  }

  /** 指定セルへの最短経路。 */
  function findPath(to: Cell): Cell[] | null {
    const { dungeon, discovered, beasts, player } = get();
    const occupied = new Set(beasts.filter((b) => b.alive).map((b) => cellKey(b.pos)));
    return findPathPure(dungeon, discovered, occupied, player.pos, to);
  }

  /** parent 木から経路を復元([現在地, ..., 目的地])。 */
  function pathTo(to: Cell): Cell[] {
    const { reach, player } = get();
    return pathFromReach(reach, player.pos, to);
  }

  /**
   * 混乱(rogue-21)による移動ずれ: 50% で意図と違う「隣接する空セル」へ逸れる。
   * 逸れ先候補は open かつ敵の居ないセル(意図した先も候補に含む素朴な抽選 —
   * 結果的に意図どおりのこともある)。候補ゼロなら意図どおり。
   */
  function confusedStep(intended: Cell): Cell {
    const s = get();
    if (s.player.status?.kind !== 'confuse') return intended;
    if (rand() < 0.5) return intended;
    const from = s.player.pos;
    const options: Cell[] = [];
    for (const o of OFFSETS) {
      const n: Cell = [from[0] + o[0], from[1] + o[1], from[2] + o[2]];
      const k = cellKey(n);
      if (s.dungeon.open.has(k) && !beastAt(s.beasts, k)) options.push(n);
    }
    if (options.length === 0) return intended;
    const picked = options[Math.floor(rand() * options.length)];
    if (cellKey(picked) !== cellKey(intended)) {
      pushLog('足がもつれて違う方へ…');
      pushFx({ kind: 'popup', at: from, text: '💫', color: '#f472b6', dur: 700 });
    }
    return picked;
  }

  /** プレイヤーを隣へ1歩(発見・拡張・拾得・訪問記録込み)。 */
  function stepPlayer(next: Cell): void {
    const { player, dungeon, items } = get();
    animateUnit(PLAYER_ID, [player.pos, next]);
    player.pos = next;
    sfx.play('step');
    const newMaxDepth = Math.max(get().maxDepth, depthOf(next));
    set({
      player: { ...player },
      focus: next,
      maxDepth: newMaxDepth,
    });
    // 実績「深淵の一瞥」(rogue-25): 深度16へ到達。
    if (newMaxDepth >= 16) skills.maybeUnlockFeat('deep16');
    discover();
    // 広間の訪問記録(壁色の変化キー)。
    const chId = get().cellChamber.get(cellKey(next));
    if (chId !== undefined && !get().visitedChambers.has(chId)) {
      get().visitedChambers.add(chId);
      set({ exploreRev: get().exploreRev + 1 });
    }
    // 生成: スタブ終端に近づいたら次の広間。
    const grown = maybeExpand(dungeon, next, EXPAND_R);
    if (grown.length > 0) {
      for (const ch of grown) populate(ch);
      pushLog('奥から冷たい風が流れてくる…');
      sfx.play('land');
      discover(); // 掘削で明かりの届く範囲が変わったかもしれない
    }
    // 拾得。
    const k = cellKey(next);
    const foundIndices = items
      .map((i, idx) => (cellKey(i.pos) === k ? idx : -1))
      .filter((idx) => idx >= 0);
    if (foundIndices.length > 0) {
      let pickedUp = false;
      const pickedUpIndices = new Set<number>();
      for (const idx of foundIndices) {
        const f = items[idx];
        // stackable かつ pack に同 (item, q) の既存スタックがあれば n を加算。
        if (stackable(f.stack.item)) {
          const existing = player.pack.findIndex(
            (x) => x.item === f.stack.item && x.q === f.stack.q,
          );
          if (existing >= 0) {
            // 既存スタックに加算。
            const n = stackCount(f.stack);
            player.pack[existing] = {
              ...player.pack[existing],
              n: (stackCount(player.pack[existing]) + n),
            };
            pushFx({ kind: 'popup', at: next, text: itemLabel(player.pack[existing]), color: '#fde68a', dur: 900 });
            pushLog(`${itemLabel(player.pack[existing])} に加わった`);
            codexStore.recordItemFound(f.stack.item, f.stack.q);
            pickedUpIndices.add(idx);
            pickedUp = true;
            continue;
          }
        }
        // 新しい枠が要る場合、pack.length >= 10 なら拾えない。
        if (player.pack.length >= 10) {
          pushLog('これ以上持てない(使うか投げて空ける)');
          continue;
        }
        // 通常の拾得。
        player.pack.push(f.stack);
        pushFx({ kind: 'popup', at: next, text: itemLabel(f.stack), color: '#fde68a', dur: 900 });
        pushLog(`${itemLabel(f.stack)} を拾った`);
        // アイテム図鑑(rogue-25・永続): 入手数・最高品質。
        codexStore.recordItemFound(f.stack.item, f.stack.q);
        // 遺物「巣の琥珀」(rogue-25): 初めて拾うと実績解除+専用ログ。
        if (f.stack.item === 'amber') {
          pushLog('巣の琥珀を見つけた! 持ち帰れば宝物になる');
          skills.maybeUnlockFeat('relic');
        }
        pickedUpIndices.add(idx);
        pickedUp = true;
      }
      if (pickedUp) {
        sfx.play('pickup');
      }
      set({
        items: items.filter((_, i) => !pickedUpIndices.has(i)),
        player: { ...player, pack: [...player.pack] },
      });
    }
  }

  /** 経路を1歩=1ターンで自動歩行。敵に気づかれた/攻撃されたら中断。 */
  async function walkPath(path: Cell[]): Promise<void> {
    const run = getRunSeq();
    traveling = true;
    set({ busy: true, reach: { cells: [], parent: new Map() }, hoverBeastId: null, hoverMarker: null });
    try {
      for (let i = 1; i < path.length; i++) {
        if (getRunSeq() !== run || get().phase !== 'play') break;
        const next = path[i];
        if (beastAt(get().beasts, cellKey(next))) break; // 起きた敵が塞いだ
        const actual = confusedStep(next); // 混乱中は逸れうる(rogue-21)
        stepPlayer(actual);
        await sleep(STEP_MS + 40);
        if (getRunSeq() !== run) return; // restart / cancelTravel された
        const interrupted = combat.beastsTurn();
        endTurn();
        if (get().phase !== 'play') break;
        if (get().skillDraft) break; // 関門ドラフトが出た(スキルモーダルで歩行中断)
        if (cellKey(actual) !== cellKey(next)) break; // 逸れたら経路は無効 — 歩行中断
        if (interrupted && i < path.length - 1) {
          pushLog('(足を止めた)');
          break;
        }
      }
      if (getRunSeq() !== run) return;
      settleAfterAction();
    } finally {
      traveling = false;
    }
  }

  const actions = {
    clickCell: (c: Cell) => {
      logAction('C', c[0], c[1], c[2]);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      if (s.uiMode === 'throw') return;
      if (s.uiMode === 'place') {
        weaveTrapAt(c);
        return;
      }
      const k = cellKey(c);
      if (!s.reach.cells.some((r) => cellKey(r) === k)) return;
      const path = pathTo(c);
      if (path.length < 2) return;
      void walkPath(path);
    },

    travelTo: (c: Cell) => {
      logAction('T', c[0], c[1], c[2]);
      const s = get();
      if (s.phase !== 'play' || s.busy || s.uiMode === 'throw') return;
      const path = findPath(c);
      if (!path) {
        pushLog('そこへは辿り着けない');
        return;
      }
      sfx.play('select');
      void walkPath(path);
    },

    travelToChamber: (id: number) => {
      logAction('TC', id);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      if (s.mapMode) get().toggleMap(); // ゲーム画面へ戻ってから歩く
      if (get().cellChamber.get(cellKey(get().player.pos)) === id) return; // もう居る
      // その広間に属するセルへ最初に踏み込むまでの最短経路 = 入り口まで。
      const path = findPathWhere((k) => get().cellChamber.get(k) === id);
      if (!path) {
        pushLog('そこへは辿り着けない');
        return;
      }
      sfx.play('select');
      void walkPath(path);
    },

    cancelTravel: () => {
      logAction('XT');
      if (!traveling) return; // 歩行中のみ。攻撃演出などの busy は巻き込まない
      bumpRunSeq(); // 進行中の walkPath ループを次のチェックで打ち切る
      traveling = false;
      sfx.play('cancel');
      pushLog('(足を止めた)');
      set({ busy: false });
      refreshReach();
    },

    wait: () => {
      logAction('W');
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      set({ uiMode: 'walk' });
      combat.beastsTurn();
      endTurn();
      settleAfterAction();
    },
  };

  return { discover, refreshReach, settleAfterAction, actions };
}
