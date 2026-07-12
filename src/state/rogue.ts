// ローグライク状態機械(rogue-1..4)。古典ローグ式「プレイヤー1行動=1ターン」。
// 行動(歩く/攻撃/投げる/飲む/設置/合成/待つ)のたびに敵が1歩動く。陣営ターンなし。
//
// フロー:
//   walk : 到達マーカー(BFS≤2歩)をクリック → 1歩ずつ自動歩行(敵に気づかれたら中断)
//          隣接する敵をクリック → 近接攻撃
//   throw: 所持品の投げナイフをクリックして入り、射程内の敵をクリックで投擲
//   dead : HP 0 で死亡 → スコア(最深到達・討伐数)表示 → 再挑戦
//
// rogue-4 のゲーム性:
//   - 明かり3段階: 広げるほど 視界↑・自然回復↑・敵の気づき距離↑(トレードオフ)
//   - アイテムは品質 q つき。同一アイテム・同一品質の2つを合成で q+1
//   - 罠(棘/火炎/幻惑/恐慌/眠り)を足元に設置。敵が踏むと即ダメ/状態異常
//   - 魔導砲塔(時限の自動砲撃)と囮人形(敵のターゲットを吸う・耐久制)
//
// ダンジョンの実体(model/dungeon.ts)は in-place 掘削なので、描画は discoveredRev を
// 変更検知キーにする。敵・宝は広間の生成時(maybeExpand)に湧く。

import { create } from 'zustand';
import { OFFSETS, cellKey, keyToCell, layer, type Cell, type CellKey } from '../model/fcc';
import {
  createDungeon,
  maybeExpand,
  slotKeyOfCell,
  lcg,
  distW,
  adjacent,
  stepDist,
  collapseAbove,
  lineOfSight,
  type Dungeon,
  type Chamber,
} from '../model/dungeon';
import * as persist from './persist';
import * as history from './history';
import * as masteryStore from './masteryStore';
import { BEASTS } from '../model/beasts';
import {
  ITEMS,
  itemLabel,
  stackHeal,
  stackBarrier,
  stackImmune,
  stackDmg,
  turretTurns,
  decoyHp,
  type ItemStack,
} from '../model/loot';
import { animateUnit, clearUnitAnims, STEP_MS } from './unitAnim';
import { view, resetView, setGazeGoal, clearGazeGoal } from './view';
import * as sfx from '../audio/sfx';
import * as bgm from '../audio/bgm';
import { triggerPose } from './playerPose';
import {
  ROGUE_S,
  PLAYER_ID,
  REACH_STEPS,
  EXPAND_R,
  STRATUM_DEPTH,
  GAME_VERSION,
  LIGHT,
  isDimLight,
  type LightLevel,
  type Beast,
  type GroundItem,
  type PlacedTrap,
  type Turret,
  type Decoy,
  type RogueFx,
  type PlayerState,
  type SaveData,
  type ActionLogEntry,
} from '../model/rogue/types';
import {
  BURN_DMG,
  depthOf,
  beastAt,
  playerAtk,
  weaponReach,
  weaponSweep,
  placeableCells,
  gazeAngles,
  isoDate,
  dailySeed,
} from '../model/rogue/rules';
import {
  MASTERY_NAME,
  SKILL_NODES,
  COUNTER_NODES,
  masteryLevels,
  unlockedNodes,
  equippedCost,
  draftCandidates,
  type MasterySystem,
  type MasteryCounters,
  type NodeId,
} from '../model/rogue/mastery';
import { discoverInto } from '../model/rogue/visibility';
import {
  computeReach as computeReachPure,
  findPath as findPathPure,
  findPathWhere as findPathWherePure,
  pathFromReach,
  type Reach,
} from '../model/rogue/reach';
import {
  beastStrike as beastStrikeCalc,
  beastStrikeDecoy as beastStrikeDecoyCalc,
  damageEvents,
  resolveTrapEffect,
  statusAppliedEvents,
  turretTarget,
  absorbBarrier,
} from '../model/rogue/combat';
import {
  stepCandidates as stepCandidatesPure,
  checkAggro,
  chooseTarget,
  chooseFleeStep,
  outOfTerritory,
  chooseChaseStep,
} from '../model/rogue/beastAI';
import { spawnChamber } from '../model/rogue/spawn';
import type { GameEvent } from '../model/rogue/types';

// ドメイン型・純ヘルパは model/rogue/ へ分離(rogue-17)。既存の import 先を
// 保つためここから再輸出する。
export {
  ROGUE_S,
  PLAYER_ID,
  REACH_STEPS,
  STRATUM_DEPTH,
  GAME_VERSION,
  LIGHT,
} from '../model/rogue/types';
export type {
  LightLevel,
  Beast,
  BeastStatus,
  GroundItem,
  PlacedTrap,
  Turret,
  Decoy,
  RogueFx,
  PlayerState,
  SaveData,
  ActionLogEntry,
} from '../model/rogue/types';
export {
  depthOf,
  playerAtk,
  playerDef,
  playerEvade,
  weaponReach,
  weaponSweep,
  placeableCells,
  gazeAngles,
  clearedChambers,
  isoDate,
  dailySeed,
} from '../model/rogue/rules';
export { parseSeed } from '../model/rogue/rules';
// マスタリー・スキルノード(rogue-23)は HUD が直接参照するのでここから再輸出する。
export {
  MASTERY_NAME,
  SKILL_NODES,
  NODE_IDS,
  masteryLevels,
  unlockedNodes,
  equippedCost,
} from '../model/rogue/mastery';
export type { MasterySystem, MasteryCounters, NodeId, SkillNode } from '../model/rogue/mastery';
export { readMastery } from './masteryStore';

