// 蟻の巣ダンジョン(rogue-1 / rogue-16 でスロット式に再設計)。Three 非依存の純 TS。
//
// ## 設計(rogue-16): すべてを (シード, 位置) の純関数にする
// 旧設計は「広間を掘り、通路を伸ばし、終端に次の広間」を逐次成長させていた。
// 重なり禁止を「その時点で存在する空洞を避ける」チェックで入れたところ、
// 巣の形が探索順に依存してしまい(30シード中23で分岐)、シード再現と競合した。
// そこで生成を次の構造に整理した:
//
// - 空間を一辺 SLOT=12(ワールド単位)の立方体スロットに分割する。
// - 各スロットの「広間プロフィール」(存在するか・中心アンカー・半径)は
//   (seed, スロット座標) の純関数。**実体化しなくても計算できる。**
// - 広間はスロットに最大1つ、予約領域(1.27r+マージン)はスロット内に収まる
//   → 広間同士の重なりは構造的に不可能。
// - 通路は隣接スロットのアンカー間を結ぶリンクの純関数で、掘削中は
//   **両端スロットの外に出ない** → 他の広間・他系統の通路と交わらない
//   (同じ広間に接する通路同士が戸口付近で触れるのだけは許す)。
// - 掘削はすべて加法的(和集合)なので、どの順に実体化しても同じ巣になる。
//   プレイヤーの接近(maybeExpand)は「無限に広がる決定済みの巣のどこまでを
//   実体化するか」だけを決める。
//
// 深さ: スロット1段の下降はレイヤ約10に相当するため、ゲーム側の深度表示
// (rogue.ts depthOf)はレイヤ/4 に換算して従来のペース(1部屋あたり+2〜3)を保つ。

import { OFFSETS, cellKey, keyToCell, latticeAt, layer, nearestFCC, worldPos, type Cell, type CellKey } from './fcc';

export interface Chamber {
  id: number;
  center: Cell;
  /** おおよその半径(格子ワールド単位)。 */
  r: number;
  /** 広間を構成する空洞セル(通路は含まない)。敵・宝の湧き位置に使う。 */
  cells: CellKey[];
  /** 崩落(rogue-19b)で墓標化(cells=[])されたか。id は配列添字と一致するため抜かない。 */
  collapsed?: boolean;
}

/** 掘りかけ通路の終端(=隣接スロットのアンカー)。近づくと広間が実体化する。 */
export interface Stub {
  id: number;
  from: number;
  exit: Cell;
  /** 通路の入り口(広間の縁を出た最初のセル)。探索バブルの表示位置。 */
  mouth: Cell;
  /** この通路が通ったセル列(テスト・重なり検証用)。 */
  path: CellKey[];
  used: boolean;
}

export interface Dungeon {
  open: Set<CellKey>;
  chambers: Chamber[];
  stubs: Stub[];
  /** 実体化済みスロット(slotKey → chamber id)。 */
  slots: Map<string, number>;
  /** 生成シード(プレイ再現の表示にも使う)。 */
  seed: number;
  rng: () => number;
  /** 掘削のたびに増える(描画・テストの変更検知用)。 */
  rev: number;
  /**
   * 崩落面(rogue-19b)。この layer より上は崩落済み。初期値は崩落なしを表す
   * 十分大きい JSON 安全な整数(Infinity は JSON にできないので使わない)。
   */
  cutLayer: number;
}

/** 格子ワールド距離(S=1 の worldPos 間ユークリッド)。 */
export function distW(a: Cell, b: Cell): number {
  const p = worldPos(a[0], a[1], a[2], 1);
  const q = worldPos(b[0], b[1], b[2], 1);
  return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
}

/** 12近傍か(格子座標の差の二乗和が 2)。 */
export function adjacent(a: Cell, b: Cell): boolean {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz === 2;
}

/**
 * FCC 格子の最短歩数(障害物なし)。12近傍の1歩は2成分を±1する(和は偶数を保つ)ので、
 * max(各成分の絶対値, 成分絶対値和の半分) が下限かつ達成可能
 * (マンハッタン距離の FCC 版。両引数が正規セルなら整数になる)。
 */
export function stepDist(a: Cell, b: Cell): number {
  const dx = Math.abs(a[0] - b[0]);
  const dy = Math.abs(a[1] - b[1]);
  const dz = Math.abs(a[2] - b[2]);
  return Math.max(dx, dy, dz, (dx + dy + dz) / 2);
}

/** seed 付き LCG。 */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * 座標から導出する rng(シード+座標+用途 salt のハッシュ)。
 * 生成をこの導出 rng で行うことが「探索順に依らず同じ迷宮」の要。
 */
