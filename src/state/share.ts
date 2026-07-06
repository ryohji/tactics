// X(旧 Twitter)への結果ポスト(rogue-6)。Web Intent の URL を組み立てる純関数。
// API 連携・認証は持たない: URL を新規タブで開くと X 側の投稿画面に本文が
// プリセットされ、編集・送信はユーザが行う(勝手に投稿されることはない)。

import { itemLabel, type ItemStack } from '../model/loot';

export const PLAY_URL = 'https://ryohji.github.io/tactics/';
export const HASHTAGS = ['蟻巣迷宮', 'FCCRogue'];

/** ポストに載せる1回のプレイ結果。 */
export interface RunResult {
  maxDepth: number;
  kills: number;
  turn: number;
  /** 死因(とどめを刺した敵の名前)。記録がなければ null。 */
  deathCause: string | null;
  weapon: ItemStack | null;
  armor: ItemStack | null;
  /** 迷宮生成シード(タイトル/再挑戦の入力欄に入れると同じ迷宮を再現できる)。 */
  seed: number;
}

// 本文はハッシュタグ込みで 120 文字程度に収める(URL は別枠)。
// 装備は名前+品質のみ(性能の括弧書きは画面用に留める)。
export function shareText(r: RunResult): string {
  const cause = r.deathCause ? `${r.deathCause} に倒された` : '力尽きた';
  const equip = (s: ItemStack | null) => (s ? itemLabel(s) : 'なし');
  return [
    `【蟻巣迷宮】深度${r.maxDepth}で ${cause}…`,
    `討伐${r.kills} / ${r.turn}ターン / 武器 ${equip(r.weapon)} / 防具 ${equip(r.armor)}`,
    `シード ${r.seed}`,
  ].join('\n');
}

/** X の投稿画面を開く URL(text + プレイ URL + ハッシュタグ)。 */
export function shareUrl(r: RunResult): string {
  return (
    'https://twitter.com/intent/tweet' +
    `?text=${encodeURIComponent(shareText(r))}` +
    `&url=${encodeURIComponent(PLAY_URL)}` +
    `&hashtags=${encodeURIComponent(HASHTAGS.join(','))}`
  );
}
