// ローカルスコアボード(rogue-20)。死亡のたびのラン記録を localStorage に貯める。
// kvStore と同じ流儀: localStorage の1キーに JSON 配列を置く。Node/テスト環境では
// localStorage が無いので全 API が no-op(テストは差し替え口を使う)。
// サーバ無し・端末ローカルのみ(共有ボードは rogue-26)。

import { makeKvStore, type KvStore } from './kvStore';

/** 保持する最大件数(先頭=最新から MAX 件で切り詰める)。 */
const MAX = 100;

export interface RunRecord {
  /** GAME_VERSION(バランス改訂の互換性の目印)。 */
  v: string;
  seed: number;
  /** ローカル日付 'YYYY-MM-DD'(model/rogue/rules.ts の isoDate)。 */
  date: string;
  turns: number;
  kills: number;
  maxDepth: number;
  /** 通過済みの層数(rogue-19b)。 */
  stratum: number;
  /** 死因(deathCause の代わりに脱出成功時は '生還')。 */
  deathCause: string;
  /** その日の「本日の迷宮」だったか。 */
  daily: boolean;
  /** 死亡時点の装着スキルノード id 列(rogue-23)。 */
  skills: string[];
  /** 脱出(生還)で終えたランか(rogue-25)。死亡なら false。 */
  escaped: boolean;
}

const store: KvStore<RunRecord[]> = makeKvStore('fcc-rogue-history-v1', () => [], {
  validate: (v): v is RunRecord[] => Array.isArray(v),
});

/** テスト用: インメモリ実装などに差し替える。 */
export function setHistoryStorageForTest(s: Storage | null): void {
  store.setStorageForTest(s);
}

/** 先頭(最新)に追加し、最大 MAX 件で切り詰める。 */
export function appendRun(r: RunRecord): void {
  const list = readHistory();
  list.unshift(r);
  store.write(list.slice(0, MAX));
}

/** 破損した JSON や配列以外の形は空履歴として扱う。 */
export function readHistory(): RunRecord[] {
  return store.read();
}

export function clearHistory(): void {
  store.clear();
}
