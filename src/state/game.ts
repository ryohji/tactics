// ゲーム状態機械（it-6）。配置 → 陣営交互ターン（FE式） → リーダー撃破で勝敗。
// 盤面（terrain/arena/occluder）は store.ts の前計算を Board として参照するだけで再計算しない。
// ルールの実体は model/rules.ts・model/ai.ts の純関数。本ファイルはその編成と演出の逐次化を担う。
//
// フロー（DESIGN §11.2）:
//   deploy: 自軍ユニットを配置ゾーン内で置き直し → 出撃
//   player: ユニット選択 → 移動範囲から移動 → 行動メニュー（攻撃/スキル/待機/戻す）
//           → 対象選択 → 解決（命中ロール・反撃・演出） → 全員行動済みでターン終了
//   enemy : AI が1体ずつ順次行動（カメラフォーカス＋ディレイ）
//   over  : どちらかのリーダー撃破で victory / defeat

import { create } from 'zustand';
import { type Cell, type CellKey, cellKey, keyToCell } from '../model/fcc';
import {
  type Board,
  type Exchange,
  moveRange,
  pathTo,
  canAttackFrom,
  canUseSkill,
  exchange,
  hasFooting,
  landingCell,
  spawnAnchors,
  deployZone,
  autoDeploy,
  HEAL_AMOUNT,
  LEVITATE_TURNS,
} from '../model/rules';
import { planUnit } from '../model/ai';
import {
  type Unit,
  type Side,
  type SkillId,
  CLASSES,
  createRoster,
  isFlying,
  isLeader,
  SIDE_NAME,
} from '../model/units';
import { useStore } from './store';
import { animateUnit, clearUnitAnims, STEP_MS } from './unitAnim';
import { resetView } from './view';
import * as sfx from '../audio/sfx';

// --- 型 -------------------------------------------------------------------------

export type Phase = 'deploy' | 'player' | 'enemy' | 'victory' | 'defeat';
export type UiMode = 'idle' | 'moveSelect' | 'actionMenu' | 'targetSelect' | 'busy';
export type ActionKind = 'attack' | SkillId;

/** 戦闘・スキルの視覚エフェクトイベント（Effects.tsx が消費）。 */
export interface FxEvent {
  id: number;
  kind: 'bolt' | 'slash' | 'hit' | 'miss' | 'heal' | 'levitate' | 'death' | 'popup';
  from?: Cell;
  to?: Cell;
  at?: Cell;
  /** popup 用テキスト（"7" / "MISS" / "+6"）。 */
  text?: string;
  color?: string;
  /** 魔法弾か（bolt の色/音の分岐）。 */
  magic?: boolean;
  start: number;
  dur: number;
}

export interface GameState {
  board: Board;
  units: Unit[];
  phase: Phase;
  /** 経過ターン（自軍ターン開始ごとに+1）。 */
  turn: number;
  uiMode: UiMode;
  /** 操作対象の自軍ユニット id。 */
  selectedId: number | null;
  /** 情報パネルに出すユニット id（ホバー/敵クリック）。 */
  hoverId: number | null;
  /** 行動メニューで選んだ行動（対象選択中）。 */
  pendingAction: ActionKind | null;
  /** 移動キャンセル用の元位置。 */
  moveFrom: Cell | null;
  /** クリック可能セル（移動先/配置先）。 */
  highlight: Set<CellKey>;
  /** highlight の意味（描画色の分岐）。 */
  highlightKind: 'move' | 'deploy' | 'target' | null;
  /** 対象選択中の有効対象ユニット id。 */
  targetIds: number[];
  /** ホバー中の移動/配置マーカーのセル(同レベルのヘックスオーバーレイ表示に使う)。 */
  hoverMarker: CellKey | null;
  /** カメラフォーカス（格子座標）。 */
  focus: Cell;
  /** 配置ゾーン（deploy フェーズ中のみ意味を持つ）。 */
  playerZone: Set<CellKey>;
  log: string[];
  fx: FxEvent[];
  muted: boolean;
  /** 視点モード（自由パン）。カメラがユニット追従を離れ、任意の位置を確認できる。 */
  freeCam: boolean;

