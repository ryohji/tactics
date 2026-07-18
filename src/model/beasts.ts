// 敵の種族定義(rogue-1)。縄張り・気づき・階層制限のパラメータを持つ純データ。
// 「深さに敏感」= 気づき(vAggro)も追跡範囲(vBelow/vAbove)も上下の層差で別途制限する。

import type { PlayerStatus } from './rogue/types';

export type BeastKind =
  | 'bat' | 'rat' | 'spider' | 'ghoul' | 'snake'
  | 'soldier' | 'wisp' | 'slime' | 'mushnub' | 'shade'
  | 'mage' | 'drake' | 'scorpion' | 'colossus'
  | 'kingMush' | 'giant' | 'yeti';

export interface BeastDef {
  name: string;
  hp: number;
  atk: number;
  def: number;
  /** 気づく距離(格子ワールド単位)。 */
  aggroR: number;
  /** 気づける上下の層差。 */
  vAggro: number;
  /** 縄張り半径(ホーム広間中心から、格子ワールド単位)。 */
  territoryR: number;
  /** ホーム層からこれより下(層差)へは行かない=階層下限。 */
  vBelow: number;
  /** ホーム層からこれより上へは行かない。 */
  vAbove: number;
  /** 出現最低深度(D = -layer)。 */
  minDepth: number;
  color: string;
  /** 命中時にプレイヤーへ毒(1ダメ×3ターン)を与える確率(rogue-21)。 */
  poisonChance?: number;
  /** 命中時にプレイヤーへ混乱(2ターン)を与える確率(rogue-21)。 */
  confuseChance?: number;
  /** 攻撃が障壁に倍打(削りだけ2倍。HP直撃分は等倍)。rogue-21 の酸粘体。 */
  acidBarrier?: boolean;
  /** 移動しない(rogue-21 の胞子茸)。状態異常による徘徊・追跡・恐慌逃走も含め一切動かない。 */
  stationary?: boolean;
  /** 死亡時、隣接1セル内のプレイヤーに与える状態異常(rogue-21。胞子茸の胞子爆発)。 */
  deathBurst?: PlayerStatus['kind'];
  /** 気配感知(rogue-24)。目に頼らない知覚 — 背討ち(将来は掏摸も)が効かない。鬼火・影。 */
  senses?: boolean;
  /** 遠隔攻撃(rogue-24)。射線(lineOfSight)が通り range 以内なら離れて撃つ。 */
  ranged?: { range: number };
  /** 門番(rogue-24)。層境界の広間に湧く層ボス。spawnTable のプール外。撃破でスロット+1。 */
  gatekeeper?: boolean;
}

// 出現帯(rogue-21 再配置): 層1(0〜8)=教育の層(脅威が1つずつ順に出る)/
// 層2(8〜16)=性質のデパート(毒・酸・胞子でビルドの穴を突く)/ 層3(16〜)=高スタッツ帯。
export const BEASTS: Record<BeastKind, BeastDef> = {
  bat: {
    name: '洞穴コウモリ',
    hp: 5, atk: 2, def: 0,
    aggroR: 7, vAggro: 4, territoryR: 11, vBelow: 3, vAbove: 5,
    minDepth: 0, color: '#8b7fb8',
  },
  rat: {
    name: '洞穴ネズミ',
    hp: 3, atk: 1, def: 0,
    aggroR: 6, vAggro: 2, territoryR: 8, vBelow: 2, vAbove: 2,
    minDepth: 2, color: '#a3906f',
  },
  spider: {
    name: '岩グモ',
    hp: 8, atk: 3, def: 1,
    aggroR: 5, vAggro: 1, territoryR: 7, vBelow: 1, vAbove: 1,
    minDepth: 3, color: '#7a9b4e',
  },
  ghoul: {
    name: 'グール',
    hp: 13, atk: 5, def: 1,
    aggroR: 6, vAggro: 2, territoryR: 9, vBelow: 2, vAbove: 3,
    minDepth: 5, color: '#b8b09a',
  },
  snake: {
    name: '毒ヘビ',
    hp: 7, atk: 3, def: 0,
    aggroR: 5, vAggro: 1, territoryR: 7, vBelow: 1, vAbove: 1,
    minDepth: 7, color: '#8fbf5a',
    poisonChance: 0.5,
  },
  soldier: {
    name: '兵隊蟻',
    hp: 16, atk: 6, def: 2,
    aggroR: 7, vAggro: 2, territoryR: 10, vBelow: 2, vAbove: 2,
    minDepth: 8, color: '#b0562f',
  },
  wisp: {
    name: '鬼火',
    hp: 9, atk: 6, def: 0,
    aggroR: 9, vAggro: 6, territoryR: 12, vBelow: 6, vAbove: 6,
    minDepth: 10, color: '#67d3e0',
    senses: true,
  },
  slime: {
    name: '酸粘体',
    hp: 14, atk: 5, def: 1,
    aggroR: 5, vAggro: 2, territoryR: 8, vBelow: 2, vAbove: 2,
    minDepth: 11, color: '#5ad0a0',
    acidBarrier: true,
  },
  mushnub: {
    name: '胞子茸',
    hp: 10, atk: 2, def: 2,
    aggroR: 3, vAggro: 1, territoryR: 1, vBelow: 0, vAbove: 0,
    minDepth: 12, color: '#c084c0',
    confuseChance: 0.5,
    stationary: true,
    deathBurst: 'confuse',
  },
  shade: {
    name: '深淵の影',
    hp: 12, atk: 9, def: 0,
    aggroR: 8, vAggro: 5, territoryR: 12, vBelow: 5, vAbove: 5,
    minDepth: 13, color: '#6b5b9e',
    senses: true,
  },
  mage: {
    name: '洞穴の術師',
    hp: 10, atk: 7, def: 0,
    aggroR: 8, vAggro: 3, territoryR: 10, vBelow: 3, vAbove: 3,
    minDepth: 15, color: '#c084fc',
    ranged: { range: 6 },
  },
  drake: {
    name: '地竜',
    hp: 20, atk: 8, def: 3,
    aggroR: 6, vAggro: 2, territoryR: 8, vBelow: 2, vAbove: 2,
    minDepth: 17, color: '#d0684a',
  },
  scorpion: {
    name: '洞穴サソリ',
    hp: 22, atk: 9, def: 4,
    aggroR: 4, vAggro: 1, territoryR: 6, vBelow: 1, vAbove: 1,
    minDepth: 19, color: '#d9a441',
  },
  colossus: {
    name: '岩窟の巨人',
    hp: 30, atk: 11, def: 5,
    aggroR: 5, vAggro: 1, territoryR: 7, vBelow: 1, vAbove: 1,
    minDepth: 21, color: '#8a8578',
  },
  // --- 門番(rogue-24)。spawnTable のプール外(minDepth=999 の番兵値)。層番号で
  // ステータスがスケールするため、ここの hp/atk/def は基準値(gatekeeperStats 参照)。
  kingMush: {
    name: '茸の王',
    hp: 44, atk: 9, def: 3,
    aggroR: 6, vAggro: 2, territoryR: 8, vBelow: 2, vAbove: 2,
    minDepth: 999, color: '#e879ad',
    gatekeeper: true, confuseChance: 0.35,
  },
  giant: {
    name: '巨人王',
    hp: 44, atk: 9, def: 3,
    aggroR: 6, vAggro: 2, territoryR: 8, vBelow: 2, vAbove: 2,
    minDepth: 999, color: '#9aa285',
    gatekeeper: true,
  },
  yeti: {
    name: '白き主',
    hp: 44, atk: 9, def: 3,
    aggroR: 6, vAggro: 2, territoryR: 8, vBelow: 2, vAbove: 2,
    minDepth: 999, color: '#dbeafe',
    gatekeeper: true,
  },
};

