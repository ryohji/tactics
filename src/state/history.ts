// ローカルスコアボード(rogue-20)。死亡のたびのラン記録を localStorage に貯める。
// persist.ts と同じ流儀: localStorage の1キーに JSON 配列を置く。Node/テスト環境では
// localStorage が無いので全 API が no-op(テストは差し替え口を使う)。
// サーバ無し・端末ローカルのみ(共有ボードは rogue-26)。

const KEY = 'fcc-rogue-history-v1';
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

let storage: Storage | null = (() => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // プライバシーモード等でアクセス自体が例外になる環境
  }
})();

/** テスト用: インメモリ実装などに差し替える。 */
export function setHistoryStorageForTest(s: Storage | null): void {
  storage = s;
}

/** 先頭(最新)に追加し、最大 MAX 件で切り詰める。 */
export function appendRun(r: RunRecord): void {
  try {
    const list = readHistory();
    list.unshift(r);
    storage?.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // 容量超過などで保存に失敗してもゲームは止めない
  }
}

/** 破損した JSON や配列以外の形は空履歴として扱う。 */
export function readHistory(): RunRecord[] {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RunRecord[]) : [];
  } catch {
    return [];
  }
}

export function clearHistory(): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // no-op
  }
}
