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
//
// このファイルは合成ルート(rogue.ts 分割A1〜A5で完了)。zustand ストアは1つのまま
// (useRogue)、内部の実装は state/rogue/ 配下のファクトリ(createXxx(deps))へ分割し、
// ここではそれらを生成して deps(set/get・共有ヘルパ・相互のサンク参照)を配線するだけ。
// 分割の地図:
//   rng.ts / saveCodec.ts        乱数・セーブの符号化(A1)
//   skills.ts                    スキル・マスタリー・実績(A2)
//   combatActions.ts             近接/投擲攻撃・敵の1ターン・罠・砲塔・討伐(A3)
//   moveActions.ts               歩行・ファストトラベル・発見・拡張・拾得(A4)
//   stratum.ts                   層の警告/崩落・ターン経過の帳尻(endTurn)(A5)
//   runEnd.ts                    死亡判定・スコア記録・脱出(escape)(A5)
// rogue.ts に残るのは: 状態定義(RogueState)・型の再輸出・restart/resume・
// 上記のいずれにも属さない UI 系アクション・pushLog/pushFx/applyEvents/logAction/
// autoSave/weaveTrapAt などの共有ヘルパ・各ファクトリの生成と配線のみ。

import { create } from 'zustand';
import { cellKey, keyToCell, type Cell, type CellKey } from '../model/fcc';
import { createDungeon, distW, stepDist, type Dungeon } from '../model/dungeon';
import { rand, seedRogueRng, getRngState, setRngState } from './rogue/rng';
import { encodeSave, decodeSave } from './rogue/saveCodec';
import { createSkills } from './rogue/skills';
import { createCombat } from './rogue/combatActions';
import { createMove, sleep } from './rogue/moveActions';
import { createStratum, resetStratumWarned } from './rogue/stratum';
import { createRunEnd } from './rogue/runEnd';
import * as persist from './persist';
import * as masteryStore from './masteryStore';
import * as codexStore from './codexStore';
import * as scoreboard from './scoreboard';
import {
  ITEMS,
  itemLabel,
  stackHeal,
  stackBarrier,
  stackImmune,
  stackCount,
  mergeable,
  turretTurns,
  decoyHp,
  type ItemStack,
} from '../model/loot';
import { animateUnit, clearUnitAnims } from './unitAnim';
import { view, resetView, setGazeGoal, clearGazeGoal } from './view';
import * as sfx from '../audio/sfx';
import * as bgm from '../audio/bgm';
import { triggerPose } from './playerPose';
import {
  ROGUE_S,
  LIGHT,
  type LightLevel,
  type Beast,
  type GroundItem,
  type PlacedTrap,
  type Turret,
  type Decoy,
  type RogueFx,
  type PlayerState,
  type SaveData,
  type SkillDraft,
  type ActionLogEntry,
} from '../model/rogue/types';
import { depthOf, weaponReach, placeableCells, gazeAngles } from '../model/rogue/rules';
import {
  masteryLevels,
  takeable,
  rankOf,
  hasAnyMastery,
  type NodeId,
  type EquippedSkill,
} from '../model/rogue/mastery';
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
// マスタリー・スキルノード(rogue-23。rogue-27でランク・結び・排他へ再編)は HUD が
// 直接参照するのでここから再輸出する。
export {
  MASTERY_NAME,
  SKILL_NODES,
  NODE_IDS,
  MASTERY_THRESHOLDS,
  masteryLevels,
  takeable,
  draftLanes,
  unlockedRank,
  equippedCost,
  counterFor,
  rankOf,
  maxRank,
  KNOTS,
  knotActive,
  EXCLUDES,
} from '../model/rogue/mastery';
export type {
  MasterySystem,
  MasteryCounters,
  NodeId,
  SkillNode,
  EquippedSkill,
  DraftEntry,
  DraftLane,
  KnotId,
  Knot,
} from '../model/rogue/mastery';
export type { SkillDraft } from '../model/rogue/types';
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
  /** スキルスロット数(rogue-23。初期2・関門+1・門番+1・rogue-27で上限8)。 */
  skillSlots: number;
  /** 装着中のスキル(id・ランク。コスト合計 ≤ skillSlots。rogue-27でランク制へ)。 */
  skillEquipped: EquippedSkill[];
  /** 関門で提示中のドラフト(rogue-27: 天秤ドラフトの3枠 | 見送り権による自由選択'free' | null)。 */
  skillDraft: SkillDraft;
  /** 見送り権(rogue-27): true なら次の関門でドラフトの代わりに 'free' が出る(永続保存)。 */
  skillFreePick: boolean;
  /** 罠(罠編み)の装填クールダウン(rogue-27)。編むと 10/8/6(ランク)、endTurn で1ずつ回復。 */
  trapCooldown: number;
  /** ラン開始直後の「支度」(自由装着)モード中か。 */
  skillOutfitting: boolean;
  /** escaped(rogue-25): 脱出(生還)で終えたラン。dead と同様に操作停止・セーブ破棄。 */
  phase: 'play' | 'dead' | 'escaped';
  busy: boolean;
  /** walk=移動 / throw=投擲対象選択 / place=罠を編む先の選択(足元+隣接。rogue-27)。 */
  uiMode: 'walk' | 'throw' | 'place';
  /** 武具投擲時の対象アイテム index(uiMode=throw かつ throwItemIndex が undefined なら投げナイフ)。 */
  throwItemIndex?: number;
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
  /**
   * 罠を編む(rogue-27: 罠師「罠編み」ランクI以上)。装填クールダウンが0・自分の罠数が
   * 同時数(1/2/3)未満なら place モードへ入る(uiMode='place')。足元/隣接セルを
   * clickCell すると威力8/10/12・装填10/8/6(現在ランク)で設置し、1ターン消費する。
   * uiMode='place' 中にもう一度呼ぶと解除(cancelThrow と同じ経路)。
   */
  weaveTrap: () => void;
  /** 罠を解く(rogue-24 の遠隔回収を rogue-27 で改訂): 罠編みランクII以上。設置済みの
      自分の罠をクリックで除去し、装填クールダウンを0に戻す(1ターン)。 */
  recoverTrap: (id: number) => void;
  /** 罠を解体(rogue-28): 罠編みランクI以上。プレイヤーの足元または隣接する罠を
      クリックで除去する(1ターン、クールダウン非リセット)。 */
  dismantleTrap: (id: number) => void;
  /** 遠隔起爆(rogue-27: 罠編みランクIII以上)。自分の罠をクリックで即時発動(連鎖込み・
      乱数なし・1ターン)。id が不明なら何もしない。 */
  detonateTrap: (id: number) => void;
  /**
   * アイテム投擲(rogue-28)。pack[index] を敵 beastId へ投げる。
   * 武具(weapon/armor/shield)は落ちて拾い直せる。水薬は消滅。
   * relic・装置は投げられない。射程: FCC 歩数 4。
   */
  throwItem: (index: number, beastId: number) => void;
  /** 「支度」を終えてそのまま潜る。 */
  finishOutfitting: () => void;
  /** 関門のドラフトを見送る(何も選ばず閉じる)。 */
  skipDraft: () => void;
  /** 明かりの段階を巡回(絞る→普通→広げる)。ターンを消費しない。 */
  cycleLight: () => void;
  wait: () => void;
  /**
   * 脱出(rogue-25・push-your-luck の自発的終点)。警告帯(深度が 8*(stratum+1) 以上・
   * 崩落ライン未満)に居るときだけ有効。持ち物の琥珀を展示棚(codexStore)へ確定し、
   * phase を 'escaped' にする(dead と同様に操作停止・セーブ破棄)。
   */
  escape: () => void;
  cancelThrow: () => void;
  /** 武具投擲モードへ進入(PackPanel で「投げる」ボタンクリック)。敵クリックで throwItem を呼ぶ。 */
  setThrowMode: (index: number) => void;
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
// 実体は state/rogue/rng.ts(分割A1)。テスト・シミュレータが './rogue' から
// import しているため seedRogueRng の再輸出を維持する。
export { seedRogueRng } from './rogue/rng';