/** 層番号 k(1〜)の門番の種類(バイオーム巡回)とステータス。 */
export function gatekeeperFor(k: number): { kind: BeastKind; hp: number; atk: number; def: number } {
  const kinds: BeastKind[] = ['kingMush', 'giant', 'yeti'];
  return { kind: kinds[(k - 1) % 3], hp: 36 + 8 * k, atk: 7 + 2 * k, def: 2 + k };
}

/**
 * 深度係数(rogue-24)。深度24を超えると敵の hp/atk が伸び続ける —
 * プレイヤーの強さは構造的に上限がある(HP24・スロット6・品質上限)ため、
 * これで「死は深さの必然」を保証する。乱数不要の決定論。
 */
export function depthScale(depth: number): number {
  return depth > 24 ? 1 + (0.15 * (depth - 24)) / 8 : 1;
}

/**
 * 深層の敵が持つ障壁(rogue-36)。深度16(層3=高スタッツ帯の入口)から現れ、
 * 深いほど厚くなる決定論値。プレイヤーの与ダメージはこの障壁からまず削れる
 * (absorbBarrier)。深度係数(depthScale)と同じく「死は深さの必然」を支える調整軸。
 * 数値はバランス調整の対象(閾値16・+2起点・6ごとに+1・上限12)。
 */
export function beastBarrier(depth: number): number {
  if (depth < 16) return 0;
  return Math.min(12, 2 + Math.floor((depth - 16) / 6));
}

/** 出現最低深度の昇順(spawnTable は「直近に解禁された4種」から引く)。 */
const KINDS: BeastKind[] = [
  'bat', 'rat', 'spider', 'ghoul', 'snake', 'soldier',
  'wisp', 'slime', 'mushnub', 'shade', 'mage', 'drake', 'scorpion', 'colossus',
];

/** ネズミ(rogue-21)は群れで湧く。深いほど群れが大きい。 */
export function ratPackSize(depth: number): number {
  return depth >= 16 ? 4 : depth >= 8 ? 3 : 2;
}

/**
 * 深度 D の広間に湧く種族列。深いほど数が増え、強い種族に寄る。
 * ネズミが選ばれたら群れ(ratPackSize)に展開する(1抽選=1群れ)。
 */
export function spawnTable(depth: number, rng: () => number): BeastKind[] {
  if (depth <= 0) return [];
  const pool = KINDS.filter((k) => BEASTS[k].minDepth <= depth).slice(-4);
  if (pool.length === 0) return [];
  const count = Math.min(4, 1 + Math.floor(rng() * 2) + (depth > 6 ? 1 : 0) + (depth > 14 ? 1 : 0));
  const out: BeastKind[] = [];
  for (let i = 0; i < count; i++) {
    const kind = pool[Math.floor(rng() * pool.length)];
    if (kind === 'rat') for (let j = 0; j < ratPackSize(depth); j++) out.push('rat');
    else out.push(kind);
  }
  return out;
}
