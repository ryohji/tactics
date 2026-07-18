// ローグのドメイン型と定数(rogue-17 で state/rogue.ts から分離)。
// Three/React/zustand 非依存。ゲームの状態はすべてここのデータオブジェクトで
// 表現し、遷移は model/rogue/ の純関数が担う(設計原則: クラスは使わない)。

import type { Cell, CellKey } from '../fcc';
import type { Chamber, Stub } from '../dungeon';
import type { BeastKind } from '../beasts';
import type { ItemStack } from '../loot';
import type { SfxName } from '../../audio/sfx';
import type { DraftEntry, EquippedSkill, NodeId } from './mastery';

/** rogue の表示倍率(固定)。 */
export const ROGUE_S = 2;
/** unitAnim 上のプレイヤー id(敵は 1〜)。 */
export const PLAYER_ID = 0;
/** 1クリックで歩ける最大歩数(洞窟は狭いので2近傍)。 */
export const REACH_STEPS = 2;
/** スタブ終端がこの距離に入ると次の広間が生成される。 */
export const EXPAND_R = 5;
/** 層リセット(rogue-19b)の1層ぶんの深度。この深度ごとに崩落の関門を挟む。 */
export const STRATUM_DEPTH = 8;
/**
 * ゲームバージョン(rogue-20)。バランス(敵・アイテム・湧き・崩落等)に影響する
 * 改訂のたびに手動で上げる。ラン履歴(state/history.ts)に記録し、旧バージョンの
 * 記録をタイトル画面で見分けるのに使う。
 */
export const GAME_VERSION = 'r35';

/** 明かりの段階。広げるほど 視界↑・自然回復↑・敵の気づき距離↑。 */
export const LIGHT = [
  { name: '絞る', see: 4.5, regenEvery: 10, aggro: 0.7 },
  { name: '普通', see: 6, regenEvery: 6, aggro: 1.0 },
  { name: '広げる', see: 8, regenEvery: 4, aggro: 1.35 },
  // 4段階目「消す」(rogue-24)。心得「心眼」(shingan・rogue-35で旧hiShoboを吸収)装着中のみ cycleLight の循環に現れる。
  // regenEvery は「実質回復なし」を表す大きな整数(Infinity は JSON にできない)。
  { name: '消す', see: 2, regenEvery: 9999, aggro: 0.35 },
] as const;
export type LightLevel = 0 | 1 | 2 | 3;

/** 「絞る」以下の暗さか(rogue-24: 絞り撃ち・灯火マスタリーの判定。見える距離で判定する)。 */
export function isDimLight(l: LightLevel): boolean {
  return LIGHT[l].see <= LIGHT[0].see;
}

/** 状態異常(罠で誘発)。burn=延焼DoT / confuse=混乱 / fear=恐慌 / sleep=昏睡。 */
export interface BeastStatus {
  kind: 'burn' | 'confuse' | 'fear' | 'sleep';
  turns: number;
}

/**
 * プレイヤーの状態異常(rogue-21)。poison=毎ターンHP−1(障壁を素通り)・
 * confuse=移動先が50%でずれる。同種の再付与は turns を長い方で上書き、
 * 別種は新しい方で置き換える(スロットはひとつだけ)。
 */
export interface PlayerStatus {
  kind: 'poison' | 'confuse';
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
  /** 深度係数・門番スケール(rogue-24)による個体別の上書き値(無ければ種の既定)。 */
  atkOverride?: number;
  defOverride?: number;
  /** 倒したときに落とす戦利品(湧き時に事前ロール済み。rogue-19b)。無ければ null。 */
  carry: ItemStack | null;
}

export interface GroundItem {
  id: number;
  stack: ItemStack;
  pos: Cell;
}

/**
 * 設置済みの罠(rogue-27: 罠編みで編む。敵が踏むと発動して消える)。品目・状態異常種別は
 * 持たない — 威力はランクで決まる固定値、状態異常は結び(kakei/nemuriito)が発動時に付与する。
 */
export interface PlacedTrap {
  id: number;
  pos: Cell;
  /** 発動ダメージ(編んだ時点の罠編みランクで固定。8/10/12)。 */
  power: number;
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
  /** 盾(rogue-22)。両手武器(twoHanded)とは併用不可 — 装備の排他は store 側で保証する。 */
  shield: ItemStack | null;
  pack: ItemStack[];
  /** 遺物袋(rogue-29)。上限なし、拾得時に pack の枠を消費しない。 */
  relics: ItemStack[];
  /** 上書き式シールド(rogue-21)。張り直しは加算せず新しい値で置き換える。層の崩落で消える。 */
  barrier: number;
  status: PlayerStatus | null;
  /** 解毒の水薬の予防効果(rogue-21)。残りターン、毒・混乱を新たに受けない。 */
  immune: number;
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
 * 行動ログの1エントリ: [発生ターン, 操作コード, ...引数]。将来の再生器(rogue-26)に
 * 備えた記録のみで、今は誰も読まない。cancelTravel など非同期割り込みの再現に
 * turn 付きが要るため先頭に turn を入れる。
 */
export type ActionLogEntry = [number, string, ...(number | string)[]];

/**
 * 提示中の関門ドラフト(rogue-27: 天秤ドラフト)。配列=通常の3枠(縮退でそれ未満もありうる)、
 * 'free'=見送り権を使った関門での自由選択(takeable 全提示)、null=非表示。
 */
export type SkillDraft = DraftEntry[] | 'free' | null;

/**
 * localStorage(persist.ts)に置くスナップショット。Set/Map は配列化する。
 * ダンジョンの rng 関数は保存しない(生成はすべて座標導出 rng のため不要)。
 */
export interface SaveData {
  /** 11: rogue-35 マスタリーv3(四道)+seisui フラグ追加。skillEquipped の id 集合が変わるため旧 v10 は非互換。 */
  v: 11;
  seed: number;
  /** 戦闘乱数の内部状態(再開後もプレイ再現性を保つ)。 */
  rng: number;
  seqs: { beast: number; item: number; device: number };
  dungeon: { open: CellKey[]; chambers: Chamber[]; stubs: Stub[]; rev: number; cutLayer: number };
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
  /** 通過済みの層数(rogue-19b)。 */
  stratum: number;
  /** スキルスロット数(rogue-23。初期2・関門+1・門番+1・上限8)。 */
  skillSlots: number;
  /** 装着中のスキル(id・ランク)。保存形式は [id, rank] のタプル配列。 */
  skillEquipped: [EquippedSkill['id'], number][];
  /** 提示中の関門ドラフト(rogue-27)。 */
  skillDraft: SkillDraft;
  /** 見送り権(rogue-27): true なら次の関門でドラフトの代わりに 'free'(自由選択)が出る。 */
  skillFreePick: boolean;
  /** スキルのクールダウン(rogue-30)。wanaAmi=罠編み・rengeki=連撃・tateuchi/tosshin/kawarimi(rogue-35)。 */
  cooldowns: Partial<Record<NodeId, number>>;
  /** 静水(seisui・rogue-35): 回避成功時に立つ1回限りのフラグ。次の近接攻撃+2で消費する。 */
  seisuiCharge: boolean;
  actionLog: ActionLogEntry[];
  log: string[];
}
