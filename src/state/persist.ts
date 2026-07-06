// セーブデータの置き場所(rogue-8)。localStorage の1キーに JSON スナップショットを置く。
// クッキーは容量(約4KB)が掘削セル集合に足りないため不採用。
// 書き込みは rogue.ts が毎ターン終わりに行う(自動保存)。死亡と「最初から」で破棄。
// Node/テスト環境では localStorage が無いので全 API が no-op(テストは差し替え口を使う)。

const KEY = 'fcc-rogue-save-v1';

let storage: Storage | null = (() => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // プライバシーモード等でアクセス自体が例外になる環境
  }
})();

/** テスト用: インメモリ実装などに差し替える。 */
export function setStorageForTest(s: Storage | null): void {
  storage = s;
}

export function writeSave(data: unknown): void {
  try {
    storage?.setItem(KEY, JSON.stringify(data));
  } catch {
    // 容量超過などで保存に失敗してもゲームは止めない
  }
}

export function readSave<T>(): T | null {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // no-op
  }
}

export function hasSave(): boolean {
  try {
    return storage?.getItem(KEY) != null;
  } catch {
    return false;
  }
}
