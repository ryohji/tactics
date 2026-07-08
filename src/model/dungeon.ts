// 蟻の巣ダンジョン(rogue-1)。Three 非依存の純 TS。
// 岩の塊の中に空洞セル(open)を掘る。広間(不整形の胞塊)を作るとき 2〜3本の通路を
// 先に掘り切り、終端を「スタブ」として記録する。プレイヤーがスタブ終端へ近づいたら
// そこへ次の広間を生成する(maybeExpand)。方位は下向きバイアス(蟻の巣は深くへ)。
// 生成はすべて dungeon 自身の seed 付き RNG で決まる(同 seed なら同じ巣)。

import { OFFSETS, cellKey, keyToCell, worldPos, type Cell, type CellKey } from './fcc';

export interface Chamber {
  id: number;
  center: Cell;
  /** おおよその半径(格子ワールド単位)。 */
  r: number;
  /** 広間を構成する空洞セル(通路は含まない)。敵・宝の湧き位置に使う。 */
  cells: CellKey[];
}

/** 掘りかけ通路の終端。ここに近づくと次の広間が生成される。 */
export interface Stub {
  id: number;
  from: number;
  exit: Cell;
  /** 通路の入り口(広間の縁を出た最初のセル)。探索バブルの表示位置。 */
  mouth: Cell;
  /** この通路が通ったセル列。展開時に「自分の通路」を重なり判定から除くため。 */
  path: CellKey[];
  used: boolean;
}