// 演出待ち(timeScale込み)・ファストトラベルの traveling フラグは state/rogue/moveActions.ts
// へ分離(rogue.ts 分割A4)。setTimeScaleForTest はテスト/シミュレータが './rogue' から
// import しているため再輸出を維持する。sleep は combat の deps にもそのまま渡すため import
// して使う(上の import 文)。
export { setTimeScaleForTest } from './rogue/moveActions';

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
// 行動ログ(rogue-19b)。将来の再生器(rogue-26)向けの記録のみ。restart でリセット。
let actionLog: ActionLogEntry[] = [];

/** テスト用: 現在の行動ログを読む(rogue-19b。actionLog はモジュール変数で外から見えないため)。 */
export function getActionLogForTest(): readonly ActionLogEntry[] {
  return actionLog;
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

  // discover/populate/computeReach/refreshReach/settleAfterAction・findPathWhere/findPath/
  // pathTo・confusedStep/stepPlayer/walkPath・clickCell/travelTo/cancelTravel/
  // travelToChamber/wait は state/rogue/moveActions.ts(move)へ分離(rogue.ts 分割A4)。

  // checkDead/recordRun/escape は state/rogue/runEnd.ts(runEnd)へ、checkStratum/
  // triggerCollapse/endTurn は state/rogue/stratum.ts(stratum)へ分離(rogue.ts 分割A5)。
  // runEnd は他モジュールを呼び返さない(一方向の依存)ため真っ先に作れる。stratum は
  // runEnd.checkDead/recordRun・skills の一部・move.refreshReach を使うため、
  // skills の直後・move より前に作る(move/combat の endTurn デップはまだ存在しない
  // stratum をサンクで指す)。
  let combat: ReturnType<typeof createCombat>;
  let move: ReturnType<typeof createMove>;
  let stratum: ReturnType<typeof createStratum>;

  const runEnd = createRunEnd({ set, get, pushLog, logAction, sfx });

  // スキル・マスタリー・実績のオーケストレーション(rogue-23〜25)は state/rogue/skills.ts
  // へ分離(rogue.ts 分割A2)。set/get・pushLog・logAction と、A5 で state/rogue/stratum.ts
  // へ移った endTurn を共有コンテキストとして渡す。settleAfterAction/discover は A4 で
  // state/rogue/moveActions.ts(move)へ、beastsTurn は A3 で state/rogue/combatActions.ts
  // (combat)へ移ったが、どちらもまだ存在しないオブジェクトを指すため、サンク
  // (() => move.discover() 等)で「後から束縛」して解く。stratum も同様にまだ存在しない。
  const skills = createSkills({
    set,
    get,
    pushLog,
    logAction,
    settleAfterAction: () => move.settleAfterAction(),
    beastsTurn: () => combat.beastsTurn(),
    endTurn: () => stratum.endTurn(),
    discover: () => move.discover(),
  });

  // 層(ストラタム)のオーケストレーション(rogue-19b)は state/rogue/stratum.ts へ分離
  // (rogue.ts 分割A5)。triggerCollapse が skills.maybeUnlockFeat/incrementMastery を呼ぶため
  // 直前に作った skills(実体)を渡し、move.refreshReach を呼ぶためまだ存在しない move は
  // サンクで渡す。checkDead/recordRun は runEnd(実体)から、autoSave は rogue.ts 側の関数宣言
  // (hoisted なのでこの時点でも参照可)をそのまま渡す(rogue-27: 関門ドラフトの生成自体は
  // stratum.ts が masteryStore/draftLanes を直接呼んで組み立てる)。
  stratum = createStratum({
    set,
    get,
    pushLog,
    pushFx,
    sfx,
    rand,
    checkDead: runEnd.checkDead,
    recordRun: runEnd.recordRun,
    skills: {
      maybeUnlockFeat: skills.maybeUnlockFeat,
      incrementMastery: skills.incrementMastery,
    },
    refreshReach: () => move.refreshReach(),
    autoSave,
  });

  // 移動・探索オーケストレーション(歩行/ファストトラベル・発見・拡張・拾得)は
  // state/rogue/moveActions.ts へ分離(rogue.ts 分割A4)。stepPlayer が
  // skills.maybeUnlockFeat を呼ぶため直前に作った skills(実体)を渡し、walkPath/wait が
  // combat.beastsTurn を呼ぶためまだ存在しない combat はサンクで渡す。beastSeq/itemSeq/
  // runSeq のアクセサ・weaveTrapAt(罠を編む。rogue.ts 側に残置)・endTurn(A5 で stratum へ)
  // もここで共有コンテキストとして渡す。
  move = createMove({
    set,
    get,
    pushLog,
    pushFx,
    logAction,
    sfx,
    animateUnit,
    rand,
    combat: { beastsTurn: () => combat.beastsTurn() },
    endTurn: () => stratum.endTurn(),
    skills: { skillModalOpen: skills.skillModalOpen, maybeUnlockFeat: skills.maybeUnlockFeat },
    getRunSeq: () => runSeq,
    bumpRunSeq: () => {
      runSeq++;
    },
    nextBeastSeq: () => beastSeq++,
    nextItemSeq: () => itemSeq++,
    weaveTrapAt,
  });

  // 戦闘オーケストレーション(近接/投擲攻撃・敵の1ターン・罠・砲塔・討伐処理)は
  // state/rogue/combatActions.ts へ分離(rogue.ts 分割A3)。killBeast が
  // skills.incrementMastery/maybeUnlockFeat を呼ぶため、直前に作った skills から
  // 使う2つだけを渡す。settleAfterAction は A4 で move へ移ったのでその戻り値を渡す。
  // checkDead は runEnd(実体)から、endTurn は A5 で stratum へ移ったのでその戻り値を渡す。
  // sleep/sfx/triggerPose/animateUnit/rand・runSeq/itemSeq のアクセサもここで
  // 共有コンテキストとして渡す。
  combat = createCombat({
    set,
    get,
    pushLog,
    pushFx,
    applyEvents,
    checkDead: runEnd.checkDead,
    endTurn: () => stratum.endTurn(),
    settleAfterAction: () => move.settleAfterAction(),
    sleep,
    sfx,
    triggerPose,
    animateUnit,
    rand,
    getRunSeq: () => runSeq,
    nextItemSeq: () => itemSeq++,
    skills: { incrementMastery: skills.incrementMastery, maybeUnlockFeat: skills.maybeUnlockFeat },
  });

  // beastStrike/hitDecoy/damageBeast/KillCtx/fireTrap/triggerTrap/stepCandidates/moveBeast/
  // turretsFire/beastsTurn は state/rogue/combatActions.ts(combat)へ分離(rogue.ts 分割A3)。
  // checkStratum/triggerCollapse/endTurn は state/rogue/stratum.ts(stratum)へ、
  // checkDead/recordRun/escape は state/rogue/runEnd.ts(runEnd)へ分離(rogue.ts 分割A5)。

  /** 罠を編むランクごとの威力・装填クールダウン(rogue-27)。index はランク−1。 */
  const WEAVE_POWER = [8, 10, 12];
  const WEAVE_COOLDOWN = [10, 8, 6];

  /**
   * place モード: 選んだセル(足元+隣接)へ罠師「罠編み」の罠を編む(1ターン)。
   * 条件(rankOf(wanaAmi)>=1・trapCooldown===0・自分の罠数<同時数)は weaveTrap
   * (モード入場)側で既に確認済みだが、モード中に装備やランクが変わりうるので
   * ここでも再確認する(壊れた指し先の安全弁)。
   */
  function weaveTrapAt(c: Cell): void {
    const s = get();
    const rank = rankOf(s.skillEquipped, 'wanaAmi');
    if (rank < 1 || s.trapCooldown > 0 || s.traps.length >= rank) {
      set({ uiMode: 'walk' }); // 前提が崩れた(ランク低下・CD再発生・上限到達)
      return;
    }
    const k = cellKey(c);
    if (!placeableCells(s).some((x) => cellKey(x) === k)) return;
    set({
      traps: [...s.traps, { id: deviceSeq++, pos: c, power: WEAVE_POWER[rank - 1] }],
      trapCooldown: WEAVE_COOLDOWN[rank - 1],
      uiMode: 'walk',
    });
    sfx.play('place');
    pushLog('罠を編んだ');
    combat.beastsTurn();
    stratum.endTurn();
    move.settleAfterAction();
  }

  /** 毎ターン終わりの自動保存(死んでいたら保存しない。死亡時は checkDead が破棄済み)。
      SaveData の組み立ては saveCodec.encodeSave(分割A1)。 */
  function autoSave(): void {
    const s = get();
    if (s.phase !== 'play') return;
    persist.writeSave(
      encodeSave({
        ...s,
        rng: getRngState(),
        seqs: { beast: beastSeq, item: itemSeq, device: deviceSeq },
        actionLog,
      }),
    );
  }

  // confusedStep/stepPlayer/walkPath も state/rogue/moveActions.ts(move)へ分離
  // (rogue.ts 分割A4)。meleeAttack/killBeast/throwKnife は state/rogue/combatActions.ts
  // (combat)へ分離(rogue.ts 分割A3)。clickBeast からは combat.meleeAttack/
  // combat.throwKnife を呼ぶ。

  function buildInitial(seed: number): Pick<
    RogueState,
    | 'seed' | 'dungeon' | 'discovered' | 'discoveredRev' | 'player' | 'beasts' | 'items'
    | 'traps' | 'turrets' | 'decoys' | 'lightLevel'
    | 'turn' | 'kills' | 'maxDepth' | 'stratum' | 'phase' | 'busy' | 'uiMode' | 'reach'
    | 'hoverMarker' | 'hoverBeastId' | 'armedKey' | 'focus' | 'log' | 'fx'
    | 'cellChamber' | 'visitedChambers' | 'exploreRev' | 'deathCause'
    | 'skillSlots' | 'skillEquipped' | 'skillDraft' | 'skillFreePick' | 'trapCooldown' | 'skillOutfitting'
  > {
    clearUnitAnims();
    runSeq++;
    beastSeq = 1;
    itemSeq = 1;
    deviceSeq = 1;
    // 支度(rogue-23): 解禁済みノードが1つ以上あればラン開始直後に自由装着パネルを開く
    // (マスタリー未育成の初回プレイヤーには出ない)。開いている間はゲーム操作をブロック。
    // skillEquipped はこの直後に空へリセットするので、ここでは絞り込まず単純に見る。
    // rogue-27: wanaAmi(罠編み)ランクIは系統レベル0でも解禁済みという特別な閾値を持つため
    // takeable([], levels) だけで判定すると真にマスタリー0のプレイヤーにも支度が開いてしまう
    // — hasAnyMastery(何か1つでも系統が育っているか)を併せて見て、真にマスタリー0の
    // プレイヤー・ボット・ゴールデンテストの操作列を守る(mastery.ts の hasAnyMastery 参照)。
    const levels0 = masteryLevels(masteryStore.readMastery());
    const outfitting = hasAnyMastery(levels0) && takeable([], levels0).length > 0;
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
          // ナイフは1束に(rogue-28: 別枠のままだと拾得束と併存して「×n ×枠数」の二重表示になる)。
          { item: 'knife', q: 0, n: 2 },
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
      skillFreePick: false,
      trapCooldown: 0,
      skillOutfitting: outfitting,
      phase: 'play',
      busy: outfitting, // 支度パネルが開いている間はゲーム操作をブロック
      uiMode: 'walk',
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
      resetStratumWarned();
      actionLog = [];
      // 共有スコアボード(rogue-26): ランごとに送信専用の ID を採番(ゲームの決定論=乱数
      // シード列とは無関係。scoreboard.ts 冒頭のコメント参照)。
      scoreboard.startNewRun();
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
      // SaveData → 状態片の復元(Set/Map・dungeon の slots・rng 関数の再付与)は
      // saveCodec.decodeSave(分割A1)。v 不一致は null で「再開できない」。
      const raw = persist.readSave<SaveData>();
      const d = raw ? decodeSave(raw) : null;
      if (!d) return false;
      resetView();
      clearUnitAnims();
      runSeq++; // 進行中の自動歩行などを打ち切る
      beastCycleIdx = -1;
      chamberCycleIdx = -1;
      resetStratumWarned(); // 保存には無い(層の途中で境界近くなら再掲されるだけ)
      // 共有スコアボード(rogue-26): runId は saveData に入れない設計のため、再開したランは
      // 新しい ID を採番する(簡潔さ優先)。
      scoreboard.startNewRun();
      actionLog = d.actionLog;
      beastSeq = d.seqs.beast;
      itemSeq = d.seqs.item;
      deviceSeq = d.seqs.device;
      setRngState(d.rng); // 戦闘乱数列も保存時点から続ける(プレイ再現性)
      bgm.setBgmScene('game');
      bgm.setBgmDepth(depthOf(d.player.pos));
      set({
        seed: d.seed,
        dungeon: d.dungeon,
        discovered: d.discovered,
        discoveredRev: 1,
        cellChamber: d.cellChamber,
        visitedChambers: d.visitedChambers,
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
        skillFreePick: d.skillFreePick,
        trapCooldown: d.trapCooldown,
        skillOutfitting: false,
        phase: 'play',
        busy: d.skillDraft !== null,
        uiMode: 'walk',
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
      move.refreshReach();
      return true;
    },

    ...move.actions,

    clickBeast: (id) => {
      logAction('B', id);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      const b = s.beasts.find((x) => x.id === id);
      if (!b || !b.alive) return;
      if (s.uiMode === 'throw') {
        // 武具投擲(throwItemIndex あり)は射程4、投げナイフは knife.range(8)。
        const range = s.throwItemIndex !== undefined ? 4 : (ITEMS.knife.range ?? 0);
        if (distW(s.player.pos, b.pos) > range) return;
        if (!s.discovered.has(cellKey(b.pos))) return;
        // throwItemIndex があれば武具投擲、なければ投げナイフ。
        if (s.throwItemIndex !== undefined) {
          void combat.throwItem(s.throwItemIndex, b.id);
        } else {
          void combat.throwKnife(b);
        }
        return;
      }
      // 武器リーチ内(素手・通常1歩、長槍2歩)なら近接攻撃できる。
      if (stepDist(s.player.pos, b.pos) > weaponReach(s.player)) return;
      if (!s.discovered.has(cellKey(b.pos))) return;
      void combat.meleeAttack(b);
    },

    throwItem: (index, beastId) => {
      logAction('T', index, beastId);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      void combat.throwItem(index, beastId);
    },

    useItem: (index) => {
      logAction('U', index);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      const stack = s.player.pack[index];
      if (!stack) return;
      const def = ITEMS[stack.item];
      const player = s.player;
      // 罠編みの設置先選択中に所持品を使ったら選択を解く(rogue-27: 罠アイテムは廃止済みで
      // 'place' は罠編み専用のため、ここでは常に解除する)。
      if (s.uiMode === 'place') set({ uiMode: 'walk' });

      // 遺物(rogue-25): 使用・装備・合成不可。ログのみでターン消費なし。
      if (def.kind === 'relic') {
        pushLog('大切なものだ(持ち帰って飾ろう)');
        return;
      }

      if (def.kind === 'potion') {
        // 個数消費: n >= 2 なら n-1、n === 1 で枠削除。
        const n = stackCount(stack);
        if (n >= 2) {
          player.pack[index] = { ...stack, n: n - 1 };
        } else {
          player.pack.splice(index, 1);
        }
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
        combat.beastsTurn();
        stratum.endTurn();
        move.settleAfterAction();
        return;
      }

      if (def.kind === 'weapon') {
        player.pack.splice(index, 1);
        if (player.weapon) player.pack.push(player.weapon);
        player.weapon = stack;
        sfx.play('place');
        pushLog(`${itemLabel(stack)} を構えた`);
        codexStore.recordItemFound(stack.item, stack.q); // アイテム図鑑(rogue-25)
        // 両手武器(rogue-22)は盾と併用できない。装備中の盾は自動で外して pack へ。
        // ただし片手扱い(katate・rogue-23)を装着中は両手武器+盾の併用が許される。
        if (def.twoHanded && player.shield && rankOf(s.skillEquipped, 'katate') < 1) {
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
        codexStore.recordItemFound(stack.item, stack.q); // アイテム図鑑(rogue-25)
        set({ player: { ...player, pack: [...player.pack] } });
        return;
      }
      if (def.kind === 'shield') {
        // 両手武器(rogue-22)を装備中は盾を持てない(両手がふさがっている)。
        // 片手扱い(katate・rogue-23)を装着中はこの制約が外れる。
        if (player.weapon && ITEMS[player.weapon.item].twoHanded && rankOf(s.skillEquipped, 'katate') < 1) {
          pushLog('両手がふさがっている(武器を外せば装備できる)');
          return;
        }
        player.pack.splice(index, 1);
        if (player.shield) player.pack.push(player.shield);
        player.shield = stack;
        sfx.play('place');
        pushLog(`${itemLabel(stack)} を装備した`);
        codexStore.recordItemFound(stack.item, stack.q); // アイテム図鑑(rogue-25)
        set({ player: { ...player, pack: [...player.pack] } });
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
        combat.beastsTurn();
        stratum.endTurn();
        move.settleAfterAction();
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
        // 直前の武具投擲の指し先が残っているとナイフのつもりで武具を投げてしまう — 必ず消す。
        set({ uiMode: 'throw', throwItemIndex: undefined });
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
    // equipSkill/unequipSkill/finishOutfitting/skipDraft/recoverTrap/dismantleTrap の実体は
    // state/rogue/skills.ts(分割A2)。「支度」「関門ドラフト」のモーダル表示中だけ
    // 動く(busy 相当のゲーム操作ブロック中でも、この4つだけは通す)。
    ...skills.actions,

    weaveTrap: () => {
      logAction('WV');
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      if (s.uiMode === 'place') {
        get().cancelThrow(); // もう一度呼ぶと解除(投擲モードと同じ経路)
        return;
      }
      const rank = rankOf(s.skillEquipped, 'wanaAmi');
      if (rank < 1) return;
      if (s.trapCooldown > 0) {
        pushLog('まだ装填が終わっていない');
        return;
      }
      if (s.traps.length >= rank) {
        pushLog(`罠は同時に${rank}個までしか編めない`);
        return;
      }
      sfx.play('select');
      pushLog('罠を編む: 足元か隣の橙マーカーをクリック(もう一度押すと解除)');
      set({ uiMode: 'place' });
    },

    detonateTrap: (id) => {
      logAction('DT', id);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      if (rankOf(s.skillEquipped, 'wanaAmi') < 3) return;
      if (!combat.detonateTrap(id)) return;
      combat.beastsTurn();
      stratum.endTurn();
      move.settleAfterAction();
    },

    mergeItem: (index) => {
      logAction('M', index);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      const a = s.player.pack[index];
      if (!a) return;
      // 合成は武具のみ(weapon / armor / shield)。
      if (!mergeable(a.item)) {
        pushLog('武具しか鍛えられない');
        return;
      }
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
      combat.beastsTurn();
      stratum.endTurn();
      move.settleAfterAction();
    },

    cycleLight: () => {
      logAction('L');
      const s = get();
      if (s.phase !== 'play') return;
      // 消灯(rogue-24): hiShobo 装着中のみ 0→1→2→3→0 の4循環。未装着は従来の3循環。
      const cycle = rankOf(s.skillEquipped, 'hiShobo') >= 1 ? 4 : 3;
      const l = ((s.lightLevel + 1) % cycle) as LightLevel;
      set({ lightLevel: l });
      sfx.play('select');
      pushLog(`明かりを${LIGHT[l].name}(視界と回復が変わり、敵の気づきやすさも変わる)`);
      move.discover();
      move.refreshReach();
    },

    // escape(脱出)の実体は state/rogue/runEnd.ts(分割A5)。checkDead/recordRun と
    // 同じくラン終了系としてそちらへ移した。
    ...runEnd.actions,

    cancelThrow: () => {
      logAction('X');
      if (get().uiMode === 'walk') return;
      sfx.play('cancel');
      set({ uiMode: 'walk', throwItemIndex: undefined });
    },

    setThrowMode: (index) => {
      logAction('TM', index);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      if (index < 0 || index >= s.player.pack.length) return;
      sfx.play('select');
      pushLog('クリックで対象の敵を選ぶ');
      set({ uiMode: 'throw', throwItemIndex: index });
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
        // 崩落済み(墓標化)広間は巡回対象から除外する(visitedChambers 自体は刈らない)。
        const ids = [...s.visitedChambers]
          .filter((id) => !s.dungeon.chambers[id].collapsed)
          .sort((a, b) => a - b);
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
    move.discover();
    move.refreshReach();
  }
});

// 初期状態にも明かりと到達範囲を入れる(モジュール読み込み時に1度)。
// keepSave: タイトル画面で「続きから」を選べるよう、起動時の仮ゲームでは保存を消さない。
{
  const s = useRogue.getState();
  s.restart(s.seed, { keepSave: true });
}
