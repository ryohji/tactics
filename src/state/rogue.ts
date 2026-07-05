// ローグライク状態機械(rogue-1)。古典ローグ式「プレイヤー1行動=1ターン」。
// 行動(歩く/攻撃/投げる/飲む/待つ)のたびに敵が1歩動く。陣営ターンなし。
//
// フロー:
//   walk : 到達マーカー(BFS≤3歩)をクリック → 1歩ずつ自動歩行(敵に気づかれたら中断)
//          隣接する敵をクリック → 近接攻撃
//   throw: 所持品の投げナイフをクリックして入り、射程内の敵をクリックで投擲
//   dead : HP 0 で死亡 → スコア(最深到達・討伐数)表示 → 再挑戦
//
// ダンジョンの実体(model/dungeon.ts)は in-place 掘削なので、描画は discoveredRev を
// 変更検知キーにする。敵・宝は広間の生成時(maybeExpand)に湧く。

import { create } from 'zustand';
import { OFFSETS, cellKey, keyToCell, layer, worldPos, type Cell, type CellKey } from '../model/fcc';
import {
  createDungeon,
  maybeExpand,
  distW,
  adjacent,
  stepDist,
  type Dungeon,
  type Chamber,
} from '../model/dungeon';
import { BEASTS, spawnTable, type BeastKind } from '../model/beasts';
import { ITEMS, lootTable, type ItemId } from '../model/loot';
import { animateUnit, clearUnitAnims, STEP_MS } from './unitAnim';
import { view, resetView, setGazeGoal, clearGazeGoal } from './view';
import * as sfx from '../audio/sfx';

// --- 定数・型 ---------------------------------------------------------------------

/** rogue の表示倍率(固定。leva デバッグ盤は使わない)。 */
export const ROGUE_S = 2;
/** unitAnim 上のプレイヤー id(敵は 1〜)。 */
export const PLAYER_ID = 0;
/** 1クリックで歩ける最大歩数(洞窟は狭いので2近傍)。 */
export const REACH_STEPS = 2;
/** 発見(たいまつの明かり)の届く距離(格子ワールド単位)。 */
const SEE_R = 6;
/** スタブ終端がこの距離に入ると次の広間が生成される。 */
const EXPAND_R = 5;
/** 素手の攻撃力。 */
const BASE_ATK = 2;
/** HP 自然回復の間隔(ターン)。 */
const REGEN_EVERY = 6;

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
}

export interface GroundItem {
  id: number;
  item: ItemId;
  pos: Cell;
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
  weapon: ItemId | null;
  armor: ItemId | null;
  pack: ItemId[];
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
  beasts: Beast[];
  items: GroundItem[];
  turn: number;
  kills: number;
  maxDepth: number;
  phase: 'play' | 'dead';
  busy: boolean;
  uiMode: 'walk' | 'throw';
  /** クリック可能な移動先(BFS≤REACH_STEPS)。 */
  reach: { cells: Cell[]; parent: Map<CellKey, CellKey> };
  /** ホバー中の移動マーカーのセル(同レベルのヘックスオーバーレイ表示に使う)。 */
  hoverMarker: CellKey | null;
  /** HUD に情報を出す敵 id(ホバー)。 */
  hoverBeastId: number | null;
  focus: Cell;
  freeCam: boolean;
  /** マップモード(カット無しで巣全体を俯瞰。ゲーム画面とトグル)。 */
  mapMode: boolean;
  muted: boolean;
  log: string[];
  fx: RogueFx[];

  restart: (seed?: number) => void;
  clickCell: (c: Cell) => void;
  clickBeast: (id: number) => void;
  useItem: (index: number) => void;
  wait: () => void;
  cancelThrow: () => void;
  /** 発見済みセルへのファストトラベル(1歩=1ターンの自動歩行。敵の覚醒/被弾で中断)。 */
  travelTo: (c: Cell) => void;
  setHoverMarker: (k: CellKey | null) => void;
  hoverBeast: (id: number | null) => void;
  toggleFreeCam: () => void;
  /** マップモードの切替(M キー / HUD ボタン)。 */
  toggleMap: () => void;
  /** TAB: ゲーム=部屋内の敵へ視線を巡回 / マップ=訪問済み広間の中央を巡回。 */
  cycleTarget: () => void;
  toggleMute: () => void;
}

