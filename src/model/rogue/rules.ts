// ローグの純ヘルパ(rogue-17 で state/rogue.ts から分離)。
// すべて (データ) → 値 の純関数。乱数が要るものは rng 関数を引数で受ける。

import { OFFSETS, cellKey, layer, neighbors, worldPos, type Cell, type CellKey } from '../fcc';
import type { Dungeon } from '../dungeon';
import { ITEMS, stackAtk, stackDef, stackEvade } from '../loot';
import { LIGHT, isDimLight, type Beast, type Decoy, type LightLevel, type PlacedTrap, type PlayerState, type Turret } from './types';
import { knotActive, rankOf, type EquippedSkill } from './mastery';

/** 素手の攻撃力。 */
export const BASE_ATK = 2;
/** 延焼の毎ターンダメージ。 */
export const BURN_DMG = 2;

/**
 * 深度表示(入口=0、下ほど正)。スロット式生成(rogue-16)ではスロット1段の
 * 下降がレイヤ約10に相当するため、1/4 に換算して従来の深度ペース
 * (1部屋の下降 ≈ +2〜3)と敵・アイテムの深度テーブルを保つ。
 */
export function depthOf(c: Cell): number {
  return Math.round(-layer(c) / 4) + 0; // +0 で -0 を正規化
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

/** a..b の整数(両端含む)。乱数列は呼び出し側が管理する。 */
export function irnd(rng: () => number, a: number, b: number): number {
  return a + Math.floor(rng() * (b - a + 1));
}

/** ローカル日付を 'YYYY-MM-DD' に整形(dailySeed・ラン履歴の日付表示に使う)。 */
export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 「本日の迷宮」(rogue-20)のシード: ローカル日付を parseSeed のハッシュ経路で数値化。 */
export function dailySeed(date: Date): number {
  return parseSeed(isoDate(date))!; // 日付文字列は常に非空なので undefined にはならない
}

export function beastAt(beasts: readonly Beast[], k: CellKey): Beast | undefined {
  return beasts.find((b) => b.alive && cellKey(b.pos) === k);
}

/**
 * 装備込みの攻撃力(rogue-23: 装着スキルの補正込み。rogue-27: ランク制。rogue-35: 研鑽廃止)。
 * eq 省略時は素の値(既存の呼び出し元・テストへの後方互換)。
 * - ryote(両手保持): 片手武器装備・盾スロットが空のとき、攻撃+3(rogue-35で増強)
 * - katate(片手扱い): 両手武器+盾の同時装備中、攻撃−2
 *   (命中制はまだ無いので攻撃減で代替。将来、命中率を導入したら命中−へ置換する)
 */
export function playerAtk(
  p: PlayerState,
  eq: readonly EquippedSkill[] = [],
  lightLevel?: LightLevel,
): number {
  let atk = BASE_ATK + (p.weapon ? stackAtk(p.weapon) : 0);
  if (p.weapon && !ITEMS[p.weapon.item].twoHanded && !p.shield && rankOf(eq, 'ryote') >= 1) atk += 3; // 両手保持(rogue-35: +2→+3)
  if (p.weapon && ITEMS[p.weapon.item].twoHanded && p.shield && rankOf(eq, 'katate') >= 1) atk -= 2;
  // rogue-24: 拳闘・灯火の補正(rogue-27: 拳打はランク制)。
  const kenPunchRank = rankOf(eq, 'kenPunch');
  if (!p.weapon && kenPunchRank > 0) atk += [3, 5, 7][kenPunchRank - 1]; // 拳打(素手)
  if (!p.weapon && p.barrier > 0 && knotActive(eq, 'kouken')) atk += 2; // 甲拳(結び・rogue-27)
  if (p.hp === p.maxHp && rankOf(eq, 'kenMuku') >= 1) atk += 2; // 無傷の型
  if (p.hp * 4 <= p.maxHp && p.barrier === 0 && rankOf(eq, 'kenHaisui') >= 1) atk += 3; // 背水
  if (lightLevel !== undefined && isDimLight(lightLevel) && rankOf(eq, 'hiShibori') >= 1) atk += 2; // 絞り撃ち
  return atk;
}
export function playerDef(p: PlayerState): number {
  return p.armor ? stackDef(p.armor) : 0;
}
/**
 * 盾の回避%(rogue-22)。盾なしは 0(=beastStrike が回避判定の乱数を引かない)。
 * jutsu(盾術): 盾装備中、回避+ランク段階(8/12/16。rogue-35で増強・反撃は返しへ分離)。
 * keikai(警戒・rogue-35): 遠隔攻撃への回避+10%(盾不要・掲盾と加算)。
 * rogue-30(二刀流): 盾スロットには片手武器も入りうる — 盾装備中の判定は
 * kind==='shield' のときだけ有効にする(左手武器では盾ボーナスが乗らない)。
 */
export function playerEvade(
  p: PlayerState,
  eq: readonly EquippedSkill[] = [],
  ranged = false,
): number {
  const hasShield = p.shield !== null && ITEMS[p.shield.item].kind === 'shield';
  let evade = hasShield ? stackEvade(p.shield!) : 0;
  const jutsuRank = rankOf(eq, 'jutsu');
  if (hasShield && jutsuRank > 0) evade += [8, 12, 16][jutsuRank - 1];
  if (p.hp * 4 <= p.maxHp && p.barrier === 0 && rankOf(eq, 'kenHaisui') >= 1) evade += 25; // 背水
  if (ranged && hasShield && rankOf(eq, 'tateKakage') >= 1) evade += 20; // 掲盾(遠隔のみ)
  if (ranged && rankOf(eq, 'keikai') >= 1) evade += 10; // 警戒(遠隔のみ・盾不要・掲盾と加算)
  return evade;
}

/**
 * たいまつの視界半径(rogue-35)。基本は明かり段階の see。心眼(shingan)装着中は
 * 「絞る」以下(絞る・消す)で+1(旧・消灯 hiShobo の解禁効果を吸収した強化側)。
 */
export function sightRadius(lightLevel: LightLevel, eq: readonly EquippedSkill[] = []): number {
  const bonus = isDimLight(lightLevel) && rankOf(eq, 'shingan') >= 1 ? 1 : 0;
  return LIGHT[lightLevel].see + bonus;
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
export function placeableCells(s: {
  player: PlayerState;
  dungeon: Dungeon;
  discovered: ReadonlySet<CellKey>;
  traps: readonly PlacedTrap[];
  turrets: readonly Turret[];
  decoys: readonly Decoy[];
  beasts: readonly Beast[];
}): Cell[] {
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
 * ずらし動詞(rogue-35: 盾打ち・突進・替り身)の共通幾何。ノックバック方向は
 * 「攻撃者→対象の延長方向の隣接セル(FCC 近傍で最も方向余弦が大きい空セル。決定論)」
 * — worldPos で世界座標化した方向ベクトルと、対象の12近傍オフセットそれぞれの
 * 世界座標ベクトルの内積(コサイン類似度)を比較する。同値は OFFSETS の先頭優先
 * (常に同じ結果になる決定論)。
 */
function knockbackOffset(attacker: Cell, target: Cell): Cell {
  const a = worldPos(attacker[0], attacker[1], attacker[2], 1);
  const t = worldPos(target[0], target[1], target[2], 1);
  const dx = t.x - a.x;
  const dy = t.y - a.y;
  const dz = t.z - a.z;
  const dirLen = Math.hypot(dx, dy, dz) || 1;
  let best: Cell = OFFSETS[0];
  let bestCos = -Infinity;
  for (const o of OFFSETS) {
    const w = worldPos(o[0], o[1], o[2], 1);
    const wLen = Math.hypot(w.x, w.y, w.z) || 1;
    const cos = (dx * w.x + dy * w.y + dz * w.z) / (dirLen * wLen);
    if (cos > bestCos) {
      bestCos = cos;
      best = o;
    }
  }
  return best;
}

/**
 * dir 方向へ maxSteps 歩まで進める通過可能セルの列(遮られたら手前で止まる)。
 * passable(k) は「そのセルへ進んでよいか」の判定(discovered 要否は文脈で異なるため
 * 呼び出し側から渡す — 突進は発見済みのみ、ノックバックは敵の移動と同じ規律で判定する)。
 */
export function straightSteps(
  dungeon: Dungeon,
  passable: (k: CellKey) => boolean,
  from: Cell,
  dir: Cell,
  maxSteps: number,
): Cell[] {
  const path: Cell[] = [];
  let cur = from;
  for (let i = 0; i < maxSteps; i++) {
    const next: Cell = [cur[0] + dir[0], cur[1] + dir[1], cur[2] + dir[2]];
    const k = cellKey(next);
    if (!dungeon.open.has(k) || !passable(k)) break;
    path.push(next);
    cur = next;
  }
  return path;
}

/**
 * ノックバック先の経路(rogue-35: 盾打ち)。attacker→target の延長方向へ maxSteps 歩まで
 * (遮られたら手前で止まる。0歩=押せなかった)。
 */
export function knockbackPath(
  dungeon: Dungeon,
  passable: (k: CellKey) => boolean,
  attacker: Cell,
  target: Cell,
  maxSteps: number,
): Cell[] {
  const dir = knockbackOffset(attacker, target);
  return straightSteps(dungeon, passable, target, dir, maxSteps);
}

/**
 * 突進(rogue-35: tosshin)で選べる移動先(12方向×最大2歩・発見済みの空セルのみ)。
 * 重複は含めない(セルキーで一意化)。
 */
export function dashCells(s: {
  player: PlayerState;
  dungeon: Dungeon;
  discovered: ReadonlySet<CellKey>;
  beasts: readonly Beast[];
  traps: readonly PlacedTrap[];
  turrets: readonly Turret[];
  decoys: readonly Decoy[];
}): Cell[] {
  const occupied = new Set<CellKey>([
    ...s.traps.map((t) => cellKey(t.pos)),
    ...s.turrets.map((t) => cellKey(t.pos)),
    ...s.decoys.map((d) => cellKey(d.pos)),
    ...s.beasts.filter((b) => b.alive).map((b) => cellKey(b.pos)),
  ]);
  const passable = (k: CellKey) => s.discovered.has(k) && !occupied.has(k);
  const seen = new Set<CellKey>();
  const out: Cell[] = [];
  for (const dir of OFFSETS) {
    for (const c of straightSteps(s.dungeon, passable, s.player.pos, dir, 2)) {
      const k = cellKey(c);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

/**
 * TAB 視線の方位オフセット(rad)。プレイヤーを挟んで敵の真反対にカメラを置くと
 * カメラ→プレイヤー→敵が一直線になり、プレイヤーモデル自身が敵を隠してしまう。
 * 「プレイヤーの斜め後ろ」寄りにずらして肩越しに見えるようにする(45°〜60°が目安、
 * 90°は横に寄りすぎて「見ている感」が薄れる)。符号は回り込む向き: 負にすると
 * 敵が画面の反対側(右上の所持品パネルの裏に隠れない側)へ寄る。
 */
const GAZE_YAW = -Math.PI / 3; // -60°

/**
 * from から to を見る視線のカメラ角(球面座標)。カメラは from を挟んで to の反対側
 * から GAZE_YAW だけ斜めにずらした位置に回り込む(=画面上で to が奥・斜め手前に
 * プレイヤーの肩、という構図になり、プレイヤーモデルが敵を隠さない)。theta は
 * 相手との高低差を反映しつつ、見やすい俯角レンジ [0.15, 0.9] にクランプする。
 */
export function gazeAngles(from: Cell, to: Cell): { phi: number; theta: number } {
  const a = worldPos(from[0], from[1], from[2], 1);
  const b = worldPos(to[0], to[1], to[2], 1);
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const phi = Math.atan2(dx, dz) + GAZE_YAW;
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
