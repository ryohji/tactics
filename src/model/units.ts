// ユニット定義（it-6 ゲームルール層）。純 TS・Three 非依存。
// クラス（種別）のステータスと陣営ロスターをここで確定する（数値は DECISIONS 2026-07-02 初版バランス）。
//
// 移動様式: fly=true は足場不要で全通行セルを移動可（魔女・有翼人など）。
// fly=false は「足場セル」しか歩けないが、浮遊（levitate）を付与されている間は飛行扱い。
// 射程: 格子ユークリッド距離 [minRange, maxRange]。隣接（12近傍）は距離 √2≈1.42 なので
// 近接は maxRange 1.5、弓の minRange 1.6 は「隣接には撃てない＝隣接反撃不可」を意味する。

import type { Cell } from './fcc';

export type Side = 'player' | 'enemy';
export type SkillId = 'heal' | 'levitate';

export type ClassId =
  | 'grandWitch'
  | 'witch'
  | 'winged'
  | 'knight'
  | 'archer'
  | 'cleric'
  | 'lich'
  | 'warlock'
  | 'gargoyle'
  | 'skeleton';

export interface UnitClass {
  id: ClassId;
  /** 表示名。 */
  name: string;
  /** 生来の飛行（足場不要）。 */
  fly: boolean;
  /** 1ターンの移動ステップ数（BFS 深さ）。 */
  move: number;
  hp: number;
  atk: number;
  def: number;
  /** 基礎命中%（補正前）。 */
  hit: number;
  /** 回避%（相手の命中から引く）。 */
  evade: number;
  /** 射程（格子ユークリッド距離の下限・上限）。 */
  minRange: number;
  maxRange: number;
  /** 使えるスキル。 */
  skills: readonly SkillId[];
  /** 撃破されると陣営敗北。各陣営1体。 */
  leader?: boolean;
  /** 攻撃が魔法か（演出・効果音の分岐用。ルール上は同一）。 */
  magic?: boolean;
}

const MELEE = { minRange: 0, maxRange: 1.5 } as const;

export const CLASSES: Record<ClassId, UnitClass> = {
  // --- 聖翼隊（プレイヤー / 青） ---
  grandWitch: {
    id: 'grandWitch', name: '大魔女', fly: true, move: 4,
    hp: 15, atk: 6, def: 1, hit: 90, evade: 15,
    minRange: 0, maxRange: 3, skills: ['levitate'], leader: true, magic: true,
  },
  witch: {
    id: 'witch', name: '魔女', fly: true, move: 4,
    hp: 11, atk: 6, def: 0, hit: 85, evade: 15,
    minRange: 0, maxRange: 3, skills: ['levitate'], magic: true,
  },
  winged: {
    id: 'winged', name: '有翼人', fly: true, move: 5,
    hp: 13, atk: 6, def: 2, hit: 90, evade: 20,
    ...MELEE, skills: [],
  },
  knight: {
    id: 'knight', name: '聖堂騎士', fly: false, move: 3,
    hp: 18, atk: 7, def: 4, hit: 85, evade: 5,
    ...MELEE, skills: [],
  },
  archer: {
    id: 'archer', name: '弓兵', fly: false, move: 3,
    hp: 12, atk: 6, def: 1, hit: 90, evade: 10,
    minRange: 1.6, maxRange: 4, skills: [],
  },
  cleric: {
    id: 'cleric', name: '僧侶', fly: false, move: 3,
    hp: 10, atk: 2, def: 1, hit: 80, evade: 10,
    ...MELEE, skills: ['heal', 'levitate'],
  },

  // --- 亡者の軍勢（敵 / 赤） ---
  lich: {
    id: 'lich', name: '死霊王', fly: true, move: 3,
    hp: 16, atk: 7, def: 2, hit: 85, evade: 10,
    minRange: 0, maxRange: 3, skills: [], leader: true, magic: true,
  },
  warlock: {
    id: 'warlock', name: '邪術師', fly: false, move: 3,
    hp: 10, atk: 6, def: 0, hit: 80, evade: 10,
    minRange: 0, maxRange: 3, skills: ['levitate'], magic: true,
  },
  gargoyle: {
    id: 'gargoyle', name: 'ガーゴイル', fly: true, move: 5,
    hp: 12, atk: 6, def: 3, hit: 85, evade: 15,
    ...MELEE, skills: [],
  },
  skeleton: {
    id: 'skeleton', name: '骸骨兵', fly: false, move: 3,
    hp: 14, atk: 6, def: 2, hit: 80, evade: 5,
    ...MELEE, skills: [],
  },
};

/** 陣営ロスター（リーダーを先頭に。配置はこの順でアンカー近くから埋める）。 */
export const ROSTERS: Record<Side, readonly ClassId[]> = {
  player: ['grandWitch', 'knight', 'winged', 'archer', 'cleric', 'witch'],
  enemy: ['lich', 'skeleton', 'gargoyle', 'warlock', 'skeleton', 'gargoyle'],
};

/** 陣営の表示名。 */
export const SIDE_NAME: Record<Side, string> = { player: '聖翼隊', enemy: '亡者の軍勢' };

/** ユニット個体。pos/hp/浮遊/行動済みが状態、他はクラス定義から引く。 */
export interface Unit {
  id: number;
  side: Side;
  cls: ClassId;
  /** 表示名（同クラス複数は「骸骨兵 II」のように区別）。 */
  name: string;
  pos: Cell;
  hp: number;
  /** 浮遊の残り（自陣営ターン終了ごとに減算。>0 の間は飛行扱い）。 */
  levitate: number;
  /** このターン行動済み。 */
  acted: boolean;
  alive: boolean;
}

/** 現在飛行扱いか（生来の飛行 or 浮遊中）。 */
export function isFlying(u: Unit): boolean {
  return CLASSES[u.cls].fly || u.levitate > 0;
}

export function isLeader(u: Unit): boolean {
  return CLASSES[u.cls].leader === true;
}

const ROMAN = ['', ' II', ' III', ' IV'];

/** ロスターからユニット列を生成する（pos は後で配置が入れる）。 */
export function createRoster(side: Side, startId: number): Unit[] {
  const seen = new Map<ClassId, number>();
  return ROSTERS[side].map((cls, i) => {
    const n = seen.get(cls) ?? 0;
    seen.set(cls, n + 1);
    return {
      id: startId + i,
      side,
      cls,
      name: CLASSES[cls].name + (ROMAN[n] ?? ` ${n + 1}`),
      pos: [0, 0, 0] as Cell,
      hp: CLASSES[cls].hp,
      levitate: 0,
      acted: false,
      alive: true,
    };
  });
}
