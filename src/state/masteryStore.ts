// マスタリー(永続メタ)の保存(rogue-23)。history.ts と同じ流儀: localStorage の
// 1キーに JSON を置く。Node/テスト環境では localStorage が無いので全 API が
// no-op(テストは setMasteryStorageForTest で差し替える)。死んでも消えない
// 進行度なので、ラン履歴(history.ts)とは別キーで管理する。

import { INITIAL_MASTERY, type MasteryCounters } from '../model/rogue/mastery';

const KEY = 'fcc-rogue-mastery-v1';

let storage: Storage | null = (() => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // プライバシーモード等でアクセス自体が例外になる環境
  }
})();

/** テスト用: インメモリ実装などに差し替える。 */
export function setMasteryStorageForTest(s: Storage | null): void {
  storage = s;
}

function isMasteryCounters(v: unknown): v is MasteryCounters {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as MasteryCounters).weaponKills === 'number' &&
    typeof (v as MasteryCounters).evades === 'number' &&
    typeof (v as MasteryCounters).absorbed === 'number'
  );
}

/**
 * 破損した JSON や形の合わないデータは初期値(全カウンタ0)として扱う。
 * 系統追加(rogue-24)で保存済みデータに無いカウンタは 0 で補完する
 * (マスタリーは永続資産なので、版が上がっても破棄しない)。
 */
export function readMastery(): MasteryCounters {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return { ...INITIAL_MASTERY };
    const parsed: unknown = JSON.parse(raw);
    return isMasteryCounters(parsed) ? { ...INITIAL_MASTERY, ...parsed } : { ...INITIAL_MASTERY };
  } catch {
    return { ...INITIAL_MASTERY };
  }
}

export function writeMastery(counters: MasteryCounters): void {
  try {
    storage?.setItem(KEY, JSON.stringify(counters));
  } catch {
    // 容量超過などで保存に失敗してもゲームは止めない
  }
}

export function clearMasteryForTest(): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // no-op
  }
}