export interface RogueState {
  seed: number;
  dungeon: Dungeon;
  discovered: Set<CellKey>;
  /** discovered が増えるたびに +1(シェル再構築のキー)。 */
  discoveredRev: number;
  /** セル → 広間 id(通路セルは載らない)。 */
  cellChamber: Map<CellKey, number>;
  /** 訪問済みの広間 id。 */
  visitedChambers: Set<number>;
  /** 訪問/掃討の状態が変わるたびに +1(壁色の再構築キー)。 */
  exploreRev: number;
  player: PlayerState;
  /** 明かりの段階(0=絞る/1=普通/2=広げる)。 */
  lightLevel: LightLevel;
  beasts: Beast[];
  items: GroundItem[];
  traps: PlacedTrap[];
  turrets: Turret[];
  decoys: Decoy[];
  turn: number;
  kills: number;
  maxDepth: number;
  /** 通過済みの層数(rogue-19b)。深度 STRATUM_DEPTH*(stratum+1)+2 で次の崩落。 */
  stratum: number;
  /** スキルスロット数(rogue-23。初期2・関門+1・上限6)。 */
  skillSlots: number;
  /** 装着中のスキルノード id 列(コスト合計 ≤ skillSlots)。 */
  skillEquipped: NodeId[];
  /** 関門で提示中のドラフト候補(null=非表示)。 */
  skillDraft: NodeId[] | null;
  /** ラン開始直後の「支度」(自由装着)モード中か。 */
  skillOutfitting: boolean;
  phase: 'play' | 'dead';
  busy: boolean;
  /** walk=移動 / throw=投擲対象選択 / place=罠の設置先選択(足元+隣接)。 */
  uiMode: 'walk' | 'throw' | 'place';
  /** place モードで設置しようとしている所持品 index。 */
  placeIndex: number | null;
  /** クリック可能な移動先(BFS≤REACH_STEPS)。 */
  reach: { cells: Cell[]; parent: Map<CellKey, CellKey> };
  /** ホバー中の移動マーカーのセル(同レベルのヘックスオーバーレイ表示に使う)。 */
  hoverMarker: CellKey | null;
  /** HUD に情報を出す敵 id(ホバー)。 */
  hoverBeastId: number | null;
  focus: Cell;
  /** マップモード(カット無しで巣全体を俯瞰。ゲーム画面とトグル)。 */
  mapMode: boolean;
  /** マップの TAB 巡回でフォーカス中の広間 id(プレイヤー位置のときは null)。 */
  mapFocusChamber: number | null;
  muted: boolean;
  /** ポストエフェクト(ブルーム等)。重い/表示が崩れる環境向けに切れるようにする。 */
  postFx: boolean;
  /** 死因(とどめを刺した敵の名前)。X へのポストに載せる。 */
  deathCause: string | null;
  log: string[];
  fx: RogueFx[];

  /** keepSave はモジュール初期化用(起動時の仮ゲームで保存を消さない)。 */
  restart: (seed?: number, opts?: { keepSave?: boolean }) => void;
  /** 保存された冒険(persist.ts の自動保存)を再開する。成功で true。 */
  resume: () => boolean;
  clickCell: (c: Cell) => void;
  clickBeast: (id: number) => void;
  useItem: (index: number) => void;
  /** 同一アイテム・同一品質の2つを合成して品質 +1(1ターン)。 */
  mergeItem: (index: number) => void;
  /** 装備を外して所持品へ戻す(装備と同じくターン消費なし。合成の材料にできる)。 */
  unequip: (slot: 'weapon' | 'armor' | 'shield') => void;
  /**
   * スキルノードを装着する(rogue-23)。「支度」中は解禁済みノードから、関門の
   * ドラフト中は提示された3候補から。コストが空きスロットを超える場合は無視する。
   * ドラフト中に選ぶと、その場で skillDraft を閉じる(1つ選んだら終わり)。
   */
  equipSkill: (id: NodeId) => void;
  /** 装着中のスキルノードを外す(「支度」中/ドラフト中のみ。組み替えの自由枠)。 */
  unequipSkill: (id: NodeId) => void;
  /** 遠隔回収(rogue-24: 罠師 wanaKaishu)。設置済みの自分の罠をクリックで回収(1ターン)。 */
  recoverTrap: (id: number) => void;
  /** 「支度」を終えてそのまま潜る。 */
  finishOutfitting: () => void;
  /** 関門のドラフトを見送る(何も選ばず閉じる)。 */
  skipDraft: () => void;
  /** 明かりの段階を巡回(絞る→普通→広げる)。ターンを消費しない。 */
  cycleLight: () => void;
  wait: () => void;
  cancelThrow: () => void;
  /** 発見済みセルへのファストトラベル(1歩=1ターンの自動歩行。敵の覚醒/被弾で中断)。 */
  travelTo: (c: Cell) => void;
  /** 進行中のファストトラベルを中断する(タップ/クリック/ESC)。歩行中でなければ無視。 */
  cancelTravel: () => void;
  setHoverMarker: (k: CellKey | null) => void;
  /** タッチの2段階操作: 1度目のタップで選択された対象のキー("cell:…"/"beast:…"/"bubble:…")。 */
  armedKey: string | null;
  setArmed: (key: string | null) => void;
  hoverBeast: (id: number | null) => void;
  /** マップモードの切替(M キー / HUD ボタン)。 */
  toggleMap: () => void;
  /** TAB: ゲーム=部屋内の敵へ視線を巡回 / マップ=訪問済み広間の中央を巡回。
      dir=-1(Shift+TAB)で逆順。 */
  cycleTarget: (dir?: 1 | -1) => void;
  /** マップから: その広間の入り口(経路上で最初に踏む広間セル)までファストトラベル。 */
  travelToChamber: (id: number) => void;
  toggleMute: () => void;
  togglePostFx: () => void;
}

// --- セーブデータ -----------------------------------------------------------------

// --- RNG(戦闘分散用。ダンジョン生成は dungeon.rng) --------------------------------

let rngState = (Date.now() ^ 0x2f6e2b1) >>> 0;

/** 戦闘乱数列を固定する(restart がシードから呼ぶ。テストは restart 後に上書き)。 */
export function seedRogueRng(seed: number): void {
  rngState = seed >>> 0;
}

function rand(): number {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
}

/** a..b の整数(両端含む)。 */
function irnd(a: number, b: number): number {
  return a + Math.floor(rand() * (b - a + 1));
}

// --- 内部ヘルパ -------------------------------------------------------------------

let fxId = 1;
let beastSeq = 1;
let itemSeq = 1;
let deviceSeq = 1;
// TAB 巡回の現在位置(リアクティブである必要がないのでモジュール変数)。
let beastCycleIdx = -1;
let chamberCycleIdx = -1;
// リスタート世代。await を跨ぐ非同期処理(自動歩行・攻撃演出)が、restart 後に
// 古い経路のまま新しいダンジョンを触らないよう、世代が変わったら打ち切る。
let runSeq = 0;
// ファストトラベル(walkPath)が進行中か。cancelTravel はこのときだけ runSeq を進めて
// 打ち切る(攻撃演出など他の busy 処理を巻き込まないためのガード)。
let traveling = false;
// 現在の層で「もうすぐ崩落する」警告を出したか(層ごとに restart/崩落でリセット)。
let stratumWarned = false;
// 行動ログ(rogue-19b)。将来の再生器(rogue-26)向けの記録のみ。restart でリセット。
let actionLog: ActionLogEntry[] = [];

// 演出待ちの時間スケール(既定1)。シミュレータ(rogue-19a)が待ち時間だけを
// 詰めて headless 高速実行するためのフック。挙動・乱数列には影響しない。
let timeScale = 1;

/** テスト/シミュレータ用: 演出待ちの時間スケールを変える。scale=0 で実質即解決。 */
export function setTimeScaleForTest(scale: number): void {
  timeScale = scale;
}

/** テスト用: 現在の行動ログを読む(rogue-19b。actionLog はモジュール変数で外から見えないため)。 */
export function getActionLogForTest(): readonly ActionLogEntry[] {
  return actionLog;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms * timeScale));
}

// --- ストア本体 -------------------------------------------------------------------

