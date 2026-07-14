/**
 * localStorage の1キーに JSON を置く小さな永続ストアの共通部。
 * Node/テスト環境では全 API が no-op(テストは setStorageForTest で差し替える)。
 * 書き込み失敗(容量超過等)も握りつぶし、ゲームは止めない。
 */

export interface KvStore<T> {
  read(): T;
  write(v: T): void;
  clear(): void;
  /** テスト用: インメモリ実装などに差し替える。 */
  setStorageForTest(s: Storage | null): void;
}

export interface KvStoreOptions<T> {
  /** バリデーション関数。失敗時は initial() を返す。 */
  validate?: (v: unknown) => v is T;
  /**
   * true の場合、バリデーション成功時に initial() とマージする。
   * スプレッド: { ...initial(), ...parsed }
   * デフォルト false(そのまま返す)。
   * 型の互換性(新フィールド追加)のため mastery/codex は true。
   */
  mergeWithInitial?: boolean;
}

export function makeKvStore<T>(
  key: string,
  initial: () => T,
  options?: KvStoreOptions<T>,
): KvStore<T> {
  let storage: Storage | null = (() => {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      // プライバシーモード等でアクセス自体が例外になる環境
      return null;
    }
  })();

  return {
    read(): T {
      try {
        const raw = storage?.getItem(key);
        if (!raw) return initial();
        const parsed: unknown = JSON.parse(raw);
        if (options?.validate) {
          if (!options.validate(parsed)) return initial();
          if (options.mergeWithInitial) {
            return { ...initial(), ...parsed };
          }
          return parsed as T;
        }
        return parsed as T;
      } catch {
        return initial();
      }
    },

    write(v: T): void {
      try {
        storage?.setItem(key, JSON.stringify(v));
      } catch {
        // 容量超過などで保存に失敗してもゲームは止めない
      }
    },

    clear(): void {
      try {
        storage?.removeItem(key);
      } catch {
        // no-op
      }
    },

    setStorageForTest(s: Storage | null): void {
      storage = s;
    },
  };
}