  // --- アクション ---
  rebuild: () => void;
  toggleFreeCam: () => void;
  clickUnit: (id: number) => void;
  clickCell: (c: Cell) => void;
  hoverUnit: (id: number | null) => void;
  setHoverMarker: (k: CellKey | null) => void;
  chooseAction: (a: ActionKind | 'wait' | 'cancel') => void;
  startBattle: () => void;
  endPlayerTurn: () => void;
  toggleMute: () => void;
}

// --- RNG（seed 付き LCG。テストから seedRng で固定できる） -----------------------

let rngState = (Date.now() ^ 0x9e3779b9) >>> 0;

/** テスト用に乱数列を固定する。 */
export function seedRng(seed: number): void {
  rngState = seed >>> 0;
}

function rand(): number {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
}

// --- 内部ヘルパ -------------------------------------------------------------------

let fxId = 1;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function boardFromStore(): Board {
  const s = useStore.getState();
  return {
    arenaSet: s.arenaSet,
    occluderSet: s.occluderSet,
    terrain: s.terrain,
    Lmin: s.params.Lmin,
  };
}

function aliveOf(units: readonly Unit[], side: Side): Unit[] {
  return units.filter((u) => u.alive && u.side === side);
}

/** 対象選択に入れる行動の一覧（現在位置基準）。行動メニューの活性判定に使う。 */
export function availableActions(u: Unit, units: readonly Unit[], board: Board): ActionKind[] {
  const out: ActionKind[] = [];
  const foes = units.filter((t) => t.alive && t.side !== u.side);
  if (foes.some((t) => canAttackFrom(u, u.pos, t, board.terrain))) out.push('attack');
  for (const sk of CLASSES[u.cls].skills) {
    if (units.some((t) => canUseSkill(u, u.pos, sk, t))) out.push(sk);
  }
  return out;
}

/** 対象選択のプレビュー（HUD の戦闘予測に使う）。attack 以外は null。 */
export function previewExchange(s: GameState, targetId: number): Exchange | null {
  if (s.pendingAction !== 'attack' || s.selectedId === null) return null;
  const a = s.units.find((u) => u.id === s.selectedId);
  const t = s.units.find((u) => u.id === targetId);
  if (!a || !t) return null;
  return exchange(a, a.pos, t, s.units, s.board.terrain);
}

// --- ストア本体 -------------------------------------------------------------------