// --- RNG(戦闘分散用。ダンジョン生成は dungeon.rng) --------------------------------

let rngState = (Date.now() ^ 0x2f6e2b1) >>> 0;

/** テスト用に戦闘乱数列を固定する。 */
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
  return BASE_ATK + (p.weapon ? ITEMS[p.weapon].atk ?? 0 : 0);
}
export function playerDef(p: PlayerState): number {
  return p.armor ? ITEMS[p.armor].def ?? 0 : 0;
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

  /** たいまつの明かり: プレイヤーから空洞づたいに SEE_R 以内を発見済みにする。 */
  function discover(): void {
    const { dungeon, discovered, player } = get();
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
        if (distW(start, n) > SEE_R) continue;
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
    const spots = ch.cells.filter((k) => k !== cellKey(ch.center));
    const takeSpot = (): Cell | null => {
      if (spots.length === 0) return null;
      const i = Math.floor(dungeon.rng() * spots.length);
      return keyToCell(spots.splice(i, 1)[0]);
    };
    const homeL = layer(ch.center);
    for (const kind of spawnTable(depth, dungeon.rng)) {
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
      });
    }
    for (const item of lootTable(depth, dungeon.rng)) {
      const pos = takeSpot();
      if (!pos) break;
      items.push({ id: itemSeq++, item, pos });
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
    set({ reach: computeReach() });
  }

  /**
   * 発見済み空洞を通る任意長の最短経路(生きた敵のセルは避ける)。
   * [現在地, ..., 目的地] を返す。到達不能なら null。
   */
  function findPath(to: Cell): Cell[] | null {
    const { dungeon, discovered, beasts, player } = get();
    const goal = cellKey(to);
    const start = cellKey(player.pos);
    if (goal === start) return null;
    if (!dungeon.open.has(goal) || !discovered.has(goal)) return null;
    const occupied = new Set(beasts.filter((b) => b.alive).map((b) => cellKey(b.pos)));
    if (occupied.has(goal)) return null;
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
        if (nk === goal) {
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
    checkDead();
  }

  /**
   * 敵の1ターン。気づき判定 → 追跡/攻撃。
   * 「新たに気づかれた」or「攻撃を受けた」なら true(自動歩行の中断シグナル)。
   */
  function beastsTurn(): boolean {
    let interrupted = false;
    const { beasts, dungeon, discovered } = get();
    for (const b of beasts) {
      if (!b.alive) continue;
      if (get().phase !== 'play') break;
      const { player } = get();
      const def = BEASTS[b.kind];
      const dW = distW(b.pos, player.pos);
      const dL = Math.abs(layer(b.pos) - layer(player.pos));

      if (!b.awake && dW <= def.aggroR && dL <= def.vAggro) {
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

      if (adjacent(b.pos, player.pos)) {
        beastStrike(b);
        interrupted = true;
        continue;
      }

      // 縄張りから離れすぎたら追跡を諦める。
      if (dW > def.territoryR + def.aggroR) {
        b.awake = false;
        pushLog(`${def.name} は追跡を諦めた`);
        continue;
      }

      // 追跡: 縄張り・階層制限内でプレイヤーへ最も近づく空洞セルへ1歩。
      const occupied = new Set(
        beasts.filter((x) => x.alive && x.id !== b.id).map((x) => cellKey(x.pos)),
      );
      let best: Cell | null = null;
      let bd = dW;
      for (const o of OFFSETS) {
        const n: Cell = [b.pos[0] + o[0], b.pos[1] + o[1], b.pos[2] + o[2]];
        const nk = cellKey(n);
        if (!dungeon.open.has(nk) || occupied.has(nk) || nk === cellKey(player.pos)) continue;
        const nl = layer(n);
        if (nl < b.layerFloor || nl > b.layerCeil) continue;
        if (distW(n, b.home) > def.territoryR) continue;
        const d = distW(n, player.pos);
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      if (best) {
        animateUnit(b.id, [b.pos, best]);
        b.pos = best;
      }
    }
    set({ beasts: [...get().beasts] });
    return interrupted;
  }

  /** ターン経過の帳尻(ターン数・自然回復)。 */
  function endTurn(): void {
    const turn = get().turn + 1;
    const { player } = get();
    if (turn % REGEN_EVERY === 0 && player.hp > 0 && player.hp < player.maxHp) {
      player.hp += 1;
      set({ player: { ...player } });
    }
    set({ turn });
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
        player.pack.push(f.item);
        pushFx({ kind: 'popup', at: next, text: ITEMS[f.item].name, color: '#fde68a', dur: 900 });
        pushLog(`${ITEMS[f.item].name} を拾った`);
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
  async function meleeAttack(b: Beast): Promise<void> {
    const run = runSeq;
    set({ busy: true, reach: { cells: [], parent: new Map() } });
    const def = BEASTS[b.kind];
    const dmg = Math.max(1, playerAtk(get().player) - def.def + irnd(-1, 1));
    sfx.play('melee');
    await sleep(140);
    if (runSeq !== run) return;
    b.hp = Math.max(0, b.hp - dmg);
    b.awake = true;
    pushFx({ kind: 'hit', at: b.pos, dur: 320 });
    pushFx({ kind: 'popup', at: b.pos, text: `${dmg}`, color: '#fecaca', dur: 900 });
    sfx.play('hit');
    pushLog(`${def.name} に ${dmg}ダメージ`);
    if (b.hp === 0) killBeast(b);
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
        get().items.push({ id: itemSeq++, item: drop, pos: b.pos });
        set({ items: [...get().items] });
      }
    }
  }

  /** 投げナイフ。 */
  async function throwKnife(b: Beast): Promise<void> {
    const run = runSeq;
    const { player } = get();
    const idx = player.pack.indexOf('knife');
    if (idx < 0) return;
    set({ busy: true, uiMode: 'walk', reach: { cells: [], parent: new Map() } });
    player.pack.splice(idx, 1);
    set({ player: { ...player, pack: [...player.pack] } });
    pushFx({ kind: 'bolt', from: player.pos, to: b.pos, dur: 260 });
    sfx.play('arrow');
    await sleep(280);
    if (runSeq !== run) return;
    const def = BEASTS[b.kind];
    const dmg = Math.max(1, (ITEMS.knife.dmg ?? 0) - Math.floor(def.def / 2) + irnd(-1, 1));
    b.hp = Math.max(0, b.hp - dmg);
    b.awake = true;
    pushFx({ kind: 'hit', at: b.pos, dur: 320 });
    pushFx({ kind: 'popup', at: b.pos, text: `${dmg}`, color: '#fecaca', dur: 900 });
    sfx.play('hit');
    pushLog(`投げナイフが ${def.name} に ${dmg}ダメージ`);
    if (b.hp === 0) killBeast(b);
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
    | 'turn' | 'kills' | 'maxDepth' | 'phase' | 'busy' | 'uiMode' | 'reach'
    | 'hoverMarker' | 'hoverBeastId' | 'focus' | 'log' | 'fx'
    | 'cellChamber' | 'visitedChambers' | 'exploreRev'
  > {
    clearUnitAnims();
    runSeq++;
    beastSeq = 1;
    itemSeq = 1;
    const dungeon = createDungeon(seed);
    // 入口に水薬をひとつ(手触り確認と「拾える」ことの提示)。
    const entrance = dungeon.chambers[0];
    const spot = entrance.cells.find((k) => k !== cellKey(entrance.center));
    const items: GroundItem[] = spot ? [{ id: itemSeq++, item: 'potion', pos: keyToCell(spot) }] : [];
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
      player: {
        pos: [0, 0, 0],
        hp: 24,
        maxHp: 24,
        weapon: 'dagger',
        armor: null,
        pack: ['potion', 'knife', 'knife'],
      },
      beasts: [],
      items,
      turn: 0,
      kills: 0,
      maxDepth: 0,
      phase: 'play',
      busy: false,
      uiMode: 'walk',
      reach: { cells: [], parent: new Map() },
      hoverMarker: null,
      hoverBeastId: null,
      focus: [0, 0, 0],
      log: ['蟻巣迷宮に踏み込んだ。青いマーカーで移動、隣接した敵はクリックで攻撃。'],
      fx: [],
    };
  }

  const initialSeed = Math.floor(Math.random() * 0x7fffffff);

  return {
    ...buildInitial(initialSeed),
    freeCam: false,
    mapMode: false,
    muted: false,

    restart: (seed) => {
      resetView();
      beastCycleIdx = -1;
      chamberCycleIdx = -1;
      set({
        ...buildInitial(seed ?? Math.floor(Math.random() * 0x7fffffff)),
        freeCam: false,
        mapMode: false,
      });
      discoverInit(); // 初期位置の明かりと到達範囲
    },

    clickCell: (c) => {
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      if (s.uiMode === 'throw') return;
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
      if (!adjacent(s.player.pos, b.pos)) return;
      void meleeAttack(b);
    },

    useItem: (index) => {
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      const item = s.player.pack[index];
      if (!item) return;
      const def = ITEMS[item];
      const player = s.player;

      if (def.kind === 'potion') {
        const healed = Math.min(def.heal ?? 0, player.maxHp - player.hp);
        player.pack.splice(index, 1);
        player.hp += healed;
        pushFx({ kind: 'heal', at: player.pos, dur: 700 });
        pushFx({ kind: 'popup', at: player.pos, text: `+${healed}`, color: '#86efac', dur: 900 });
        sfx.play('heal');
        pushLog(`${def.name} を飲んだ(+${healed})`);
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
        player.weapon = item;
        sfx.play('place');
        pushLog(`${def.name} を構えた`);
        set({ player: { ...player, pack: [...player.pack] } });
        return;
      }
      if (def.kind === 'armor') {
        player.pack.splice(index, 1);
        if (player.armor) player.pack.push(player.armor);
        player.armor = item;
        sfx.play('place');
        pushLog(`${def.name} を身につけた`);
        set({ player: { ...player, pack: [...player.pack] } });
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

    cancelThrow: () => {
      if (get().uiMode !== 'throw') return;
      sfx.play('cancel');
      set({ uiMode: 'walk' });
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

    toggleFreeCam: () => set({ freeCam: !get().freeCam }),

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
      sfx.play('select');
      set({ mapMode: on, focus: s.player.pos, hoverBeastId: null, hoverMarker: null });
    },

    cycleTarget: () => {
      const s = get();
      if (s.mapMode) {
        // 訪問済みの広間の中央を巡回(一周の最後にプレイヤー位置へ戻る)。
        const ids = [...s.visitedChambers].sort((a, b) => a - b);
        if (ids.length === 0) return;
        chamberCycleIdx = (chamberCycleIdx + 1) % (ids.length + 1);
        view.base = null; // パンで外していても巡回先へ再アンカー
        sfx.play('cursor');
        if (chamberCycleIdx === ids.length) {
          set({ focus: s.player.pos });
        } else {
          set({ focus: s.dungeon.chambers[ids[chamberCycleIdx]].center });
        }
        return;
      }
      if (s.phase !== 'play' || s.busy) return;
      // 部屋内(通路に居るときは近傍8歩)の敵を距離順に巡回し、視線を向けて情報を出す。
      const ch = s.cellChamber.get(cellKey(s.player.pos));
      const cands = s.beasts
        .filter(
          (b) =>
            b.alive &&
            s.discovered.has(cellKey(b.pos)) &&
            (ch !== undefined
              ? s.cellChamber.get(cellKey(b.pos)) === ch
              : stepDist(s.player.pos, b.pos) <= 8),
        )
        .sort(
          (x, y) => stepDist(s.player.pos, x.pos) - stepDist(s.player.pos, y.pos) || x.id - y.id,
        );
      if (cands.length === 0) {
        pushLog('近くに敵の気配はない');
        return;
      }
      beastCycleIdx = (beastCycleIdx + 1) % cands.length;
      const b = cands[beastCycleIdx];
      const g = gazeAngles(s.player.pos, b.pos);
      setGazeGoal(g.phi, g.theta);
      sfx.play('cursor');
      set({ hoverBeastId: b.id });
    },

    toggleMute: () => {
      const m = !get().muted;
      sfx.setMuted(m);
      set({ muted: m });
    },
  };

  /** restart 直後の明かり+到達範囲(クロージャ内関数を初期化からも使うため)。 */
  function discoverInit(): void {
    discover();
    refreshReach();
  }
});

// 初期状態にも明かりと到達範囲を入れる(モジュール読み込み時に1度)。
{
  const s = useRogue.getState();
  s.restart(s.seed);
}
