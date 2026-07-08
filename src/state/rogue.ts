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
import { OFFSETS, cellKey, keyToCell, layer, neighbors, worldPos, type Cell, type CellKey } from '../model/fcc';
import {
  createDungeon,
  maybeExpand,
  cellRng,
  lcg,
  distW,
  adjacent,
  stepDist,
  type Dungeon,
  type Chamber,
  type Stub,
} from '../model/dungeon';
import * as persist from './persist';
import { BEASTS, spawnTable, type BeastKind } from '../model/beasts';
import {
  ITEMS,
  lootTable,
  itemLabel,
  stackAtk,
  stackDef,
  stackHeal,
  stackDmg,
  stackTurns,
  turretTurns,
  decoyHp,
  type ItemId,
  type ItemStack,
  type TrapKind,
} from '../model/loot';
import { animateUnit, clearUnitAnims, STEP_MS } from './unitAnim';
import { view, resetView, setGazeGoal, clearGazeGoal } from './view';
import * as sfx from '../audio/sfx';
import * as bgm from '../audio/bgm';
import { triggerPose } from './playerPose';

// --- 定数・型 ---------------------------------------------------------------------

/** rogue の表示倍率(固定。leva デバッグ盤は使わない)。 */
export const ROGUE_S = 2;
/** unitAnim 上のプレイヤー id(敵は 1〜)。 */
export const PLAYER_ID = 0;
/** 1クリックで歩ける最大歩数(洞窟は狭いので2近傍)。 */
export const REACH_STEPS = 2;
/** スタブ終端がこの距離に入ると次の広間が生成される。 */
const EXPAND_R = 5;
/** 素手の攻撃力。 */
const BASE_ATK = 2;
/** 延焼の毎ターンダメージ。 */
const BURN_DMG = 2;

/** 明かりの段階。広げるほど 視界↑・自然回復↑・敵の気づき距離↑。 */
export const LIGHT = [
  { name: '絞る', see: 4.5, regenEvery: 10, aggro: 0.7 },
  { name: '普通', see: 6, regenEvery: 6, aggro: 1.0 },
  { name: '広げる', see: 8, regenEvery: 4, aggro: 1.35 },
] as const;
export type LightLevel = 0 | 1 | 2;

/** 状態異常(罠で誘発)。burn=延焼DoT / confuse=混乱 / fear=恐慌 / sleep=昏睡。 */
export interface BeastStatus {
  kind: 'burn' | 'confuse' | 'fear' | 'sleep';
  turns: number;
}

export interface Beast {
  id: number;
  kind: BeastKind;
  pos: Cell;
  hp: number;
  home: Cell;
  /** ホームの広間 id(掃討判定に使う)。 */
  homeChamber: number;
  layerFloor: number;
  layerCeil: number;
  awake: boolean;
  alive: boolean;
  status: BeastStatus | null;
}

export interface GroundItem {
  id: number;
  stack: ItemStack;
  pos: Cell;
}

/** 設置済みの罠。敵が踏むと発動して消える。 */
export interface PlacedTrap {
  id: number;
  item: ItemId;
  kind: TrapKind;
  q: number;
  pos: Cell;
}

/** 魔導砲塔。毎ターン射程内の最も近い敵を撃つ(時限)。 */
export interface Turret {
  id: number;
  q: number;
  pos: Cell;
  turns: number;
}

/** 囮人形。敵のターゲットを吸う(耐久制)。 */
export interface Decoy {
  id: number;
  q: number;
  pos: Cell;
  hp: number;
  maxHp: number;
}

export interface RogueFx {
  id: number;
  kind: 'popup' | 'hit' | 'death' | 'heal' | 'bolt';
  at?: Cell;
  from?: Cell;
  to?: Cell;
  text?: string;
  color?: string;
  start: number;
  dur: number;
}

export interface PlayerState {
  pos: Cell;
  hp: number;
  maxHp: number;
  weapon: ItemStack | null;
  armor: ItemStack | null;
  pack: ItemStack[];
}

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
  unequip: (slot: 'weapon' | 'armor') => void;
  /** 明かりの段階を巡回(絞る→普通→広げる)。ターンを消費しない。 */
  cycleLight: () => void;
  wait: () => void;
  cancelThrow: () => void;
  /** 発見済みセルへのファストトラベル(1歩=1ターンの自動歩行。敵の覚醒/被弾で中断)。 */
  travelTo: (c: Cell) => void;
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