export const useGame = create<GameState>((set, get) => {
  // fx を積む（期限切れの掃除も兼ねる）。
  function pushFx(e: Omit<FxEvent, 'id' | 'start'>): void {
    const now = performance.now();
    const fx = get().fx.filter((f) => f.start + f.dur > now);
    fx.push({ ...e, id: fxId++, start: now });
    set({ fx });
  }

  function pushLog(msg: string): void {
    set({ log: [...get().log.slice(-7), msg] });
  }

  function clearSelection(): void {
    set({
      selectedId: null,
      pendingAction: null,
      moveFrom: null,
      highlight: new Set(),
      highlightKind: null,
      targetIds: [],
      hoverMarker: null,
    });
  }

  /** 勝敗チェック。決着したら true。 */
  function checkGameOver(): boolean {
    const { units } = get();
    const playerLeaderDead = units.some((u) => u.side === 'player' && isLeader(u) && !u.alive);
    const enemyLeaderDead = units.some((u) => u.side === 'enemy' && isLeader(u) && !u.alive);
    if (!playerLeaderDead && !enemyLeaderDead) return false;
    const win = enemyLeaderDead;
    set({ phase: win ? 'victory' : 'defeat', uiMode: 'idle' });
    clearSelection();
    pushLog(win ? `${SIDE_NAME.enemy}のリーダーを撃破! 勝利!` : `リーダーが倒れた… 敗北`);
    sfx.play(win ? 'victory' : 'defeat');
    return true;
  }

  function applyDamage(target: Unit, dmg: number): void {
    target.hp = Math.max(0, target.hp - dmg);
    if (target.hp === 0) target.alive = false;
  }

  /** 片方向の攻撃演出＋解決。命中したか（true=命中）を返す。 */
  async function strike(attacker: Unit, defender: Unit): Promise<void> {
    const cls = CLASSES[attacker.cls];
    const ranged = Math.hypot(
      attacker.pos[0] - defender.pos[0],
      attacker.pos[1] - defender.pos[1],
      attacker.pos[2] - defender.pos[2],
    ) > 1.5;
    const ex = exchange(attacker, attacker.pos, defender, get().units, get().board.terrain);
    const fc = ex.attack;

    set({ focus: attacker.pos });
    if (ranged) {
      pushFx({ kind: 'bolt', from: attacker.pos, to: defender.pos, magic: cls.magic, dur: 300 });
      sfx.play(cls.magic ? 'magic' : 'arrow');
      await sleep(320);
    } else {
      pushFx({ kind: 'slash', at: defender.pos, dur: 220 });
      sfx.play('melee');
      await sleep(180);
    }

    const roll = Math.floor(rand() * 100);
    if (roll < fc.hit) {
      applyDamage(defender, fc.dmg);
      pushFx({ kind: 'hit', at: defender.pos, dur: 320 });
      pushFx({ kind: 'popup', at: defender.pos, text: `${fc.dmg}`, color: '#fca5a5', dur: 900 });
      sfx.play('hit');
      pushLog(
        `${attacker.name} → ${defender.name}: ${fc.dmg}ダメージ（命中${fc.hit}%${fc.cover ? '・遮蔽' : ''}${fc.height > 0 ? '・高所' : fc.height < 0 ? '・低所' : ''}）`,
      );
      set({ units: [...get().units] });
      if (!defender.alive) {
        await sleep(200);
        pushFx({ kind: 'death', at: defender.pos, dur: 700 });
        sfx.play('death');
        pushLog(`${defender.name} を撃破!`);
        set({ units: [...get().units] });
      }
    } else {
      pushFx({ kind: 'miss', at: defender.pos, dur: 500 });
      pushFx({ kind: 'popup', at: defender.pos, text: 'MISS', color: '#e2e8f0', dur: 900 });
      sfx.play('miss');
      pushLog(`${attacker.name} → ${defender.name}: 回避された（命中${fc.hit}%）`);
    }
    await sleep(360);
  }

  /** 攻撃の解決（反撃込み）。呼ぶ側が uiMode を管理する。 */
  async function resolveAttack(attackerId: number, defenderId: number): Promise<void> {
    const find = () => {
      const { units } = get();
      return {
        a: units.find((u) => u.id === attackerId),
        d: units.find((u) => u.id === defenderId),
      };
    };
    const { a, d } = find();
    if (!a || !d || !a.alive || !d.alive) return;
    await strike(a, d);
    if (checkGameOver()) return;
    // 反撃（防御側が生存し、攻撃側が射程内なら）。
    const { a: a2, d: d2 } = find();
    if (a2 && d2 && a2.alive && d2.alive && canAttackFrom(d2, d2.pos, a2, get().board.terrain)) {
      pushLog(`${d2.name} の反撃!`);
      await strike(d2, a2);
      checkGameOver();
    }
  }

  /** side 陣営のターン終了処理（浮遊の減算と降着）。 */
  function tickLevitate(side: Side): void {
    const { units, board } = get();
    for (const u of units) {
      if (!u.alive || u.side !== side || u.levitate === 0) continue;
      u.levitate -= 1;
      if (u.levitate === 0 && !CLASSES[u.cls].fly) {
        const landed = landingCell(u.pos, board, units, u.id);
        if (cellKey(landed) !== cellKey(u.pos)) {
          animateUnit(u.id, [u.pos, landed], STEP_MS * 1.6);
          u.pos = landed;
          sfx.play('land');
          pushLog(`${u.name} の浮遊が切れて降着した`);
        } else {
          pushLog(`${u.name} の浮遊が切れた`);
        }
      }
    }
    set({ units: [...units] });
  }

  /** 行動確定（acted）→ 全員行動済みなら自動でターン終了。 */
  async function finishAction(u: Unit): Promise<void> {
    u.acted = true;
    set({ units: [...get().units], uiMode: 'idle' });
    clearSelection();
    if (get().phase !== 'player') return;
    if (aliveOf(get().units, 'player').every((p) => p.acted)) {
      await sleep(450);
      if (get().phase === 'player') get().endPlayerTurn();
    }
  }

  /** 敵ターンの逐次実行。 */
  async function runEnemyTurn(): Promise<void> {
    const order = get().units.filter((u) => u.side === 'enemy');
    for (const eu of order) {
      if (get().phase !== 'enemy') return; // 決着で中断
      if (!eu.alive) continue;
      set({ focus: eu.pos });
      await sleep(420);
      const plan = planUnit(eu, get().units, get().board);
      if (plan.path.length > 1) {
        const ms = animateUnit(eu.id, plan.path);
        eu.pos = plan.path[plan.path.length - 1];
        set({ units: [...get().units], focus: eu.pos });
        sfx.play('move');
        await sleep(ms + 120);
      }
      if (plan.targetId !== null) {
        await resolveAttack(eu.id, plan.targetId);
        if (get().phase !== 'enemy') return;
      }
      eu.acted = true;
      await sleep(200);
    }
    // 敵ターン終了 → 自軍ターンへ。
    tickLevitate('enemy');
    const units = get().units;
    for (const u of units) if (u.side === 'player') u.acted = false;
    set({
      phase: 'player',
      uiMode: 'idle',
      turn: get().turn + 1,
      units: [...units],
    });
    sfx.play('turn');
    pushLog(`―― ターン${get().turn}: ${SIDE_NAME.player}の行動 ――`);
    const first = aliveOf(get().units, 'player')[0];
    if (first) set({ focus: first.pos });
  }

  /** 盤面（store）から初期状態を構築。 */
  function buildInitial(): Pick<
    GameState,
    | 'board'
    | 'units'
    | 'phase'
    | 'turn'
    | 'uiMode'
    | 'focus'
    | 'playerZone'
    | 'log'
    | 'fx'
  > {
    clearUnitAnims();
    const board = boardFromStore();
    const anchors = spawnAnchors(board);
    const player = createRoster('player', 1);
    const enemy = createRoster('enemy', 101);
    const pZone = deployZone(anchors.player, board);
    const eZone = deployZone(anchors.enemy, board);
    autoDeploy(player, anchors.player, pZone, board);
    autoDeploy(enemy, anchors.enemy, eZone, board);
    return {
      board,
      units: [...player, ...enemy],
      phase: 'deploy',
      turn: 0,
      uiMode: 'idle',
      focus: anchors.player,
      playerZone: pZone,
      log: ['配置フェーズ: 自軍ユニットを選び、紫のセルに配置し直せる。「出撃」で開戦。'],
      fx: [],
    };
  }

  return {
    ...buildInitial(),
    selectedId: null,
    hoverId: null,
    pendingAction: null,
    moveFrom: null,
    highlight: new Set<CellKey>(),
    highlightKind: null,
    targetIds: [],
    hoverMarker: null,
    muted: false,
    freeCam: false,

    rebuild: () => {
      resetView();
      set({ ...buildInitial(), freeCam: false });
      clearSelection();
    },

    toggleFreeCam: () => {
      set({ freeCam: !get().freeCam });
    },

    hoverUnit: (id) => {
      const s = get();
      if (s.hoverId === id) return;
      // 対象選択中に有効対象へ触れたらカーソル音(予測パネルが出る合図)。
      if (id !== null && s.uiMode === 'targetSelect' && s.targetIds.includes(id)) {
        sfx.play('cursor');
      }
      set({ hoverId: id });
    },

    setHoverMarker: (k) => {
      const s = get();
      if (s.hoverMarker === k) return;
      if (k !== null) sfx.play('cursor');
      set({ hoverMarker: k });
    },

    toggleMute: () => {
      const m = !get().muted;
      sfx.setMuted(m);
      set({ muted: m });
    },

    clickUnit: (id) => {
      const s = get();
      const u = s.units.find((x) => x.id === id);
      if (!u || !u.alive || s.uiMode === 'busy') return;

      // 対象選択中: 有効対象なら行動を実行。
      if (s.uiMode === 'targetSelect' && s.selectedId !== null && s.pendingAction) {
        if (!s.targetIds.includes(id)) return;
        const actor = s.units.find((x) => x.id === s.selectedId);
        if (!actor) return;
        const action = s.pendingAction;
        set({ uiMode: 'busy', highlight: new Set(), highlightKind: null, targetIds: [] });
        void (async () => {
          if (action === 'attack') {
            await resolveAttack(actor.id, id);
          } else if (action === 'heal') {
            const healed = Math.min(HEAL_AMOUNT, CLASSES[u.cls].hp - u.hp);
            u.hp += healed;
            set({ units: [...get().units] });
            pushFx({ kind: 'heal', at: u.pos, dur: 700 });
            pushFx({ kind: 'popup', at: u.pos, text: `+${healed}`, color: '#86efac', dur: 900 });
            sfx.play('heal');
            pushLog(`${actor.name} が ${u.name} を回復（+${healed}）`);
            await sleep(500);
          } else {
            u.levitate = LEVITATE_TURNS;
            set({ units: [...get().units] });
            pushFx({ kind: 'levitate', at: u.pos, dur: 900 });
            pushFx({ kind: 'popup', at: u.pos, text: '浮遊', color: '#d8b4fe', dur: 900 });
            sfx.play('levitate');
            pushLog(`${actor.name} が ${u.name} に浮遊を付与（次の自軍ターン終了まで）`);
            await sleep(500);
          }
          const alive = get().units.find((x) => x.id === actor.id);
          if (get().phase === 'player' && alive?.alive) await finishAction(alive);
        })();
        return;
      }

      // 配置フェーズ: 自軍を選ぶと配置ゾーンをハイライト。
      if (s.phase === 'deploy') {
        if (u.side !== 'player') {
          set({ hoverId: id, focus: u.pos });
          return;
        }
        sfx.play('select');
        const cells = new Set<CellKey>();
        for (const k of s.playerZone) {
          if (isFlying(u) || hasFooting(keyToCell(k), s.board)) cells.add(k);
        }
        set({ selectedId: id, focus: u.pos, highlight: cells, highlightKind: 'deploy' });
        return;
      }

      if (s.phase !== 'player') return;

      // 選択中ユニットの再クリック = 「その場で行動」（自機メッシュがセルクリックを遮るため）。
      if (s.uiMode === 'moveSelect' && s.selectedId === id) {
        get().clickCell(u.pos);
        return;
      }

      // 自軍ターン: 未行動の自軍 → 選択して移動範囲を出す。敵/行動済み → 情報フォーカスのみ。
      if (u.side === 'player' && !u.acted && (s.uiMode === 'idle' || s.uiMode === 'moveSelect')) {
        sfx.play('select');
        const range = moveRange(u, s.units, s.board);
        const cells = new Set(range.dests);
        cells.add(cellKey(u.pos)); // 現在地クリック=その場で行動
        set({
          selectedId: id,
          focus: u.pos,
          uiMode: 'moveSelect',
          highlight: cells,
          highlightKind: 'move',
          moveFrom: null,
        });
        return;
      }
      set({ hoverId: id, focus: u.pos });
    },

    clickCell: (c) => {
      const s = get();
      if (s.uiMode === 'busy' || s.selectedId === null) return;
      const k = cellKey(c);
      if (!s.highlight.has(k)) return;
      const u = s.units.find((x) => x.id === s.selectedId);
      if (!u) return;

      // 配置: 空きセルへ移動 / 味方の居るセルとは入れ替え。
      if (s.phase === 'deploy' && s.highlightKind === 'deploy') {
        const occupant = s.units.find((x) => x.alive && x.side === 'player' && x.id !== u.id && cellKey(x.pos) === k);
        if (occupant) {
          // 入れ替え: 相手が u の元セルに立てる場合のみ。
          const uOld = u.pos;
          const ok = isFlying(occupant) || hasFooting(uOld, s.board);
          if (!ok) return;
          occupant.pos = uOld;
        }
        u.pos = c;
        sfx.play('place');
        set({
          units: [...s.units],
          selectedId: null,
          highlight: new Set(),
          highlightKind: null,
          hoverMarker: null,
          focus: c,
        });
        return;
      }

      // 移動選択: 経路アニメして行動メニューへ。
      if (s.phase === 'player' && s.uiMode === 'moveSelect' && s.highlightKind === 'move') {
        const from = u.pos;
        const range = moveRange(u, s.units, s.board);
        const path = k === cellKey(from) ? [from] : pathTo(from, c, range.parent);
        const ms = animateUnit(u.id, path);
        u.pos = c;
        if (ms > 0) sfx.play('move');
        set({
          units: [...s.units],
          uiMode: 'busy',
          moveFrom: from,
          focus: c,
          highlight: new Set(),
          highlightKind: null,
          hoverMarker: null,
        });
        void (async () => {
          await sleep(ms + 60);
          if (get().phase === 'player' && get().selectedId === u.id) {
            set({ uiMode: 'actionMenu' });
          }
        })();
      }
    },

    chooseAction: (a) => {
      const s = get();
      if (s.selectedId === null) return;
      const u = s.units.find((x) => x.id === s.selectedId);
      if (!u || s.phase !== 'player') return;

      if (a === 'cancel') {
        sfx.play('cancel');
        if (s.uiMode === 'targetSelect') {
          // 対象選択 → 行動メニューへ戻る。
          set({ uiMode: 'actionMenu', pendingAction: null, targetIds: [], highlight: new Set(), highlightKind: null });
          return;
        }
        if (s.uiMode === 'actionMenu') {
          // 行動メニュー → 移動をキャンセルして選択し直し。
          if (s.moveFrom) {
            u.pos = s.moveFrom;
            clearUnitAnims();
          }
          const range = moveRange(u, s.units, s.board);
          const cells = new Set(range.dests);
          cells.add(cellKey(u.pos));
          set({
            units: [...s.units],
            uiMode: 'moveSelect',
            moveFrom: null,
            focus: u.pos,
            highlight: cells,
            highlightKind: 'move',
          });
          return;
        }
        // 移動選択中のキャンセル → 選択解除。
        clearSelection();
        set({ uiMode: 'idle' });
        return;
      }

      if (s.uiMode !== 'actionMenu') return;

      if (a === 'wait') {
        void finishAction(u);
        return;
      }

      // 攻撃/スキルの対象列挙 → 対象選択へ。
      let ids: number[] = [];
      if (a === 'attack') {
        ids = s.units
          .filter((t) => t.alive && t.side !== u.side && canAttackFrom(u, u.pos, t, s.board.terrain))
          .map((t) => t.id);
      } else {
        ids = s.units.filter((t) => canUseSkill(u, u.pos, a, t)).map((t) => t.id);
      }
      if (ids.length === 0) return;
      const cells = new Set<CellKey>();
      for (const id of ids) {
        const t = s.units.find((x) => x.id === id);
        if (t) cells.add(cellKey(t.pos));
      }
      sfx.play('select');
      set({
        uiMode: 'targetSelect',
        pendingAction: a,
        targetIds: ids,
        highlight: cells,
        highlightKind: 'target',
      });
    },

    startBattle: () => {
      const s = get();
      if (s.phase !== 'deploy') return;
      clearSelection();
      for (const u of s.units) u.acted = false;
      set({ phase: 'player', turn: 1, uiMode: 'idle', units: [...s.units] });
      sfx.play('battle');
      pushLog(`―― ターン1: ${SIDE_NAME.player}の行動 ――`);
      const leader = s.units.find((u) => u.side === 'player' && isLeader(u));
      if (leader) set({ focus: leader.pos });
    },

    endPlayerTurn: () => {
      const s = get();
      if (s.phase !== 'player' || s.uiMode === 'busy') return;
      clearSelection();
      tickLevitate('player');
      for (const u of get().units) if (u.side === 'enemy') u.acted = false;
      set({ phase: 'enemy', uiMode: 'busy', units: [...get().units] });
      sfx.play('turn');
      pushLog(`―― ${SIDE_NAME.enemy}の行動 ――`);
      void runEnemyTurn();
    },
  };
});

// 盤面（地形・アリーナ・occluder）が差し替わったらゲームを作り直す。
// d スライダやプリセット切替は「別の盤面で最初から」を意味する（デバッグ操作）。
useStore.subscribe((s, prev) => {
  if (s.arenaSet !== prev.arenaSet || s.occluderSet !== prev.occluderSet || s.terrain !== prev.terrain) {
    useGame.getState().rebuild();
  }
});
