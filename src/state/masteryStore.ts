// マスタリー(永続メタ)の保存(rogue-23)。kvStore と同じ流儀: localStorage の
// 1キーに JSON を置く。Node/テスト環境では localStorage が無いので全 API が
// no-op(テストは setMasteryStorageForTest で差し替える)。死んでも消えない
// 進行度なので、ラン履歴(history.ts)とは別キーで管理する。

import { INITIAL_MASTERY, type MasteryCounters } from '../model/rogue/mastery';
import { makeKvStore, type KvStore } from './kvStore';

function isMasteryCounters(v: unknown): v is MasteryCounters {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as MasteryCounters).weaponKills === 'number' &&
    typeof (v as MasteryCounters).evades === 'number' &&
    typeof (v as MasteryCounters).absorbed === 'number'
  );
}

const store: KvStore<MasteryCounters> = makeKvStore(
  'fcc-rogue-mastery-v1',
  () => ({ ...INITIAL_MASTERY }),
  {
    validate: isMasteryCounters,
    mergeWithInitial: true,
  },
);

/** テスト用: インメモリ実装などに差し替える。 */
export function setMasteryStorageForTest(s: Storage | null): void {
  store.setStorageForTest(s);
}

/**
 * 破損した JSON や形の合わないデータは初期値(全カウンタ0)として扱う。
 * 系統追加(rogue-24)で保存済みデータに無いカウンタは 0 で補完する
 * (マスタリーは永続資産なので、版が上がっても破棄しない)。
 */
export function readMastery(): MasteryCounters {
  return store.read();
}

export function writeMastery(counters: MasteryCounters): void {
  store.write(counters);
}

export function clearMasteryForTest(): void {
  store.clear();
}
