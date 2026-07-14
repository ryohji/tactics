// セーブデータの置き場所(rogue-8)。localStorage の1キーに JSON スナップショットを置く。
// クッキーは容量(約4KB)が掘削セル集合に足りないため不採用。
// 書き込みは rogue.ts が毎ターン終わりに行う(自動保存)。死亡と「最初から」で破棄。
// Node/テスト環境では localStorage が無いので全 API が no-op(テストは差し替え口を使う)。

import { makeKvStore, type KvStore } from './kvStore';

const store: KvStore<unknown> = makeKvStore('fcc-rogue-save-v1', () => null);

/** テスト用: インメモリ実装などに差し替える。 */
export function setStorageForTest(s: Storage | null): void {
  store.setStorageForTest(s);
}

export function writeSave(data: unknown): void {
  store.write(data);
}

export function readSave<T>(): T | null {
  return (store.read() as T) ?? null;
}

export function clearSave(): void {
  store.clear();
}

export function hasSave(): boolean {
  return store.read() != null;
}
