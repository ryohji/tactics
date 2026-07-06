// 敵の種族定義(rogue-1)。縄張り・気づき・階層制限のパラメータを持つ純データ。
// 「深さに敏感」= 気づき(vAggro)も追跡範囲(vBelow/vAbove)も上下の層差で別途制限する。

export type BeastKind =
  | 'bat' | 'spider' | 'ghoul' | 'soldier' | 'wisp' | 'shade' | 'drake' | 'colossus';

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
}

export const BEASTS: Record<BeastKind, BeastDef> = {
  bat: {
    name: '洞穴コウモリ',
    hp: 5, atk: 2, def: 0,
    aggroR: 7, vAggro: 4, territoryR: 11, vBelow: 3, vAbove: 5,
    minDepth: 0, color: '#8b7fb8',
  },
  spider: {
    name: '岩グモ',
    hp: 8, atk: 3, def: 1,
    aggroR: 5, vAggro: 1, territoryR: 7, vBelow: 1, vAbove: 1,
    minDepth: 2, color: '#7a9b4e',
  },
  ghoul: {
    name: 'グール',
    hp: 13, atk: 5, def: 1,
    aggroR: 6, vAggro: 2, territoryR: 9, vBelow: 2, vAbove: 3,
    minDepth: 5, color: '#b8b09a',
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
    minDepth: 9, color: '#67d3e0',
  },
  shade: {
    name: '深淵の影',
    hp: 12, atk: 9, def: 0,
    aggroR: 8, vAggro: 5, territoryR: 12, vBelow: 5, vAbove: 5,
    minDepth: 12, color: '#6b5b9e',
  },
  drake: {
    name: '地竜',
    hp: 20, atk: 8, def: 3,
    aggroR: 6, vAggro: 2, territoryR: 8, vBelow: 2, vAbove: 2,
    minDepth: 13, color: '#d0684a',
  },
  colossus: {
    name: '岩窟の巨人',
    hp: 30, atk: 11, def: 5,
    aggroR: 5, vAggro: 1, territoryR: 7, vBelow: 1, vAbove: 1,
    minDepth: 17, color: '#8a8578',
  },
};

/** 出現最低深度の昇順(spawnTable は「直近に解禁された3種」から引く)。 */
const KINDS: BeastKind[] = ['bat', 'spider', 'ghoul', 'soldier', 'wisp', 'shade', 'drake', 'colossus'];

/** 深度 D の広間に湧く種族列(0〜4体)。深いほど数が増え、強い種族に寄る。 */
export function spawnTable(depth: number, rng: () => number): BeastKind[] {
  if (depth <= 0) return [];
  const pool = KINDS.filter((k) => BEASTS[k].minDepth <= depth).slice(-3);
  if (pool.length === 0) return [];
  const count = Math.min(4, 1 + Math.floor(rng() * 2) + (depth > 6 ? 1 : 0) + (depth > 14 ? 1 : 0));
  const out: BeastKind[] = [];
  for (let i = 0; i < count; i++) out.push(pool[Math.floor(rng() * pool.length)]);
  return out;
}