/**
 * localStorage(persist.ts)に置くスナップショット。Set/Map は配列化する。
 * ダンジョンの rng 関数は保存しない(展開時にスタブ位置から導出し直すため不要)。
 */
export interface SaveData {
  v: 1;
  seed: number;
  /** 戦闘乱数の内部状態(再開後もプレイ再現性を保つ)。 */
  rng: number;
  seqs: { beast: number; item: number; device: number };
  dungeon: { open: CellKey[]; chambers: Chamber[]; stubs: Stub[]; rev: number };
  discovered: CellKey[];
  cellChamber: [CellKey, number][];
  visitedChambers: number[];
  player: PlayerState;
  lightLevel: LightLevel;
  beasts: Beast[];
  items: GroundItem[];
  traps: PlacedTrap[];
  turrets: Turret[];
  decoys: Decoy[];
  turn: number;
  kills: number;
  maxDepth: number;
  log: string[];
}

// --- RNG(戦闘分散用。ダンジョン生成は dungeon.rng) --------------------------------

let rngState = (Date.now() ^ 0x2f6e2b1) >>> 0;

/** 戦闘乱数列を固定する(restart がシードから呼ぶ。テストは restart 後に上書き)。 */
export function seedRogueRng(seed: number): void {
  rngState = seed >>> 0;
}

/**
 * シード入力の解釈: 数字列はそのまま(2^31 で丸め)、その他の文字列は FNV-1a で
 * ハッシュ(言葉でもシードにできる)、空文字は undefined(=ランダム)。
 */