export function cellRng(seed: number, c: Cell, salt: number): () => number {
  let h = (seed ^ Math.imul(salt, 0x9e3779b9)) >>> 0;
  for (const v of c) {
    h = (h ^ (v + 0x7f4a7c15)) >>> 0;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
  }
  return lcg(h);
}

// --- スロット(純関数の世界) -------------------------------------------------

/** スロットの一辺(ワールド単位)。広間の最大到達 1.27×4 + 余白が半辺に収まる寸法。 */
export const SLOT = 12;
/** carveChamber の半径揺らぎ上限。 */
const FLUX = 1.27;
/** アンカーのセル量子化誤差 + 安全余白(ワールド単位)。 */
const MARGIN = 1.3;

const SALT_PROFILE = 101;
const SALT_EXISTS = 102;
const SALT_LINKS = 103;
const SALT_CARVE = 104;
const SALT_TUNNEL = 105;

type Slot = [number, number, number];

const slotKey = (s: Slot): string => `${s[0]},${s[1]},${s[2]}`;

/** セルの属するスロット。 */
export function slotOfCell(c: Cell): Slot {
  const w = worldPos(c[0], c[1], c[2], 1);
  return [
    Math.floor((w.x + SLOT / 2) / SLOT),
    Math.floor((w.y + SLOT / 2) / SLOT),
    Math.floor((w.z + SLOT / 2) / SLOT),
  ];
}

/** rogue.ts の resume が slots マップを再構築するための鍵。 */
export function slotKeyOfCell(c: Cell): string {
  return slotKey(slotOfCell(c));
}

/** ワールド座標 → 最寄りの FCC セル(worldPos の逆変換 + 量子化)。 */
function cellAtWorld(wx: number, wy: number, wz: number): Cell {
  const [a, b, c] = latticeAt(wx, wy, wz);
  return nearestFCC(a, b, c);
}

/** スロットに広間があるか(なければ巣の空隙 — 不規則さの源)。入口は必ずある。 */
function slotExists(seed: number, s: Slot): boolean {
  if (s[0] === 0 && s[1] === 0 && s[2] === 0) return true;
  return cellRng(seed, s, SALT_EXISTS)() < 0.85;
}

/** スロットの広間プロフィール(アンカーと半径)。入口は原点・r=3 に固定。 */
function profile(seed: number, s: Slot): { anchor: Cell; r: number } {
  if (s[0] === 0 && s[1] === 0 && s[2] === 0) return { anchor: [0, 0, 0], r: 3 };
  const rng = cellRng(seed, s, SALT_PROFILE);
  const r = 2 + Math.floor(rng() * 3); // 2..4
  // 予約領域(FLUX*r + MARGIN)がスロット内に収まる範囲でジッタ(小部屋ほど動ける)。
  const jmax = Math.max(0, SLOT / 2 - MARGIN - FLUX * r);
  const jx = (rng() * 2 - 1) * jmax;
  const jy = (rng() * 2 - 1) * jmax;
  const jz = (rng() * 2 - 1) * jmax;
  return { anchor: cellAtWorld(s[0] * SLOT + jx, s[1] * SLOT + jy, s[2] * SLOT + jz), r };
}

/** 面隣接の6スロット(候補)。ワールド y が下がる方向が「深い」。 */
const SLOT_DIRS: readonly Slot[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, -1, 0], // 下
  [0, 1, 0], // 上
];

/**
 * スロットから伸びるリンク(隣接スロットの列)。純関数。
 * 下向きバイアス(下 3 / 水平 1.2 / 上 0.4)で 2〜3 本選び、
 * 下が候補にあるのに1本も選ばれなければ最後の1本を下に差し替える。
 */
function slotLinks(seed: number, s: Slot): Slot[] {
  const rng = cellRng(seed, s, SALT_LINKS);
  const n = rng() < 0.45 ? 3 : 2;
  const pool: { t: Slot; w: number }[] = [];
  for (const d of SLOT_DIRS) {
    const t: Slot = [s[0] + d[0], s[1] + d[1], s[2] + d[2]];
    if (!slotExists(seed, t)) continue;
    pool.push({ t, w: d[1] < 0 ? 3 : d[1] > 0 ? 0.4 : 1.2 });
  }
  const picked: Slot[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    let total = 0;
    for (const p of pool) total += p.w;
    let x = rng() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      x -= pool[idx].w;
      if (x < 0) break;
    }
    picked.push(pool[idx].t);
    pool.splice(idx, 1);
  }
  const down = picked.some((t) => t[1] < s[1]);
  if (!down) {
    const t: Slot = [s[0], s[1] - 1, s[2]];
    if (slotExists(seed, t) && picked.length > 0) picked[picked.length - 1] = t;
  }
  return picked;
}