export const useRogue = create<RogueState>((set, get) => {
  function pushFx(e: Omit<RogueFx, 'id' | 'start'>): void {
    const now = performance.now();
    const fx = get().fx.filter((f) => f.start + f.dur > now);
    fx.push({ ...e, id: fxId++, start: now });
    set({ fx });
  }

  function pushLog(msg: string): void {
    set({ log: [...get().log.slice(-7), msg] });
  }

  /** 状態を変えるアクションの入口で呼ぶ(将来の再生器 rogue-26 向けの記録のみ)。 */
  function logAction(code: string, ...args: (number | string)[]): void {
    actionLog.push([get().turn, code, ...args]);
  }

  /** model/rogue/combat.ts など純関数が返す GameEvent[] をまとめて実行する。 */
  function applyEvents(events: readonly GameEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case 'log':
          pushLog(e.msg);
          break;
        case 'sfx':
          sfx.play(e.name);
          break;
        case 'fx':
          pushFx(e.fx);
          break;
        case 'anim':
          animateUnit(e.unit, e.path);
          break;
        case 'playerDied':
          set({ deathCause: e.cause });
          break;
        case 'exploreRev':
          set({ exploreRev: get().exploreRev + 1 });
          break;
      }
    }
  }

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
      () => beastSeq++,
      () => itemSeq++,
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

  /** 「支度」パネルか関門ドラフトが開いている(rogue-23。ゲーム操作をブロックする)。 */
  function skillModalOpen(): boolean {
    const s = get();
    return s.skillOutfitting || s.skillDraft !== null;
  }

  function refreshReach(): void {
    // 到達範囲が変わる=状況が動いた。タッチの2段階選択(armedKey)も解除する。
    // スキルモーダル表示中は移動マーカーを出さない(操作ブロック)。
    set({ reach: skillModalOpen() ? { cells: [], parent: new Map() } : computeReach(), armedKey: null });
  }

  /**
   * 1ターン分のアクション末尾で busy/reach を締めくくる共通処理。スキルモーダルが
   * 開いていれば busy を true のまま維持し(ゲーム操作をブロック)、そうでなければ
   * false に戻す。
   */
  function settleAfterAction(): void {
    set({ busy: skillModalOpen() });
    refreshReach();
  }

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
  }

  /** 現在のマスタリーで解禁済みかつ未装着のノード id 列。 */
  function undraftedUnlockedNodes(): NodeId[] {
    const levels = masteryLevels(masteryStore.readMastery());
    const equipped = get().skillEquipped;
    return unlockedNodes(levels).filter((id) => !equipped.includes(id));
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
   * ローカルスコアボード(rogue-20)へ今回のランを記録する。自己ベスト更新ならログを出す。
   * endTurn の末尾(ターン数が確定した後)から、死亡直後の1回だけ呼ぶ
   * — checkDead は beastsTurn の途中(endTurn の turn++ より前)で走るため、
   * ここで直接呼ぶと死亡画面に表示される turn 数と1つずれる。
   */
  function recordRun(): void {
    const s = get();
    const prevBest = history.readHistory().reduce((max, r) => Math.max(max, r.maxDepth), 0);
    history.appendRun({
      v: GAME_VERSION,
      seed: s.seed,
      date: isoDate(new Date()),
      turns: s.turn,
      kills: s.kills,
      maxDepth: s.maxDepth,
      stratum: s.stratum,
      deathCause: s.deathCause ?? '不明',
      daily: s.seed === dailySeed(new Date()),
      skills: s.skillEquipped,
    });
    if (s.maxDepth > prevBest) pushLog('自己ベスト更新!');
  }

  function checkDead(): boolean {
    const { player } = get();
    if (player.hp > 0) return false;
    set({ phase: 'dead', busy: false, reach: { cells: [], parent: new Map() } });
    persist.clearSave(); // ローグライクの掟: 死んだ冒険は再開できない
    bgm.setBgmScene('dead');
    sfx.play('defeat');
    pushLog('力尽きた…');
    return true;
  }

  /** 敵→プレイヤーの一撃(ranged=true は遠隔攻撃。掲盾の回避対象)。 */
  function beastStrike(b: Beast, ranged = false): void {
    const { player, skillEquipped } = get();
    const def = BEASTS[b.kind];
    const { dmg: rawDmg, events, status } = beastStrikeCalc(b, player, rand, skillEquipped, ranged);
    if (rawDmg === 0) {
      // 盾の回避成功(rogue-22)。マスタリー(盾=回避)を積む(rogue-23)。
      incrementMastery({ evades: 1 });
      applyEvents(events);
      // 受け反撃(ukekaeshi・rogue-23)/ 見切り(kenMikiri・rogue-24: 素手時): 固定値の反撃。
      if (
        skillEquipped.includes('ukekaeshi') ||
        (skillEquipped.includes('kenMikiri') && player.weapon === null)
      ) {
        const counter = Math.floor(playerAtk(player, skillEquipped, get().lightLevel) / 2);
        if (counter > 0) {
          pushLog('受け流しざま反撃した!');
          damageBeast(b, counter, '#93c5fd'); // 武技(討伐)マスタリーの対象外(近接/薙ぎ/投擲のみ)
          set({ beasts: [...get().beasts] });
        }
      }
      set({ player: { ...player } });
      checkDead();
      return;
    }
    // 硬化(kouka・rogue-23): 障壁が1以上ある間、被ダメージ−1(最低1。absorbBarrier前)。
    let dmg = rawDmg;
    if (player.barrier > 0 && skillEquipped.includes('kouka')) dmg = Math.max(1, dmg - 1);
    // 障壁がまず削れ、余りが HP へ(酸は障壁への削りだけ2倍)。
    const hadBarrierAmt = player.barrier;
    const { barrier, hpDmg } = absorbBarrier(hadBarrierAmt, dmg, !!def.acidBarrier);
    if (hadBarrierAmt - barrier > 0) incrementMastery({ absorbed: hadBarrierAmt - barrier }); // 甲殻マスタリー
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
   * 罠1つを b に対して発動する(rogue-24 で triggerTrap から分離)。
   * wanaTsuyoka(罠強化)装着中は品質+1相当で効く。
   */
  function fireTrap(t: PlacedTrap, b: Beast): void {
    const name = BEASTS[b.kind].name;
    const qBonus = get().skillEquipped.includes('wanaTsuyoka') ? 1 : 0;
    const stack: ItemStack = { item: t.item, q: t.q + qBonus };
    sfx.play('hit');
    const effect = resolveTrapEffect(t.kind, stack);
    if (effect.kind === 'damage') {
      pushLog(
        t.kind === 'spike'
          ? `${name} が棘の罠を踏んだ!`
          : `${name} が火炎の罠を踏んだ! 延焼した`,
      );
      if (!damageBeast(b, effect.dmg, effect.color, { viaTrap: true }) && effect.burnOnSurvive) {
        b.status = effect.burnOnSurvive;
      }
    } else {
      b.status = effect.status;
      if (effect.awaken) b.awake = true;
      applyEvents(statusAppliedEvents(name, b.pos, effect.status));
    }
  }

  /** b が今のセルの罠を踏んだら発動(罠は消費)。連鎖(wanaRensa)は隣接罠を1ホップ誘爆。 */
  function triggerTrap(b: Beast): void {
    const { traps } = get();
    const k = cellKey(b.pos);
    const t = traps.find((x) => cellKey(x.pos) === k);
    if (!t) return;
    // 連鎖の誘爆対象は「発動前に隣接していた自分の罠」を先に確定する(1ホップ限定)。
    const chained = get().skillEquipped.includes('wanaRensa')
      ? traps.filter((x) => x.id !== t.id && adjacent(x.pos, t.pos))
      : [];
    set({ traps: traps.filter((x) => x.id !== t.id && !chained.some((c) => c.id === x.id)) });
    fireTrap(t, b);
    for (const c of chained) {
      // 誘爆はその罠のセルに居る敵へ。誰も踏んでいなければ空振り(消費のみ)。
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
      const aggroFactor = get().skillEquipped.includes('shinShinobi') ? 0.8 : 1; // 忍び足
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

      const territoryFactor = get().skillEquipped.includes('shinKehai') ? 0.75 : 1; // 気配遮断
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

  /** ターン経過の帳尻(ターン数・自然回復)。明かりが強いほど回復が早い。 */
  function endTurn(): void {
    const turn = get().turn + 1;
    const { player, lightLevel, skillEquipped } = get();
    // 篝火(hiKagari・rogue-24): 「広げる」中は回復間隔−1(最低2)。
    const regenEvery =
      lightLevel === 2 && get().skillEquipped.includes('hiKagari')
        ? Math.max(2, LIGHT[lightLevel].regenEvery - 1)
        : LIGHT[lightLevel].regenEvery;
    if (turn % regenEvery === 0 && player.hp > 0) {
      if (player.hp < player.maxHp) {
        player.hp += 1;
        set({ player: { ...player } });
      } else if (skillEquipped.includes('tenka') && player.barrier < 24) {
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
    if (get().phase === 'dead') recordRun();
  }

  /** place モード: 選んだセル(足元+隣接)へ罠を設置する(1ターン)。 */
  function placeTrapAt(c: Cell): void {
    const s = get();
    if (s.placeIndex === null) return;
    const stack = s.player.pack[s.placeIndex];
    if (!stack || ITEMS[stack.item].kind !== 'trap') {
      set({ uiMode: 'walk', placeIndex: null }); // pack が変わって指し先が壊れた
      return;
    }
    const k = cellKey(c);
    if (!placeableCells(s).some((x) => cellKey(x) === k)) return;
    const player = s.player;
    player.pack.splice(s.placeIndex, 1);
    set({
      traps: [
        ...s.traps,
        { id: deviceSeq++, item: stack.item, kind: ITEMS[stack.item].trap!, q: stack.q, pos: c },
      ],
      player: { ...player, pack: [...player.pack] },
      uiMode: 'walk',
      placeIndex: null,
    });
    sfx.play('place');
    pushLog(`${itemLabel(stack)} を設置した`);
    beastsTurn();
    endTurn();
    settleAfterAction();
  }

  /** 毎ターン終わりの自動保存(死んでいたら保存しない。死亡時は checkDead が破棄済み)。 */
  function autoSave(): void {
    const s = get();
    if (s.phase !== 'play') return;
    const data: SaveData = {
      v: 6,
      seed: s.seed,
      rng: rngState,
      seqs: { beast: beastSeq, item: itemSeq, device: deviceSeq },
      dungeon: {
        open: [...s.dungeon.open],
        chambers: s.dungeon.chambers,
        stubs: s.dungeon.stubs,
        rev: s.dungeon.rev,
        cutLayer: s.dungeon.cutLayer,
      },
      discovered: [...s.discovered],
      cellChamber: [...s.cellChamber],
      visitedChambers: [...s.visitedChambers],
      player: s.player,
      lightLevel: s.lightLevel,
      beasts: s.beasts,
      items: s.items,
      traps: s.traps,
      turrets: s.turrets,
      decoys: s.decoys,
      turn: s.turn,
      kills: s.kills,
      maxDepth: s.maxDepth,
      stratum: s.stratum,
      skillSlots: s.skillSlots,
      skillEquipped: s.skillEquipped,
      skillDraft: s.skillDraft,
      actionLog,
      log: s.log.slice(-8),
    };
    persist.writeSave(data);
  }

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
    set({
      discovered: new Set([...s.discovered].filter(alive)),
      discoveredRev: s.discoveredRev + 1,
      cellChamber: new Map([...s.cellChamber].filter(([k]) => alive(k))),
      items: s.items.filter((i) => layer(i.pos) <= cutLayer),
      traps: s.traps.filter((t) => layer(t.pos) <= cutLayer),
      turrets: s.turrets.filter((t) => layer(t.pos) <= cutLayer),
      decoys: s.decoys.filter((d) => layer(d.pos) <= cutLayer),
      beasts: s.beasts.filter((b) => layer(b.pos) <= cutLayer),
      stratum: stratum + 1,
      exploreRev: s.exploreRev + 1,
    });
    pushLog('背後で巣が崩れ落ちた。もう戻れない —');
    // 灯火マスタリー(rogue-24): 「絞る」以下の暗さで関門を通過した実績。
    if (isDimLight(get().lightLevel)) incrementMastery({ dimCollapses: 1 });
    // 崩落の衝撃で障壁は剥がれる(rogue-21。層を跨いだ持ち越しをさせない)。
    const p = get().player;
    if (p.barrier > 0) {
      p.barrier = 0;
      set({ player: { ...p } });
      pushLog('崩落の衝撃で障壁が剥がれた。');
    }
    sfx.play('death');
    stratumWarned = false;

    // 関門(rogue-23): スロット+1(上限6)。解禁済み・未装着のノードから乱数3択
    // (シード列 rand から引く)。候補ゼロなら乱数を引かず、ドラフトも出さない
    // — マスタリー未育成のプレイヤーとゴールデンテストの経路で乱数列を守る。
    const newSlots = Math.min(6, get().skillSlots + 1);
    const draft = draftCandidates(undraftedUnlockedNodes(), rand, 3);
    set({ skillSlots: newSlots, skillDraft: draft.length > 0 ? draft : null });
    if (draft.length > 0) pushLog('関門の先へ進む前に、新たな心得を選べる。');

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
    set({
      player: { ...player },
      focus: next,
      maxDepth: Math.max(get().maxDepth, depthOf(next)),
    });
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
    const found = items.filter((i) => cellKey(i.pos) === k);
    if (found.length > 0) {
      for (const f of found) {
        player.pack.push(f.stack);
        pushFx({ kind: 'popup', at: next, text: itemLabel(f.stack), color: '#fde68a', dur: 900 });
        pushLog(`${itemLabel(f.stack)} を拾った`);
      }
      sfx.play('pickup');
      set({
        items: items.filter((i) => cellKey(i.pos) !== k),
        player: { ...player, pack: [...player.pack] },
      });
    }
  }

  /** 経路を1歩=1ターンで自動歩行。敵に気づかれた/攻撃されたら中断。 */
  async function walkPath(path: Cell[]): Promise<void> {
    const run = runSeq;
    traveling = true;
    set({ busy: true, reach: { cells: [], parent: new Map() }, hoverBeastId: null, hoverMarker: null });
    try {
      for (let i = 1; i < path.length; i++) {
        if (runSeq !== run || get().phase !== 'play') break;
        const next = path[i];
        if (beastAt(get().beasts, cellKey(next))) break; // 起きた敵が塞いだ
        const actual = confusedStep(next); // 混乱中は逸れうる(rogue-21)
        stepPlayer(actual);
        await sleep(STEP_MS + 40);
        if (runSeq !== run) return; // restart / cancelTravel された
        const interrupted = beastsTurn();
        endTurn();
        if (get().phase !== 'play') break;
        if (get().skillDraft) break; // 関門ドラフトが出た(スキルモーダルで歩行中断)
        if (cellKey(actual) !== cellKey(next)) break; // 逸れたら経路は無効 — 歩行中断
        if (interrupted && i < path.length - 1) {
          pushLog('(足を止めた)');
          break;
        }
      }
      if (runSeq !== run) return;
      settleAfterAction();
    } finally {
      traveling = false;
    }
  }

  /** プレイヤー→敵の近接攻撃。 */
  /** 近接攻撃。薙ぎ払い武器はリーチ内の敵全員に、通常はクリックした1体に当たる。 */
  async function meleeAttack(clicked: Beast): Promise<void> {
    const run = runSeq;
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
    if (runSeq !== run) return;
    for (const b of targets) {
      const def = BEASTS[b.kind];
      const skills = get().skillEquipped;
      // 攻撃前の覚醒状態を捕捉(rogue-24)— 背討ちの倍率と隠密マスタリーの両方がこの値を使う。
      const preAwake = b.awake;
      let dmg = Math.max(1, playerAtk(player, skills, get().lightLevel) - (b.defOverride ?? def.def) + irnd(-1, 1));
      // 背討ち(shinSegiri): 未覚醒の敵へは×2。ただし気配感知(senses)の敵には無効。
      if (!preAwake && !def.senses && skills.includes('shinSegiri')) {
        dmg *= 2;
        pushLog('背後から急所を突いた!');
      }
      b.awake = true;
      pushLog(`${def.name} に ${dmg}ダメージ`);
      const unarmed = player.weapon === null;
      const died = damageBeast(b, dmg, '#fecaca', { weapon: !unarmed, unarmed, preAwake });
      // 延焼の刃(hiEnjin): 装着中のみ乱数を引く(30%で延焼2ターン)。倒した敵には不要。
      if (!died && skills.includes('hiEnjin') && rand() < 0.3) {
        b.status = { kind: 'burn', turns: 2 };
        pushLog(`${def.name} に火が移った!`);
      }
    }
    sfx.play('hit');
    set({ beasts: [...get().beasts] });
    await sleep(240);
    if (runSeq !== run) return;
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
    // 門番討伐(rogue-24): 心得の器(スキルスロット)が広がる。
    if (BEASTS[b.kind].gatekeeper && get().skillSlots < 6) {
      set({ skillSlots: get().skillSlots + 1 });
      pushLog('門番を討った — 心得の器が広がる(スロット+1)');
      sfx.play('pickup');
    }
    // マスタリー加算(rogue-24)。1回の討伐で複数系統に同時加算されうる
    // (例: 素手で未覚醒の敵を倒す → 拳闘+隠密)。
    if (ctx) {
      const delta: Partial<MasteryCounters> = {};
      if (ctx.weapon) delta.weaponKills = 1;
      if (ctx.unarmed) delta.fistKills = 1;
      if (ctx.preAwake === false) delta.stealthKills = 1;
      if (ctx.viaTrap) delta.trapKills = 1;
      if (Object.keys(delta).length > 0) incrementMastery(delta);
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
      get().items.push({ id: itemSeq++, stack: b.carry, pos: b.pos });
      set({ items: [...get().items] });
    }
  }

  /** 投げナイフ。 */
  async function throwKnife(b: Beast): Promise<void> {
    const run = runSeq;
    const { player } = get();
    const idx = player.pack.findIndex((x) => x.item === 'knife');
    if (idx < 0) return;
    const knife = player.pack[idx];
    triggerPose('throw', 500); // プレイヤーモデルの投擲モーション
    set({ busy: true, uiMode: 'walk', reach: { cells: [], parent: new Map() } });
    player.pack.splice(idx, 1);
    set({ player: { ...player, pack: [...player.pack] } });
    pushFx({ kind: 'bolt', from: player.pos, to: b.pos, dur: 260 });
    sfx.play('arrow');
    await sleep(280);
    if (runSeq !== run) return;
    const def = BEASTS[b.kind];
    const dmg = Math.max(1, stackDmg(knife) - Math.floor((b.defOverride ?? def.def) / 2) + irnd(-1, 1));
    b.awake = true;
    sfx.play('hit');
    pushLog(`投げナイフが ${def.name} に ${dmg}ダメージ`);
    const preAwakeKnife = b.awake;
    const diedByKnife = damageBeast(b, dmg, '#fecaca', { weapon: true, preAwake: preAwakeKnife });
    // 跳弾(knifeRico): 命中時、対象に隣接する敵1体(最小id)へ半分ダメージ(乱数なし)。
    if (get().skillEquipped.includes('knifeRico')) {
      const near = get()
        .beasts.filter((x) => x.alive && x.id !== b.id && adjacent(x.pos, b.pos))
        .sort((a, z) => a.id - z.id)[0];
      if (near) {
        const rico = Math.floor(dmg / 2);
        if (rico > 0) {
          pushLog(`ナイフが跳ねて ${BEASTS[near.kind].name} へ!`);
          const preAwakeNear = near.awake;
          near.awake = true;
          damageBeast(near, rico, '#fecaca', { weapon: true, preAwake: preAwakeNear });
        }
      }
    }
    void diedByKnife;
    set({ beasts: [...get().beasts] });
    await sleep(200);
    if (runSeq !== run) return;
    beastsTurn();
    endTurn();
    settleAfterAction();
  }

  function buildInitial(seed: number): Pick<
    RogueState,
    | 'seed' | 'dungeon' | 'discovered' | 'discoveredRev' | 'player' | 'beasts' | 'items'
    | 'traps' | 'turrets' | 'decoys' | 'lightLevel'
    | 'turn' | 'kills' | 'maxDepth' | 'stratum' | 'phase' | 'busy' | 'uiMode' | 'placeIndex' | 'reach'
    | 'hoverMarker' | 'hoverBeastId' | 'armedKey' | 'focus' | 'log' | 'fx'
    | 'cellChamber' | 'visitedChambers' | 'exploreRev' | 'deathCause'
    | 'skillSlots' | 'skillEquipped' | 'skillDraft' | 'skillOutfitting'
  > {
    clearUnitAnims();
    runSeq++;
    beastSeq = 1;
    itemSeq = 1;
    deviceSeq = 1;
    // 支度(rogue-23): 解禁済みノードが1つ以上あればラン開始直後に自由装着パネルを開く
    // (マスタリー未育成の初回プレイヤーには出ない)。開いている間はゲーム操作をブロック。
    // skillEquipped はこの直後に空へリセットするので、ここでは絞り込まず単純に見る。
    const outfitting = unlockedNodes(masteryLevels(masteryStore.readMastery())).length > 0;
    const dungeon = createDungeon(seed);
    // 入口に水薬をひとつ(手触り確認と「拾える」ことの提示)。
    const entrance = dungeon.chambers[0];
    const spot = entrance.cells.find((k) => k !== cellKey(entrance.center));
    const items: GroundItem[] = spot
      ? [{ id: itemSeq++, stack: { item: 'potion', q: 0 }, pos: keyToCell(spot) }]
      : [];
    const cellChamber = new Map<CellKey, number>();
    for (const k of entrance.cells) cellChamber.set(k, entrance.id);
    return {
      seed,
      dungeon,
      discovered: new Set<CellKey>(),
      discoveredRev: 0,
      cellChamber,
      visitedChambers: new Set<number>([entrance.id]),
      exploreRev: 0,
      deathCause: null,
      player: {
        pos: [0, 0, 0],
        hp: 24,
        maxHp: 24,
        weapon: { item: 'dagger', q: 0 },
        armor: null,
        shield: null,
        barrier: 0,
        status: null,
        immune: 0,
        pack: [
          { item: 'potion', q: 0 },
          { item: 'knife', q: 0 },
          { item: 'knife', q: 0 },
          { item: 'trapSpike', q: 0 },
        ],
      },
      lightLevel: 1,
      beasts: [],
      items,
      traps: [],
      turrets: [],
      decoys: [],
      turn: 0,
      kills: 0,
      maxDepth: 0,
      stratum: 0,
      skillSlots: 2,
      skillEquipped: [],
      skillDraft: null,
      skillOutfitting: outfitting,
      phase: 'play',
      busy: outfitting, // 支度パネルが開いている間はゲーム操作をブロック
      uiMode: 'walk',
      placeIndex: null,
      reach: { cells: [], parent: new Map() },
      hoverMarker: null,
      hoverBeastId: null,
      armedKey: null,
      focus: [0, 0, 0],
      log: ['蟻巣迷宮に踏み込んだ。青いマーカーで移動、隣接した敵はクリックで攻撃。'],
      fx: [],
    };
  }

  const initialSeed = Math.floor(Math.random() * 0x7fffffff);

  return {
    ...buildInitial(initialSeed),
    mapMode: false,
    mapFocusChamber: null,
    muted: false,
    postFx: true,

    restart: (seed, opts) => {
      const s = seed ?? Math.floor(Math.random() * 0x7fffffff);
      resetView();
      beastCycleIdx = -1;
      chamberCycleIdx = -1;
      stratumWarned = false;
      actionLog = [];
      if (!opts?.keepSave) persist.clearSave(); // 新しい冒険を始めたら前の保存は破棄
      bgm.setBgmScene('game');
      bgm.setBgmDepth(0);
      // 戦闘乱数もシードから初期化(迷宮生成の cellRng と合わせてプレイを再現可能に)。
      seedRogueRng((s ^ 0x6d2b79f5) >>> 0);
      set({
        ...buildInitial(s),
        mapMode: false,
        mapFocusChamber: null,
      });
      discoverInit(); // 初期位置の明かりと到達範囲
    },

    resume: () => {
      const d = persist.readSave<SaveData>();
      if (!d || d.v !== 6) return false;
      resetView();
      clearUnitAnims();
      runSeq++; // 進行中の自動歩行などを打ち切る
      beastCycleIdx = -1;
      chamberCycleIdx = -1;
      stratumWarned = false; // 保存には無い(層の途中で境界近くなら再掲されるだけ)
      actionLog = d.actionLog;
      beastSeq = d.seqs.beast;
      itemSeq = d.seqs.item;
      deviceSeq = d.seqs.device;
      seedRogueRng(d.rng); // 戦闘乱数列も保存時点から続ける(プレイ再現性)
      bgm.setBgmScene('game');
      bgm.setBgmDepth(depthOf(d.player.pos));
      const dungeon: Dungeon = {
        open: new Set(d.dungeon.open),
        chambers: d.dungeon.chambers,
        stubs: d.dungeon.stubs,
        slots: new Map(d.dungeon.chambers.map((c) => [slotKeyOfCell(c.center), c.id])),
        seed: d.seed,
        rng: lcg(d.seed), // 生成はすべて座標導出 rng なのでこの値は使われない
        rev: d.dungeon.rev,
        cutLayer: d.dungeon.cutLayer,
      };
      set({
        seed: d.seed,
        dungeon,
        discovered: new Set(d.discovered),
        discoveredRev: 1,
        cellChamber: new Map(d.cellChamber),
        visitedChambers: new Set(d.visitedChambers),
        exploreRev: 1,
        player: d.player,
        lightLevel: d.lightLevel,
        beasts: d.beasts,
        items: d.items,
        traps: d.traps,
        turrets: d.turrets,
        decoys: d.decoys,
        turn: d.turn,
        kills: d.kills,
        maxDepth: d.maxDepth,
        stratum: d.stratum,
        // 支度は「続きから」では出さない(そのランの最初に済んでいる)。関門ドラフトが
        // 保存時点で残っていれば復元し、その分はゲーム操作をブロックし続ける。
        skillSlots: d.skillSlots,
        skillEquipped: d.skillEquipped,
        skillDraft: d.skillDraft,
        skillOutfitting: false,
        phase: 'play',
        busy: d.skillDraft !== null,
        uiMode: 'walk',
        placeIndex: null,
        reach: { cells: [], parent: new Map() },
        hoverMarker: null,
        hoverBeastId: null,
        armedKey: null,
        focus: d.player.pos,
        mapMode: false,
        mapFocusChamber: null,
        deathCause: null,
        log: [...d.log, '—— 冒険を再開した'],
        fx: [],
      });
      refreshReach();
      return true;
    },

    clickCell: (c) => {
      logAction('C', c[0], c[1], c[2]);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      if (s.uiMode === 'throw') return;
      if (s.uiMode === 'place') {
        placeTrapAt(c);
        return;
      }
      const k = cellKey(c);
      if (!s.reach.cells.some((r) => cellKey(r) === k)) return;
      const path = pathTo(c);
      if (path.length < 2) return;
      void walkPath(path);
    },

    clickBeast: (id) => {
      logAction('B', id);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      const b = s.beasts.find((x) => x.id === id);
      if (!b || !b.alive) return;
      if (s.uiMode === 'throw') {
        const range = ITEMS.knife.range ?? 0;
        if (distW(s.player.pos, b.pos) > range) return;
        if (!s.discovered.has(cellKey(b.pos))) return;
        void throwKnife(b);
        return;
      }
      // 武器リーチ内(素手・通常1歩、長槍2歩)なら近接攻撃できる。
      if (stepDist(s.player.pos, b.pos) > weaponReach(s.player)) return;
      if (!s.discovered.has(cellKey(b.pos))) return;
      void meleeAttack(b);
    },

    useItem: (index) => {
      logAction('U', index);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      const stack = s.player.pack[index];
      if (!stack) return;
      const def = ITEMS[stack.item];
      const player = s.player;
      // 設置先選択中に別のアイテムを使ったら選択を解く(pack の index がずれるため)。
      if (s.uiMode === 'place' && def.kind !== 'trap') set({ uiMode: 'walk', placeIndex: null });

      if (def.kind === 'potion') {
        player.pack.splice(index, 1);
        if (def.barrier !== undefined) {
          // 障壁の水薬(rogue-21): 上書き式。今の障壁が多くても新しい値で置き換わる。
          const b = stackBarrier(stack);
          player.barrier = b;
          pushFx({ kind: 'popup', at: player.pos, text: `障壁${b}`, color: '#67d3e0', dur: 900 });
          sfx.play('place');
          pushLog(`${itemLabel(stack)} を飲んだ(障壁${b}を張り直した)`);
        } else if (def.cure) {
          // 解毒の水薬(rogue-21): 状態異常を治し、品質ぶんの予防を付ける。
          const immune = stackImmune(stack);
          const had = player.status;
          player.status = null;
          player.immune = Math.max(player.immune, immune);
          pushFx({ kind: 'heal', at: player.pos, dur: 700 });
          sfx.play('heal');
          pushLog(
            `${itemLabel(stack)} を飲んだ(${had ? '身体が軽くなった' : '異常なし'}${immune > 0 ? `・${immune}ターン予防` : ''})`,
          );
        } else {
          const healed = Math.min(stackHeal(stack), player.maxHp - player.hp);
          player.hp += healed;
          pushFx({ kind: 'heal', at: player.pos, dur: 700 });
          pushFx({ kind: 'popup', at: player.pos, text: `+${healed}`, color: '#86efac', dur: 900 });
          sfx.play('heal');
          pushLog(`${itemLabel(stack)} を飲んだ(+${healed})`);
        }
        set({ player: { ...player, pack: [...player.pack] }, uiMode: 'walk' });
        // 飲むのも1ターン。
        beastsTurn();
        endTurn();
        settleAfterAction();
        return;
      }

      if (def.kind === 'weapon') {
        player.pack.splice(index, 1);
        if (player.weapon) player.pack.push(player.weapon);
        player.weapon = stack;
        sfx.play('place');
        pushLog(`${itemLabel(stack)} を構えた`);
        // 両手武器(rogue-22)は盾と併用できない。装備中の盾は自動で外して pack へ。
        // ただし片手扱い(katate・rogue-23)を装着中は両手武器+盾の併用が許される。
        if (def.twoHanded && player.shield && !s.skillEquipped.includes('katate')) {
          player.pack.push(player.shield);
          player.shield = null;
          pushLog('盾を背負い直した(両手持ち)');
        }
        set({ player: { ...player, pack: [...player.pack] } });
        return;
      }
      if (def.kind === 'armor') {
        player.pack.splice(index, 1);
        if (player.armor) player.pack.push(player.armor);
        player.armor = stack;
        sfx.play('place');
        pushLog(`${itemLabel(stack)} を身につけた`);
        set({ player: { ...player, pack: [...player.pack] } });
        return;
      }
      if (def.kind === 'shield') {
        // 両手武器(rogue-22)を装備中は盾を持てない(両手がふさがっている)。
        // 片手扱い(katate・rogue-23)を装着中はこの制約が外れる。
        if (player.weapon && ITEMS[player.weapon.item].twoHanded && !s.skillEquipped.includes('katate')) {
          pushLog('両手がふさがっている(武器を外せば装備できる)');
          return;
        }
        player.pack.splice(index, 1);
        if (player.shield) player.pack.push(player.shield);
        player.shield = stack;
        sfx.play('place');
        pushLog(`${itemLabel(stack)} を装備した`);
        set({ player: { ...player, pack: [...player.pack] } });
        return;
      }

      // 罠: 設置先の選択モードへ(足元+隣接の橙マーカーから選ぶ。もう一度クリックで解除)。
      if (def.kind === 'trap') {
        if (s.uiMode === 'place' && s.placeIndex === index) {
          get().cancelThrow();
          return;
        }
        sfx.play('select');
        pushLog('罠の設置: 足元か隣の橙マーカーをクリック(所持品クリックで解除)');
        set({ uiMode: 'place', placeIndex: index });
        return;
      }

      // 設置系: 砲塔・囮を足元へ(1ターン消費)。
      if (def.kind === 'turret' || def.kind === 'decoy') {
        const k = cellKey(player.pos);
        const s2 = get();
        const occupied =
          s2.traps.some((t) => cellKey(t.pos) === k) ||
          s2.turrets.some((t) => cellKey(t.pos) === k) ||
          s2.decoys.some((d) => cellKey(d.pos) === k);
        if (occupied) {
          pushLog('ここには既に設置物がある');
          return;
        }
        player.pack.splice(index, 1);
        if (def.kind === 'turret') {
          set({
            turrets: [
              ...s2.turrets,
              { id: deviceSeq++, q: stack.q, pos: player.pos, turns: turretTurns(stack) },
            ],
          });
        } else {
          const hp = decoyHp(stack);
          set({
            decoys: [...s2.decoys, { id: deviceSeq++, q: stack.q, pos: player.pos, hp, maxHp: hp }],
          });
        }
        sfx.play('place');
        pushLog(`${itemLabel(stack)} を設置した`);
        set({ player: { ...player, pack: [...player.pack] }, uiMode: 'walk' });
        beastsTurn();
        endTurn();
        settleAfterAction();
        return;
      }

      // 投げナイフ: 投擲モードへ(もう一度クリックで解除)。
      if (def.kind === 'thrown') {
        if (s.uiMode === 'throw') {
          get().cancelThrow();
          return;
        }
        sfx.play('select');
        pushLog('投げナイフ: 射程内の敵をクリック(所持品クリックで解除)');
        set({ uiMode: 'throw' });
      }
    },

    unequip: (slot) => {
      logAction('Q', slot);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      const player = s.player;
      const stack = player[slot];
      if (!stack) return;
      player[slot] = null;
      player.pack.push(stack);
      sfx.play('cancel');
      pushLog(`${itemLabel(stack)} を外した`);
      set({ player: { ...player, pack: [...player.pack] } });
    },

    // --- スキル(マスタリー×スロット。rogue-23) ------------------------------------
    // equipSkill/unequipSkill/finishOutfitting/skipDraft は「支度」「関門ドラフト」の
    // モーダル表示中だけ動く(busy 相当のゲーム操作ブロック中でも、この4つだけは通す)。

    equipSkill: (id) => {
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

    unequipSkill: (id) => {
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

    recoverTrap: (id) => {
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

    mergeItem: (index) => {
      logAction('M', index);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      const a = s.player.pack[index];
      if (!a) return;
      const j = s.player.pack.findIndex((x, i) => i !== index && x.item === a.item && x.q === a.q);
      if (j < 0) {
        pushLog('合成には同じ品質の同じアイテムがもう一つ必要');
        return;
      }
      const player = s.player;
      const [hi, lo] = index > j ? [index, j] : [j, index];
      player.pack.splice(hi, 1);
      player.pack.splice(lo, 1);
      const merged: ItemStack = { item: a.item, q: a.q + 1 };
      player.pack.push(merged);
      sfx.play('heal');
      pushFx({ kind: 'popup', at: player.pos, text: `${itemLabel(merged)}!`, color: '#fde68a', dur: 900 });
      pushLog(`合成: ${itemLabel(merged)} になった`);
      set({ player: { ...player, pack: [...player.pack] } });
      // 合成も1ターン。
      beastsTurn();
      endTurn();
      settleAfterAction();
    },

    cycleLight: () => {
      logAction('L');
      const s = get();
      if (s.phase !== 'play') return;
      // 消灯(rogue-24): hiShobo 装着中のみ 0→1→2→3→0 の4循環。未装着は従来の3循環。
      const cycle = s.skillEquipped.includes('hiShobo') ? 4 : 3;
      const l = ((s.lightLevel + 1) % cycle) as LightLevel;
      set({ lightLevel: l });
      sfx.play('select');
      pushLog(`明かりを${LIGHT[l].name}(視界と回復が変わり、敵の気づきやすさも変わる)`);
      discover();
      refreshReach();
    },

    wait: () => {
      logAction('W');
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      set({ uiMode: 'walk' });
      beastsTurn();
      endTurn();
      settleAfterAction();
    },

    travelTo: (c) => {
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

    travelToChamber: (id) => {
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

    cancelThrow: () => {
      logAction('X');
      if (get().uiMode === 'walk') return;
      sfx.play('cancel');
      set({ uiMode: 'walk', placeIndex: null });
    },

    cancelTravel: () => {
      logAction('XT');
      if (!traveling) return; // 歩行中のみ。攻撃演出などの busy は巻き込まない
      runSeq++; // 進行中の walkPath ループを次のチェックで打ち切る
      traveling = false;
      sfx.play('cancel');
      pushLog('(足を止めた)');
      set({ busy: false });
      refreshReach();
    },

    setArmed: (key) => {
      if (get().armedKey === key) return;
      if (key !== null) sfx.play('cursor');
      set({ armedKey: key });
    },

    setHoverMarker: (k) => {
      if (get().hoverMarker === k) return;
      if (k !== null) sfx.play('cursor');
      set({ hoverMarker: k });
    },

    hoverBeast: (id) => {
      if (get().hoverBeastId === id) return;
      if (id !== null) sfx.play('cursor');
      set({ hoverBeastId: id });
    },

    toggleMap: () => {
      const s = get();
      const on = !s.mapMode;
      if (on && s.phase !== 'play') return; // 死亡画面からは開かない
      chamberCycleIdx = -1;
      view.base = null;
      clearGazeGoal();
      if (on) {
        // 巣全体が見える距離まで引く(既にそれ以上引いていれば維持)。
        view.R = Math.max(view.R ?? 0, 28 * ROGUE_S);
      } else {
        view.R = null; // ゲーム既定距離へ再導出
      }
      bgm.setBgmScene(on ? 'map' : 'game');
      sfx.play('select');
      set({
        mapMode: on,
        mapFocusChamber: null,
        focus: s.player.pos,
        hoverBeastId: null,
        hoverMarker: null,
        armedKey: null,
      });
    },

    cycleTarget: (dir = 1) => {
      const s = get();
      if (s.mapMode) {
        // 訪問済みの広間の中央を巡回(一周の最後にプレイヤー位置へ戻る)。Shift で逆順。
        const ids = [...s.visitedChambers].sort((a, b) => a - b);
        if (ids.length === 0) return;
        const n = ids.length + 1; // 末尾はプレイヤー位置
        // 初期状態(-1)は「プレイヤー位置」相当: 逆順の最初は最後の広間へ。
        chamberCycleIdx =
          chamberCycleIdx === -1 && dir === -1 ? n - 2 : (chamberCycleIdx + dir + n) % n;
        view.base = null; // パンで外していても巡回先へ再アンカー
        sfx.play('cursor');
        if (chamberCycleIdx === ids.length) {
          set({ focus: s.player.pos, mapFocusChamber: null });
        } else {
          const id = ids[chamberCycleIdx];
          set({ focus: s.dungeon.chambers[id].center, mapFocusChamber: id });
        }
        return;
      }
      if (s.phase !== 'play' || s.busy) return;
      // 部屋内の敵を距離順に巡回し、視線を向けて情報を出す。部屋の外でも、
      // すぐ近く(3歩)の敵と、こちらに気づいた敵(8歩)は拾う — 戸口や通路から
      // 迫る敵に「気づかれた」「攻撃されている」のに気配がない矛盾を防ぐ。
      const ch = s.cellChamber.get(cellKey(s.player.pos));
      const cands = s.beasts
        .filter((b) => {
          if (!b.alive || !s.discovered.has(cellKey(b.pos))) return false;
          if (ch !== undefined && s.cellChamber.get(cellKey(b.pos)) === ch) return true;
          return stepDist(s.player.pos, b.pos) <= (b.awake || ch === undefined ? 8 : 3);
        })
        .sort(
          (x, y) => stepDist(s.player.pos, x.pos) - stepDist(s.player.pos, y.pos) || x.id - y.id,
        );
      if (cands.length === 0) {
        pushLog('近くに敵の気配はない');
        return;
      }
      beastCycleIdx =
        beastCycleIdx === -1 && dir === -1
          ? cands.length - 1
          : (beastCycleIdx + dir + cands.length) % cands.length;
      const b = cands[beastCycleIdx];
      const g = gazeAngles(s.player.pos, b.pos);
      setGazeGoal(g.phi, g.theta);
      view.gazeBeastId = b.id; // 以後、敵が動いても視線が追跡する(カメラ側が毎フレーム更新)
      sfx.play('cursor');
      set({ hoverBeastId: b.id });
    },

    toggleMute: () => {
      const m = !get().muted;
      sfx.setMuted(m);
      bgm.setBgmMuted(m);
      set({ muted: m });
    },

    togglePostFx: () => set({ postFx: !get().postFx }),
  };

  /** restart 直後の明かり+到達範囲(クロージャ内関数を初期化からも使うため)。 */
  function discoverInit(): void {
    discover();
    refreshReach();
  }
});

// 初期状態にも明かりと到達範囲を入れる(モジュール読み込み時に1度)。
// keepSave: タイトル画面で「続きから」を選べるよう、起動時の仮ゲームでは保存を消さない。
{
  const s = useRogue.getState();
  s.restart(s.seed, { keepSave: true });
}