export interface Dungeon {
  open: Set<CellKey>;
  chambers: Chamber[];
  stubs: Stub[];
  /** 生成シード(スタブごとの導出 rng と、プレイ再現の表示に使う)。 */
  seed: number;
  rng: () => number;
  /** 掘削のたびに増える(描画・テストの変更検知用)。 */
  rev: number;
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
 * セル位置から導出する rng(シード+セル座標+用途 salt のハッシュ)。
 * 迷宮生成をこの導出 rng で行うことで、同じシードなら**探索の順序に依らず**
 * 同じ迷宮になる(共有ストリームだと先に掘った順で結果が変わる)。プレイ再現の要。
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

/**
 * 広間を掘る。center から BFS し、セルごとに揺らいだ半径 r·(0.72..1.27) 以内なら空洞化。
 * 戻り値は広間セル(既に空洞だったセルも含む)。
 */
function carveChamber(dg: Dungeon, center: Cell, r: number): CellKey[] {
  const cells: CellKey[] = [];
  const seen = new Set<CellKey>([cellKey(center)]);
  const queue: Cell[] = [center];
  while (queue.length > 0) {
    const c = queue.shift()!;
    const k = cellKey(c);
    const rr = r * (0.72 + 0.55 * dg.rng());
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
 * start から方向 dir(ワールド単位ベクトル)へ長さ len の通路を掘る。
 * 各歩で目標点へ最も近づく近傍を選ぶ(確率 0.35 で次点=蛇行)。
 * 出発広間のセル(home)と自分の掘り跡以外の**既存空洞セルには入らない**
 * (他の広間・他の通路と重ならない)。
 * 掘り進めなくなったらそこで打ち切る(短すぎる終端は呼び出し側が捨てる)。
 * 終端セル・入り口(start から mouthR を最初に越えたセル)・通ったセル列を返す。
 * 注: かつて「確率 0.3 で脇を1胞広げる」処理があったが、開口1面だけの壁内ポケット
 * (見た目は壁なのに歩けて、切断時はセル形の穴に見える)を量産したため撤去した。
 */
function carveTunnel(
  dg: Dungeon,
  start: Cell,
  dir: { x: number; y: number; z: number },
  len: number,
  mouthR: number,
  home: ReadonlySet<CellKey>,
): { exit: Cell; mouth: Cell; path: CellKey[] } {
  const s = worldPos(start[0], start[1], start[2], 1);
  const goal = { x: s.x + dir.x * len, y: s.y + dir.y * len, z: s.z + dir.z * len };
  const own = new Set<CellKey>([cellKey(start)]);
  const path: CellKey[] = [];
  let cur = start;
  let mouth: Cell | null = null;
  const maxSteps = Math.ceil(len) + 8;
  for (let i = 0; i < maxSteps; i++) {
    // 掘ってよい近傍(未開 or 出発広間のセル or 自分の掘り跡)から目標に近い順に2つ選ぶ。
    let best: Cell | null = null;
    let second: Cell | null = null;
    let bd = Infinity;
    let sd = Infinity;
    for (const o of OFFSETS) {
      const n: Cell = [cur[0] + o[0], cur[1] + o[1], cur[2] + o[2]];
      const nk = cellKey(n);
      if (dg.open.has(nk) && !own.has(nk) && !home.has(nk)) continue;
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
    if (best === null) break; // 既存の空洞に囲まれた — ここで行き止まり
    cur = dg.rng() < 0.35 && second ? second : best;
    const ck = cellKey(cur);
    dg.open.add(ck);
    own.add(ck);
    path.push(ck);
    if (mouth === null && distW(start, cur) > mouthR) mouth = cur;
    if (Math.min(bd, sd) < 1.0) break;
  }
  dg.rev++;
  return { exit: cur, mouth: mouth ?? cur, path };
}

/**
 * 兄弟スタブの終端同士に要求する最小距離。広間の半径は最大 4、セルごとの揺らぎ
 * 上限は 1.27 倍なので、中心間が 1.27×(4+4)≈10.2 以上あれば広間は重ならない。
 */
const SIBLING_SEP = 11;

/** 広間から 2〜3 本の通路を掘り、終端をスタブ登録する(少なくとも1本は下向き)。 */
function spawnStubs(dg: Dungeon, ch: Chamber): void {
  const n = dg.rng() < 0.45 ? 3 : 2;
  const home: ReadonlySet<CellKey> = new Set(ch.cells);
  const exits: Cell[] = [];
  let hasDown = false;
  for (let i = 0; i < n; i++) {
    const az = dg.rng() * Math.PI * 2;
    let el = 0.15 - 0.75 * dg.rng(); // (-0.6 .. 0.15) — 下向きバイアス
    if (i === n - 1 && !hasDown) el = -(0.3 + 0.35 * dg.rng());
    if (el < -0.25) hasDown = true;
    const dir = {
      x: Math.cos(el) * Math.cos(az),
      y: Math.sin(el),
      z: Math.cos(el) * Math.sin(az),
    };
    const len = ch.r + 7 + dg.rng() * 7;
    const { exit, mouth, path } = carveTunnel(dg, ch.center, dir, len, ch.r + 1, home);
    // 壁に沿って戻ってきた等で広間の縁に留まった通路はスタブにしない(掘った跡は残る)。
    if (distW(exit, ch.center) < ch.r + 3) continue;
    // 兄弟の終端が近すぎると将来の広間同士が重なるので登録しない(通路は残る)。
    if (exits.some((e) => distW(e, exit) < SIBLING_SEP)) continue;
    exits.push(exit);
    dg.stubs.push({ id: dg.stubs.length, from: ch.id, exit, mouth, path, used: false });
  }
}

/**
 * スタブ位置に新しい広間を生成し、そこからさらにスタブを伸ばす。
 * 自分の通路**以外**の既存空洞(他の広間・他の通路)と重ならない半径まで絞り、
 * 部屋にならないほど窮屈なら生成しない(null。掘ってあった通路は行き止まりとして
 * 残る)。重複領域は cellChamber の所属が曖昧になり、マップのフォーカスや湧きが
 * 狂うため禁止。通路側も carveTunnel が既存空洞を避けるので、巣のどの2要素も
 * セルを共有しない。兄弟間は SIBLING_SEP で先に分離済みなので、この絞りが効く
 * のは通路が既存の巣へ回り込んだとき(まれ)だけ — 探索順への影響も実質出ない。
 */
export function expandAt(dg: Dungeon, stub: Stub): Chamber | null {
  stub.used = true;
  // 掘削 rng をスタブ位置から導出し直す(探索順に依らない決定性)。
  dg.rng = cellRng(dg.seed, stub.exit, 1);
  let r = 2 + Math.floor(dg.rng() * 3); // 2..4
  // 最寄りの「自通路以外の空洞セル」までの距離 d に対し 1.27r + 0.5 ≤ d を要求
  // (1.27 は carveChamber の揺らぎ上限)。path は旧セーブに無いことがある。
  const own = new Set<CellKey>(stub.path ?? []);
  own.add(cellKey(stub.exit));
  let dMin = Infinity;
  for (const k of dg.open) {
    if (own.has(k)) continue;
    const d = distW(stub.exit, keyToCell(k));
    if (d < dMin) dMin = d;
  }
  r = Math.min(r, Math.floor((dMin - 0.5) / 1.27));
  if (r < 2) return null;
  const cells = carveChamber(dg, stub.exit, r);
  const ch: Chamber = { id: dg.chambers.length, center: stub.exit, r, cells };
  dg.chambers.push(ch);
  // 全部の通路が捨てられて巣が行き止まりにならないよう、0本なら掘り直す。
  for (let guard = 0; guard < 3 && !dg.stubs.some((s) => s.from === ch.id); guard++) {
    spawnStubs(dg, ch);
  }
  return ch;
}

/** pos から radius 以内に未使用スタブがあれば広間を生成する。生成した広間を返す。 */
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

/** 入口広間(原点・r=3)とスタブ2本以上を持つ初期ダンジョン。 */
export function createDungeon(seed: number): Dungeon {
  const dg: Dungeon = { open: new Set(), chambers: [], stubs: [], seed, rng: lcg(seed), rev: 0 };
  const cells = carveChamber(dg, [0, 0, 0], 3);
  const entrance: Chamber = { id: 0, center: [0, 0, 0], r: 3, cells };
  dg.chambers.push(entrance);
  for (let guard = 0; guard < 5 && dg.stubs.length < 2; guard++) spawnStubs(dg, entrance);
  return dg;
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