/** リンクの正規化キー(どちら側から掘っても同じ通路)。 */
function linkKey(a: Slot, b: Slot): string {
  const ka = slotKey(a);
  const kb = slotKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/** リンク専用の rng(両端スロットから対称に導出)。 */
function linkRng(seed: number, a: Slot, b: Slot): () => number {
  const [lo, hi] = slotKey(a) < slotKey(b) ? [a, b] : [b, a];
  const s1 = Math.floor(cellRng(seed, lo, SALT_TUNNEL)() * 0x100000000);
  return cellRng(s1, hi, SALT_TUNNEL);
}

// --- 掘削(加法的 — どの順に実体化しても同じ和集合) --------------------------

/**
 * 広間を掘る。center から BFS し、セルごとに揺らいだ半径 r·(0.72..1.27) 以内なら
 * 空洞化。揺らぎはスロット導出 rng なので同スロットなら常に同じ形。
 */
function carveChamber(dg: Dungeon, s: Slot, center: Cell, r: number): CellKey[] {
  const rng = cellRng(dg.seed, s, SALT_CARVE);
  const cells: CellKey[] = [];
  const seen = new Set<CellKey>([cellKey(center)]);
  const queue: Cell[] = [center];
  while (queue.length > 0) {
    const c = queue.shift()!;
    const k = cellKey(c);
    const rr = r * (0.72 + 0.55 * rng());
    if (distW(center, c) > rr) continue;
    dg.open.add(k);
    cells.push(k);
    for (const o of OFFSETS) {
      const n: Cell = [c[0] + o[0], c[1] + o[1], c[2] + o[2]];
      const nk = cellKey(n);
      if (!seen.has(nk)) {
        seen.add(nk);
        queue.push(n);
      }
    }
  }
  dg.rev++;
  return cells;
}

/**
 * リンク(a→b)の通路を掘る。アンカー間を蛇行しながら結ぶ。
 * **両端スロットの外に出ない**(隣接スロットの合併は凸なので必ず進める)。
 * どちら側から掘っても同じセル列になる(rng・端点とも対称)。
 */
function carveLink(
  dg: Dungeon,
  a: Slot,
  b: Slot,
): { exitA: Cell; exitB: Cell; path: CellKey[] } {
  const rng = linkRng(dg.seed, a, b);
  const [lo, hi] = slotKey(a) < slotKey(b) ? [a, b] : [b, a];
  const from = profile(dg.seed, lo).anchor;
  const to = profile(dg.seed, hi).anchor;
  const goal = worldPos(to[0], to[1], to[2], 1);
  const inLink = (c: Cell): boolean => {
    const s = slotOfCell(c);
    return (
      (s[0] === lo[0] && s[1] === lo[1] && s[2] === lo[2]) ||
      (s[0] === hi[0] && s[1] === hi[1] && s[2] === hi[2])
    );
  };
  const path: CellKey[] = [];
  let cur = from;
  dg.open.add(cellKey(cur));
  const maxSteps = Math.ceil(distW(from, to)) * 3 + 12;
  for (let i = 0; i < maxSteps && cellKey(cur) !== cellKey(to); i++) {
    let best: Cell | null = null;
    let second: Cell | null = null;
    let bd = Infinity;
    let sd = Infinity;
    for (const o of OFFSETS) {
      const n: Cell = [cur[0] + o[0], cur[1] + o[1], cur[2] + o[2]];
      if (!inLink(n)) continue;
      const w = worldPos(n[0], n[1], n[2], 1);
      const d = Math.hypot(w.x - goal.x, w.y - goal.y, w.z - goal.z);
      if (d < bd) {
        second = best;
        sd = bd;
        best = n;
        bd = d;
      } else if (d < sd) {
        second = n;
        sd = d;
      }
    }
    if (best === null) break; // 起こらないはずだが安全弁
    // 蛇行。ただし目標を追い越さないよう、終盤は最良手のみ。
    cur = rng() < 0.35 && second && bd > 2.5 ? second : best;
    const ck = cellKey(cur);
    dg.open.add(ck);
    path.push(ck);
  }
  dg.rev++;
  return { exitA: from, exitB: to, path };
}

// --- 実体化(遅延ロード) -----------------------------------------------------

/**
 * スロットの広間を実体化する: 広間を掘り、リンクの通路を掘り、未実体化の
 * 行き先をスタブとして登録する。既に実体化済みなら null(重複展開なし)。
 * このスロットを指していた他系統のスタブは「使用済み」に落とす(合流=ループ)。
 */
function materializeSlot(dg: Dungeon, s: Slot): Chamber | null {
  const key = slotKey(s);
  if (dg.slots.has(key) || !slotExists(dg.seed, s)) return null;
  const { anchor, r } = profile(dg.seed, s);
  // 崩落面の近く・上には二度と生成しない(-8 は広間半径ぶんの余白)。
  if (layer(anchor) > dg.cutLayer - 8) return null;
  const cells = carveChamber(dg, s, anchor, r);
  const ch: Chamber = { id: dg.chambers.length, center: anchor, r, cells };
  dg.chambers.push(ch);
  dg.slots.set(key, ch.id);
  // このスロットへ向いていた他のスタブは開通済みになった。
  for (const st of dg.stubs) {
    if (!st.used && slotKeyOfCell(st.exit) === key) st.used = true;
  }
  // 掘削済みリンク(既存スタブ+実体化済みペア)を数え上げて重複掘削を避ける。
  const dug = new Set<string>();
  for (const st of dg.stubs) {
    dug.add(linkKey(slotOfCell(dg.chambers[st.from].center), slotOfCell(st.exit)));
  }
  for (const t of slotLinks(dg.seed, s)) {
    const lk = linkKey(s, t);
    if (dug.has(lk)) continue;
    dug.add(lk);
    const { path } = carveLink(dg, s, t);
    const tKey = slotKey(t);
    const target = profile(dg.seed, t).anchor;
    // 入り口 = 通路のうち、自広間の縁(r+1)を最初に越えたセル。
    // path はキー正規化順(小さいスロット→大きいスロット)なので、
    // 自分が大きい側なら逆から辿って「自分の側の戸口」を得る。
    const ordered = slotKey(s) < tKey ? path : [...path].reverse();
    let mouth: Cell = target;
    for (const k of ordered) {
      const c = keyToCell(k);
      if (distW(anchor, c) > r + 1) {
        mouth = c;
        break;
      }
    }
    dg.stubs.push({
      id: dg.stubs.length,
      from: ch.id,
      exit: target,
      mouth,
      path,
      used: dg.slots.has(tKey), // 既存の広間への合流(ループ)は最初から開通済み
    });
  }
  return ch;
}

/** スタブ位置(隣接スロットのアンカー)の広間を実体化する。 */
export function expandAt(dg: Dungeon, stub: Stub): Chamber | null {
  stub.used = true;
  return materializeSlot(dg, slotOfCell(stub.exit));
}

/** pos から radius 以内に未使用スタブがあれば広間を実体化する。生成分を返す。 */
export function maybeExpand(dg: Dungeon, pos: Cell, radius = 5): Chamber[] {
  const out: Chamber[] = [];
  for (const st of dg.stubs) {
    if (!st.used && distW(st.exit, pos) <= radius) {
      const ch = expandAt(dg, st);
      if (ch) out.push(ch);
    }
  }
  return out;
}

/** 入口広間(原点・r=3)とスタブを持つ初期ダンジョン。 */
export function createDungeon(seed: number): Dungeon {
  const dg: Dungeon = {
    open: new Set(),
    chambers: [],
    stubs: [],
    slots: new Map(),
    seed,
    rng: lcg(seed),
    rev: 0,
    cutLayer: 1e9,
  };
  materializeSlot(dg, [0, 0, 0]);
  return dg;
}

/**
 * 層リセット(rogue-19b): cutLayer より上を崩落させ、二度と戻れなくする。
 * - open からその層より上のセルを削る
 * - 中心がその層より上の広間は墓標化(cells=[]・collapsed=true。id は配列添字と
 *   一致する不変条件があるので配列からは抜かない)
 * - 出口がその層+余白より上のスタブは used に落とす(materializeSlot の
 *   ガードと合わせて、境界付近が二度と実体化しないようにする)
 */
export function collapseAbove(dg: Dungeon, cutLayer: number): void {
  dg.cutLayer = cutLayer;
  for (const k of dg.open) {
    if (layer(keyToCell(k)) > cutLayer) dg.open.delete(k);
  }
  for (const ch of dg.chambers) {
    if (!ch.collapsed && layer(ch.center) > cutLayer) {
      ch.cells = [];
      ch.collapsed = true;
    }
  }
  for (const st of dg.stubs) {
    if (layer(st.exit) > cutLayer - 8) st.used = true;
  }
  dg.rev++;
}

/** 入口から到達可能な空洞セル数(テスト・整合性確認用)。 */
export function reachableCount(dg: Dungeon, from: Cell = [0, 0, 0]): number {
  const start = cellKey(from);
  if (!dg.open.has(start)) return 0;
  const seen = new Set<CellKey>([start]);
  const queue = [from];
  while (queue.length > 0) {
    const c = queue.shift()!;
    for (const o of OFFSETS) {
      const n: Cell = [c[0] + o[0], c[1] + o[1], c[2] + o[2]];
      const nk = cellKey(n);
      if (dg.open.has(nk) && !seen.has(nk)) {
        seen.add(nk);
        queue.push(n);
      }
    }
  }
  return seen.size;
}

export { keyToCell };
