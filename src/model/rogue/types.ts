// ローグのドメイン型と定数(rogue-17 で state/rogue.ts から分離)。
// Three/React/zustand 非依存。ゲームの状態はすべてここのデータオブジェクトで
// 表現し、遷移は model/rogue/ の純関数が担う(設計原則: クラスは使わない)。

import type { Cell, CellKey } from '../fcc';
import type { Chamber, Stub } from '../dungeon';
import type { BeastKind } from '../beasts';
import type { ItemId, ItemStack, TrapKind } from '../loot';
import type { SfxName } from '../../audio/sfx';

/** rogue の表示倍率(固定)。 */
export const ROGUE_S = 2;
/** unitAnim 上のプレイヤー id(敵は 1〜)。 */
export const PLAYER_ID = 0;
/** 1クリックで歩ける最大歩数(洞窟は狭いので2近傍)。 */
export const REACH_STEPS = 2;
/** スタブ終端がこの距離に入ると次の広間が生成される。 */
export const EXPAND_R = 5;

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

/**
 * ドメイン純関数が返す副作用の記述。実行(ログ追記・効果音・FX・アニメ開始・
 * 死亡処理)は store が applyEvents でまとめて行う。SfxName は型のみの参照
 * (実行時依存はない)。
 */
export type GameEvent =
  | { kind: 'log'; msg: string }
  | { kind: 'sfx'; name: SfxName }
  | { kind: 'fx'; fx: Omit<RogueFx, 'id' | 'start'> }
  | { kind: 'anim'; unit: number; path: Cell[] }
  | { kind: 'playerDied'; cause: string }
  | { kind: 'exploreRev' };

/**
 * localStorage(persist.ts)に置くスナップショット。Set/Map は配列化する。
 * ダンジョンの rng 関数は保存しない(生成はすべて座標導出 rng のため不要)。
 */
export interface SaveData {
  /** 2: rogue-16 スロット式生成(旧 v1 の迷宮とは非互換)。 */
  v: 2;
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