export function parseSeed(text: string): number | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  if (/^\d+$/.test(t)) return Number(t) % 0x80000000;
  let h = 0x811c9dc5;
  for (const ch of t) {
    h = (h ^ ch.codePointAt(0)!) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 0x80000000;
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 深度表示(入口=0、下ほど正)。 */
export function depthOf(c: Cell): number {
  return -layer(c) + 0; // +0 で -0 を正規化
}

function beastAt(beasts: readonly Beast[], k: CellKey): Beast | undefined {
  return beasts.find((b) => b.alive && cellKey(b.pos) === k);
}

/** 装備込みの攻撃力/防御力。 */
export function playerAtk(p: PlayerState): number {
  return BASE_ATK + (p.weapon ? stackAtk(p.weapon) : 0);
}
export function playerDef(p: PlayerState): number {
  return p.armor ? stackDef(p.armor) : 0;
}

/** 武器の攻撃リーチ(FCC 歩数)。素手・通常武器は 1(隣接)。長槍などは 2。 */
export function weaponReach(p: PlayerState): number {
  return p.weapon ? (ITEMS[p.weapon.item].reach ?? 1) : 1;
}
/** 薙ぎ払い武器か(リーチ内の敵全員に当たる)。 */
export function weaponSweep(p: PlayerState): boolean {
  return p.weapon ? (ITEMS[p.weapon.item].sweep ?? false) : false;
}

/** 罠を置けるセル(足元+12近傍のうち、空洞・発見済み・設置物/敵なし)。 */
export function placeableCells(
  s: Pick<RogueState, 'player' | 'dungeon' | 'discovered' | 'traps' | 'turrets' | 'decoys' | 'beasts'>,
): Cell[] {
  const occupied = new Set<CellKey>([
    ...s.traps.map((t) => cellKey(t.pos)),
    ...s.turrets.map((t) => cellKey(t.pos)),
    ...s.decoys.map((d) => cellKey(d.pos)),
    ...s.beasts.filter((b) => b.alive).map((b) => cellKey(b.pos)),
  ]);
  return [s.player.pos, ...neighbors(s.player.pos)].filter((c) => {
    const k = cellKey(c);
    return s.dungeon.open.has(k) && s.discovered.has(k) && !occupied.has(k);
  });
}

/**
 * from から to を見る視線のカメラ角(球面座標)。カメラは from を挟んで to の反対側に
 * 回り込む(=画面上で to が奥に来る)。theta は相手との高低差を反映しつつ、
 * 見やすい俯角レンジ [0.15, 0.9] にクランプする。
 */
export function gazeAngles(from: Cell, to: Cell): { phi: number; theta: number } {
  const a = worldPos(from[0], from[1], from[2], 1);
  const b = worldPos(to[0], to[1], to[2], 1);
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const phi = Math.atan2(dx, dz);
  const theta = Math.min(0.9, Math.max(0.15, Math.asin(dy / len) + 0.35));
  return { phi, theta };
}

/** 掃討済みの広間(訪問済みで、そこをホームとする敵が全滅)。壁色の明化に使う。 */
export function clearedChambers(
  visited: ReadonlySet<number>,
  beasts: readonly Beast[],
): Set<number> {
  const out = new Set(visited);
  for (const b of beasts) {
    if (b.alive) out.delete(b.homeChamber);
  }
  return out;
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

  /** たいまつの明かり: プレイヤーから空洞づたいに(明かり段階の半径)以内を発見済みに。 */
  function discover(): void {
    const { dungeon, discovered, player, lightLevel } = get();
    const seeR = LIGHT[lightLevel].see;
    const start = player.pos;
    const seen = new Set<CellKey>([cellKey(start)]);
    const queue: Cell[] = [start];
    let grew = false;
    while (queue.length > 0) {
      const c = queue.shift()!;
      const k = cellKey(c);
      if (!discovered.has(k)) {
        discovered.add(k);
        grew = true;
      }
      for (const o of OFFSETS) {
        const n: Cell = [c[0] + o[0], c[1] + o[1], c[2] + o[2]];
        const nk = cellKey(n);
        if (seen.has(nk) || !dungeon.open.has(nk)) continue;
        if (distW(start, n) > seeR) continue;
        seen.add(nk);
        queue.push(n);
      }
    }
    if (grew) set({ discoveredRev: get().discoveredRev + 1 });
  }

  /** 新しく生成された広間に敵と宝を湧かせる(セル→広間対応の登録も担う)。 */
  function populate(ch: Chamber): void {
    const { dungeon, beasts, items, cellChamber } = get();
    for (const k of ch.cells) cellChamber.set(k, ch.id);
    const depth = Math.max(0, depthOf(ch.center));
    // 広間の中心から導出した rng(生成順・戦闘に依らずシードだけで決まる)。
    const rng = cellRng(dungeon.seed, ch.center, 2);
    const spots = ch.cells.filter((k) => k !== cellKey(ch.center));
    const takeSpot = (): Cell | null => {
      if (spots.length === 0) return null;
      const i = Math.floor(rng() * spots.length);
      return keyToCell(spots.splice(i, 1)[0]);
    };
    const homeL = layer(ch.center);
    for (const kind of spawnTable(depth, rng)) {
      const pos = takeSpot();
      if (!pos) break;
      const def = BEASTS[kind];
      beasts.push({
        id: beastSeq++,
        kind,
        pos,
        hp: def.hp,
        home: ch.center,
        homeChamber: ch.id,
        layerFloor: homeL - def.vBelow,
        layerCeil: homeL + def.vAbove,
        awake: false,
        alive: true,
        status: null,
      });
    }
    for (const stack of lootTable(depth, rng)) {
      const pos = takeSpot();
      if (!pos) break;
      items.push({ id: itemSeq++, stack, pos });
    }
    set({ beasts: [...beasts], items: [...items] });
  }

  /** クリック可能な移動先(発見済み空洞・敵なし・BFS≤REACH_STEPS)。 */
  function computeReach(): { cells: Cell[]; parent: Map<CellKey, CellKey> } {
    const { dungeon, discovered, beasts, player, phase } = get();
    const cells: Cell[] = [];
    const parent = new Map<CellKey, CellKey>();
    if (phase !== 'play') return { cells, parent };
    const occupied = new Set(beasts.filter((b) => b.alive).map((b) => cellKey(b.pos)));
    const start = cellKey(player.pos);
    const depth = new Map<CellKey, number>([[start, 0]]);
    const queue: Cell[] = [player.pos];
    while (queue.length > 0) {
      const c = queue.shift()!;
      const k = cellKey(c);
      const d = depth.get(k)!;
      if (d >= REACH_STEPS) continue;
      for (const o of OFFSETS) {
        const n: Cell = [c[0] + o[0], c[1] + o[1], c[2] + o[2]];
        const nk = cellKey(n);
        if (depth.has(nk)) continue;
        if (!dungeon.open.has(nk) || !discovered.has(nk) || occupied.has(nk)) continue;
        depth.set(nk, d + 1);
        parent.set(nk, k);
        cells.push(n);
        queue.push(n);
      }
    }
    return { cells, parent };
  }

  function refreshReach(): void {
    // 到達範囲が変わる=状況が動いた。タッチの2段階選択(armedKey)も解除する。
    set({ reach: computeReach(), armedKey: null });
  }

  /**
   * 発見済み空洞を通る任意長の最短経路(生きた敵のセルは避ける)。
   * 目標は述語で与える(多目標 BFS — 最初に条件を満たしたセルで停止)。
   * [現在地, ..., 目的地] を返す。到達不能なら null。
   */
  function findPathWhere(isGoal: (k: CellKey) => boolean): Cell[] | null {
    const { dungeon, discovered, beasts, player } = get();
    const start = cellKey(player.pos);
    const occupied = new Set(beasts.filter((b) => b.alive).map((b) => cellKey(b.pos)));
    const parent = new Map<CellKey, CellKey>();
    const seen = new Set<CellKey>([start]);
    const queue: Cell[] = [player.pos];
    let guard = 0;
    while (queue.length > 0 && guard++ < 6000) {
      const c = queue.shift()!;
      const ck = cellKey(c);
      for (const o of OFFSETS) {
        const n: Cell = [c[0] + o[0], c[1] + o[1], c[2] + o[2]];
        const nk = cellKey(n);
        if (seen.has(nk)) continue;
        if (!dungeon.open.has(nk) || !discovered.has(nk) || occupied.has(nk)) continue;
        seen.add(nk);
        parent.set(nk, ck);
        if (isGoal(nk)) {
          const path: Cell[] = [n];
          let k = nk;
          while (k !== start) {
            k = parent.get(k)!;
            path.unshift(keyToCell(k));
          }
          return path;
        }
        queue.push(n);
      }
    }
    return null;
  }

  /** 指定セルへの最短経路。 */
  function findPath(to: Cell): Cell[] | null {
    const { dungeon, discovered, beasts, player } = get();
    const goal = cellKey(to);
    if (goal === cellKey(player.pos)) return null;
    if (!dungeon.open.has(goal) || !discovered.has(goal)) return null;
    if (beasts.some((b) => b.alive && cellKey(b.pos) === goal)) return null;
    return findPathWhere((k) => k === goal);
  }

  /** parent 木から経路を復元([現在地, ..., 目的地])。 */
  function pathTo(to: Cell): Cell[] {
    const { reach, player } = get();
    const path: Cell[] = [to];
    let k = cellKey(to);
    const start = cellKey(player.pos);
    while (k !== start) {
      const p = reach.parent.get(k);
      if (!p) return [];
      path.unshift(keyToCell(p));
      k = p;
    }
    return path;
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

  /** 敵→プレイヤーの一撃。 */
  function beastStrike(b: Beast): void {
    const { player } = get();
    const def = BEASTS[b.kind];
    const dmg = Math.max(1, def.atk - playerDef(player) + irnd(-1, 1));
    player.hp = Math.max(0, player.hp - dmg);
    pushFx({ kind: 'hit', at: player.pos, dur: 320 });
    pushFx({ kind: 'popup', at: player.pos, text: `${dmg}`, color: '#fca5a5', dur: 900 });
    sfx.play('hit');
    pushLog(`${def.name} の攻撃! ${dmg}ダメージ`);
    set({ player: { ...player } });
    if (player.hp <= 0) set({ deathCause: def.name }); // checkDead が使う死因
    checkDead();
  }

  /** 敵→囮の一撃。壊れたら除去。 */
  function hitDecoy(b: Beast, d: Decoy): void {
    const dmg = Math.max(1, BEASTS[b.kind].atk + irnd(-1, 1));
    d.hp -= dmg;
    pushFx({ kind: 'popup', at: d.pos, text: `${dmg}`, color: '#d6c9a8', dur: 900 });
    sfx.play('melee');
    if (d.hp <= 0) {
      pushFx({ kind: 'death', at: d.pos, dur: 600 });
      pushLog('囮人形が壊れた');
      set({ decoys: get().decoys.filter((x) => x.id !== d.id) });
    } else {
      set({ decoys: [...get().decoys] });
    }
  }

  /** ダメージ適用(死亡処理込み)。生存していれば false。 */
  function damageBeast(b: Beast, dmg: number, color = '#fecaca'): boolean {
    b.hp = Math.max(0, b.hp - dmg);
    pushFx({ kind: 'hit', at: b.pos, dur: 320 });
    pushFx({ kind: 'popup', at: b.pos, text: `${dmg}`, color, dur: 900 });
    if (b.hp === 0) {
      killBeast(b);
      return true;
    }
    return false;
  }

  /** b が今のセルの罠を踏んだら発動(罠は消費)。 */
  function triggerTrap(b: Beast): void {
    const { traps } = get();
    const k = cellKey(b.pos);
    const t = traps.find((x) => cellKey(x.pos) === k);
    if (!t) return;
    set({ traps: traps.filter((x) => x.id !== t.id) });
    const name = BEASTS[b.kind].name;
    const s: ItemStack = { item: t.item, q: t.q };
    sfx.play('hit');
    switch (t.kind) {
      case 'spike': {
        pushLog(`${name} が棘の罠を踏んだ!`);
        damageBeast(b, stackDmg(s));
        break;
      }
      case 'fire': {
        pushLog(`${name} が火炎の罠を踏んだ! 延焼した`);
        if (!damageBeast(b, stackDmg(s), '#fdba74')) {
          b.status = { kind: 'burn', turns: stackTurns(s) };
        }
        break;
      }
      case 'confuse':
        b.status = { kind: 'confuse', turns: stackTurns(s) };
        pushFx({ kind: 'popup', at: b.pos, text: '混乱', color: '#f472b6', dur: 900 });
        pushLog(`${name} は混乱した!`);
        break;
      case 'fear':
        b.status = { kind: 'fear', turns: stackTurns(s) };
        b.awake = true;
        pushFx({ kind: 'popup', at: b.pos, text: '恐慌', color: '#a78bfa', dur: 900 });
        pushLog(`${name} は恐慌に陥った!`);
        break;
      default: // sleep
        b.status = { kind: 'sleep', turns: stackTurns(s) };
        pushFx({ kind: 'popup', at: b.pos, text: '昏睡', color: '#60a5fa', dur: 900 });
        pushLog(`${name} は昏睡した!`);
        break;
    }
  }

  /** b の移動先候補(空洞・他の敵/プレイヤー/囮が居ない)。 */
  function stepCandidates(b: Beast): Cell[] {
    const s = get();
    const occupied = new Set(
      s.beasts.filter((x) => x.alive && x.id !== b.id).map((x) => cellKey(x.pos)),
    );
    occupied.add(cellKey(s.player.pos));
    for (const d of s.decoys) occupied.add(cellKey(d.pos));
    const out: Cell[] = [];
    for (const o of OFFSETS) {
      const n: Cell = [b.pos[0] + o[0], b.pos[1] + o[1], b.pos[2] + o[2]];
      if (s.dungeon.open.has(cellKey(n)) && !occupied.has(cellKey(n))) out.push(n);
    }
    return out;
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
      const target = s.beasts
        .filter((b) => b.alive && distW(t.pos, b.pos) <= range)
        .sort((a, b) => distW(t.pos, a.pos) - distW(t.pos, b.pos))[0];
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
          const cands = stepCandidates(b);
          if (cands.length > 0) moveBeast(b, cands[irnd(0, cands.length - 1)]);
          continue; // ふらつくだけ
        }
        if (st.kind === 'fear') {
          // 恐慌: 縄張り・階層を忘れてプレイヤーから遠ざかる。
          const cands = stepCandidates(b);
          let best: Cell | null = null;
          let bd = distW(b.pos, player.pos);
          for (const n of cands) {
            const d = distW(n, player.pos);
            if (d > bd) {
              bd = d;
              best = n;
            }
          }
          if (best) moveBeast(b, best);
          continue;
        }
        // burn は通常行動へ続く
      }

      const dW = distW(b.pos, player.pos);
      const dL = Math.abs(layer(b.pos) - layer(player.pos));

      // 気づき: 明かりを広げているほど遠くから気づかれる。
      if (!b.awake && dW <= def.aggroR * LIGHT[lightLevel].aggro && dL <= def.vAggro) {
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
      let tgtPos = player.pos;
      let tgtDecoy: Decoy | null = null;
      for (const d of get().decoys) {
        if (distW(b.pos, d.pos) < distW(b.pos, tgtPos)) {
          tgtPos = d.pos;
          tgtDecoy = d;
        }
      }

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
      if (distW(b.pos, tgtPos) > def.territoryR + def.aggroR) {
        b.awake = false;
        pushLog(`${def.name} は追跡を諦めた`);
        continue;
      }

      // 追跡: 縄張り・階層制限内でターゲットへ最も近づく空洞セルへ1歩。
      let best: Cell | null = null;
      let bd = distW(b.pos, tgtPos);
      for (const n of stepCandidates(b)) {
        const nl = layer(n);
        if (nl < b.layerFloor || nl > b.layerCeil) continue;
        if (distW(n, b.home) > def.territoryR) continue;
        const d = distW(n, tgtPos);
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      if (best) moveBeast(b, best);
    }
    set({ beasts: [...get().beasts] });
    turretsFire();
    return interrupted;
  }

  /** ターン経過の帳尻(ターン数・自然回復)。明かりが強いほど回復が早い。 */
  function endTurn(): void {
    const turn = get().turn + 1;
    const { player, lightLevel } = get();
    if (turn % LIGHT[lightLevel].regenEvery === 0 && player.hp > 0 && player.hp < player.maxHp) {
      player.hp += 1;
      set({ player: { ...player } });
    }
    set({ turn });
    bgm.setBgmDepth(depthOf(player.pos)); // BGM は深度で曲調が変わる
    autoSave();
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
    refreshReach();
  }

  /** 毎ターン終わりの自動保存(死んでいたら保存しない。死亡時は checkDead が破棄済み)。 */
  function autoSave(): void {
    const s = get();
    if (s.phase !== 'play') return;
    const data: SaveData = {
      v: 1,
      seed: s.seed,
      rng: rngState,
      seqs: { beast: beastSeq, item: itemSeq, device: deviceSeq },
      dungeon: {
        open: [...s.dungeon.open],
        chambers: s.dungeon.chambers,
        stubs: s.dungeon.stubs,
        rev: s.dungeon.rev,
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
      log: s.log.slice(-8),
    };
    persist.writeSave(data);
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
    set({ busy: true, reach: { cells: [], parent: new Map() }, hoverBeastId: null, hoverMarker: null });
    for (let i = 1; i < path.length; i++) {
      if (runSeq !== run || get().phase !== 'play') break;
      const next = path[i];
      if (beastAt(get().beasts, cellKey(next))) break; // 起きた敵が塞いだ
      stepPlayer(next);
      await sleep(STEP_MS + 40);
      if (runSeq !== run) return; // restart された
      const interrupted = beastsTurn();
      endTurn();
      if (get().phase !== 'play') break;
      if (interrupted && i < path.length - 1) {
        pushLog('(足を止めた)');
        break;
      }
    }
    if (runSeq !== run) return;
    set({ busy: false });
    refreshReach();
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
      const dmg = Math.max(1, playerAtk(player) - def.def + irnd(-1, 1));
      b.awake = true;
      pushLog(`${def.name} に ${dmg}ダメージ`);
      damageBeast(b, dmg);
    }
    sfx.play('hit');
    set({ beasts: [...get().beasts] });
    await sleep(240);
    if (runSeq !== run) return;
    beastsTurn();
    endTurn();
    set({ busy: false });
    refreshReach();
  }

  function killBeast(b: Beast): void {
    b.alive = false;
    set({ kills: get().kills + 1 });
    pushFx({ kind: 'death', at: b.pos, dur: 700 });
    sfx.play('death');
    pushLog(`${BEASTS[b.kind].name} を倒した!`);
    // ホーム広間の掃討判定(壁色の明化キー)。
    if (!get().beasts.some((x) => x.alive && x.id !== b.id && x.homeChamber === b.homeChamber)) {
      if (get().visitedChambers.has(b.homeChamber)) pushLog('この空間は静かになった…');
      set({ exploreRev: get().exploreRev + 1 });
    }
    // たまに戦利品を落とす。
    if (rand() < 0.3) {
      const drop = lootTable(Math.max(1, depthOf(b.pos)), rand)[0];
      if (drop) {
        get().items.push({ id: itemSeq++, stack: drop, pos: b.pos });
        set({ items: [...get().items] });
      }
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
    const dmg = Math.max(1, stackDmg(knife) - Math.floor(def.def / 2) + irnd(-1, 1));
    b.awake = true;
    sfx.play('hit');
    pushLog(`投げナイフが ${def.name} に ${dmg}ダメージ`);
    damageBeast(b, dmg);
    set({ beasts: [...get().beasts] });
    await sleep(200);
    if (runSeq !== run) return;
    beastsTurn();
    endTurn();
    set({ busy: false });
    refreshReach();
  }

  function buildInitial(seed: number): Pick<
    RogueState,
    | 'seed' | 'dungeon' | 'discovered' | 'discoveredRev' | 'player' | 'beasts' | 'items'
    | 'traps' | 'turrets' | 'decoys' | 'lightLevel'
    | 'turn' | 'kills' | 'maxDepth' | 'phase' | 'busy' | 'uiMode' | 'placeIndex' | 'reach'
    | 'hoverMarker' | 'hoverBeastId' | 'armedKey' | 'focus' | 'log' | 'fx'
    | 'cellChamber' | 'visitedChambers' | 'exploreRev' | 'deathCause'
  > {
    clearUnitAnims();
    runSeq++;
    beastSeq = 1;
    itemSeq = 1;
    deviceSeq = 1;
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
      phase: 'play',
      busy: false,
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
      if (!d || d.v !== 1) return false;
      resetView();
      clearUnitAnims();
      runSeq++; // 進行中の自動歩行などを打ち切る
      beastCycleIdx = -1;
      chamberCycleIdx = -1;
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
        seed: d.seed,
        rng: lcg(d.seed), // 展開時に cellRng で導出し直すので初期値は使われない
        rev: d.dungeon.rev,
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
        phase: 'play',
        busy: false,
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
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      const stack = s.player.pack[index];
      if (!stack) return;
      const def = ITEMS[stack.item];
      const player = s.player;
      // 設置先選択中に別のアイテムを使ったら選択を解く(pack の index がずれるため)。
      if (s.uiMode === 'place' && def.kind !== 'trap') set({ uiMode: 'walk', placeIndex: null });

      if (def.kind === 'potion') {
        const healed = Math.min(stackHeal(stack), player.maxHp - player.hp);
        player.pack.splice(index, 1);
        player.hp += healed;
        pushFx({ kind: 'heal', at: player.pos, dur: 700 });
        pushFx({ kind: 'popup', at: player.pos, text: `+${healed}`, color: '#86efac', dur: 900 });
        sfx.play('heal');
        pushLog(`${itemLabel(stack)} を飲んだ(+${healed})`);
        set({ player: { ...player, pack: [...player.pack] }, uiMode: 'walk' });
        // 飲むのも1ターン。
        beastsTurn();
        endTurn();
        refreshReach();
        return;
      }

      if (def.kind === 'weapon') {
        player.pack.splice(index, 1);
        if (player.weapon) player.pack.push(player.weapon);
        player.weapon = stack;
        sfx.play('place');
        pushLog(`${itemLabel(stack)} を構えた`);
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
        refreshReach();
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

    mergeItem: (index) => {
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
      refreshReach();
    },

    cycleLight: () => {
      const s = get();
      if (s.phase !== 'play') return;
      const l = ((s.lightLevel + 1) % 3) as LightLevel;
      set({ lightLevel: l });
      sfx.play('select');
      pushLog(`明かりを${LIGHT[l].name}(視界と回復が変わり、敵の気づきやすさも変わる)`);
      discover();
      refreshReach();
    },

    wait: () => {
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      set({ uiMode: 'walk' });
      beastsTurn();
      endTurn();
      refreshReach();
    },

    travelTo: (c) => {
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
      if (get().uiMode === 'walk') return;
      sfx.play('cancel');
      set({ uiMode: 'walk', placeIndex: null });
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
