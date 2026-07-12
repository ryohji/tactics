// 実績定義(rogue-25)。純データのみ — 判定・解除(state/codexStore.ts への永続化・
// ログ/効果音)は state/rogue.ts が各トリガ箇所から行う。マスタリー(mastery.ts)と
// 同じ「データはここ・実行はストア」の分離。

/** 実績id(達成順・意味に依らず固定。codexStore の feats 配列に永続化される)。 */
export type FeatId =
  | 'firstGate'
  | 'darkGate'
  | 'pureGate'
  | 'gatekeeper'
  | 'sweep3'
  | 'trapper5'
  | 'deep16'
  | 'relic';

export interface FeatDef {
  id: FeatId;
  name: string;
  /** 達成条件の説明文(図鑑の実績一覧に表示)。 */
  desc: string;
}

/** 図鑑での表示順。 */
export const FEAT_IDS: FeatId[] = [
  'firstGate',
  'darkGate',
  'pureGate',
  'gatekeeper',
  'sweep3',
  'trapper5',
  'deep16',
  'relic',
];

export const FEATS: Record<FeatId, FeatDef> = {
  firstGate: {
    id: 'firstGate',
    name: '最初の関門',
    desc: '崩落を1度通過する',
  },
  darkGate: {
    id: 'darkGate',
    name: '暗闇行',
    desc: '「絞る」以下の明かりで関門を通過する',
  },
  pureGate: {
    id: 'pureGate',
    name: '無傷の関門',
    desc: 'HP満タンの状態で関門を通過する',
  },
  gatekeeper: {
    id: 'gatekeeper',
    name: '門番討ち',
    desc: '層の門番を撃破する',
  },
  sweep3: {
    id: 'sweep3',
    name: '群れ祓い',
    desc: '1回の近接攻撃(薙ぎ払い)で3体以上を撃破する',
  },
  trapper5: {
    id: 'trapper5',
    name: '罠師の誇り',
    desc: '罠での討伐が累計5体に達する',
  },
  deep16: {
    id: 'deep16',
    name: '深淵の一瞥',
    desc: '深度16へ到達する',
  },
  relic: {
    id: 'relic',
    name: '初めての琥珀',
    desc: '遺物「巣の琥珀」を初めて拾う',
  },
};
