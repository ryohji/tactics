// 図鑑・実績(永続メタ。rogue-25)の保存。kvStore と同じ流儀:
// localStorage の1キーに JSON を置く。Node/テスト環境では localStorage が無いので
// 全 API が no-op(テストは setCodexStorageForTest で差し替える)。死んでも消えない
// 収集要素なので、ラン履歴(history.ts)・マスタリー(masteryStore.ts)とも別キーで管理する。

import type { BeastKind } from '../model/beasts';
import { ITEMS, type ItemId } from '../model/loot';
import type { FeatId } from '../model/rogue/feats';
import { makeKvStore, type KvStore } from './kvStore';

export interface Codex {
  /** 種ごとの討伐数・初討伐深度(討伐図鑑)。未討伐の種は未収録=キー無し(「???」表示)。 */
  beasts: Partial<Record<BeastKind, { kills: number; firstDepth: number }>>;
  /** アイテムごとの入手数・最高品質(アイテム図鑑)。未入手のアイテムは未収録。 */
  items: Partial<Record<ItemId, { found: number; bestQ: number }>>;
  /** 達成済み実績id。 */
  feats: FeatId[];
  /** 遺物「巣の琥珀」の持ち帰り確定累計(rogue-25 後半・展示棚)。 */
  ambers: number;
  /** 脱出(生還)で確定した最深の層番号(1始まり。0=未生還)。 */
  bestStratumEscape: number;
}

export const INITIAL_CODEX: Codex = { beasts: {}, items: {}, feats: [], ambers: 0, bestStratumEscape: 0 };

function isCodex(v: unknown): v is Codex {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Codex;
  return (
    typeof c.beasts === 'object' &&
    c.beasts !== null &&
    typeof c.items === 'object' &&
    c.items !== null &&
    Array.isArray(c.feats)
  );
}

const store: KvStore<Codex> = makeKvStore(
  'fcc-rogue-codex-v1',
  () => ({ ...INITIAL_CODEX }),
  {
    validate: isCodex,
    mergeWithInitial: true,
  },
);

/** テスト用: インメモリ実装などに差し替える。 */
export function setCodexStorageForTest(s: Storage | null): void {
  store.setStorageForTest(s);
}

/**
 * 破損した JSON や形の合わないデータは初期値として扱う。保存済みデータに無い
 * フィールド(版が上がって追加されたもの等)は INITIAL_CODEX の値で補完する
 * (図鑑・実績は永続資産なので、版が上がっても破棄しない。mastery.ts と同じ方針)。
 *
 * rogue-27: 罠アイテム5種の廃止で、以前のプレイで記録された items のキーに
 * 現在の ITEMS に存在しない id(trapSpike 等)が残りうる。表示側が未知 id で
 * 落ちないよう、読み込み時に `id in ITEMS` でフィルタする。
 */
export function readCodex(): Codex {
  const codex = store.read();
  const items = Object.fromEntries(
    Object.entries(codex.items).filter(([id]) => id in ITEMS),
  ) as Codex['items'];
  return { ...codex, items };
}

function writeCodex(codex: Codex): void {
  store.write(codex);
}

/** 討伐図鑑: 種ごとの討伐数を+1し、初討伐深度は最初の1回だけ記録する。 */
export function recordBeastKill(kind: BeastKind, depth: number): void {
  const codex = readCodex();
  const cur = codex.beasts[kind];
  writeCodex({
    ...codex,
    beasts: {
      ...codex.beasts,
      [kind]: { kills: (cur?.kills ?? 0) + 1, firstDepth: cur ? cur.firstDepth : depth },
    },
  });
}

/** アイテム図鑑: アイテムごとの入手数を+1し、最高品質を更新する。 */
export function recordItemFound(item: ItemId, q: number): void {
  const codex = readCodex();
  const cur = codex.items[item];
  writeCodex({
    ...codex,
    items: {
      ...codex.items,
      [item]: { found: (cur?.found ?? 0) + 1, bestQ: Math.max(cur?.bestQ ?? 0, q) },
    },
  });
}

/** 実績解除(冪等。既に解除済みなら何もしない — 呼び出し側のログ表示は別途 feats 集合で判定する)。 */
export function unlockFeat(id: FeatId): void {
  const codex = readCodex();
  if (codex.feats.includes(id)) return;
  writeCodex({ ...codex, feats: [...codex.feats, id] });
}

/**
 * 展示棚(rogue-25 後半): 脱出(生還)の確定時に呼ぶ。持ち帰った琥珀を累計へ
 * 加算し、最深生還層(1始まりの層番号)を更新する。
 */
export function recordEscape(ambersGained: number, stratum: number): void {
  const codex = readCodex();
  writeCodex({
    ...codex,
    ambers: codex.ambers + ambersGained,
    bestStratumEscape: Math.max(codex.bestStratumEscape, stratum),
  });
}

export function clearCodexForTest(): void {
  store.clear();
}
