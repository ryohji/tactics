import { describe, it, expect } from 'vitest';
import { makeKvStore } from './kvStore';

describe('makeKvStore', () => {
  describe('基本操作(read/write/clear)', () => {
    it('write と read でデータを往復できる', () => {
      const store = makeKvStore('test-key', () => 'initial');
      const mockStorage = new Map<string, string>();
      store.setStorageForTest({
        getItem: (k) => mockStorage.get(k) ?? null,
        setItem: (k, v) => mockStorage.set(k, v),
        removeItem: (k) => mockStorage.delete(k),
        length: mockStorage.size,
        clear: () => mockStorage.clear(),
        key: () => null,
      });

      store.write('hello');
      expect(store.read()).toBe('hello');
    });

    it('clear でキーを削除できる', () => {
      const store = makeKvStore('test-key', () => 'initial');
      const mockStorage = new Map<string, string>();
      store.setStorageForTest({
        getItem: (k) => mockStorage.get(k) ?? null,
        setItem: (k, v) => mockStorage.set(k, v),
        removeItem: (k) => mockStorage.delete(k),
        length: mockStorage.size,
        clear: () => mockStorage.clear(),
        key: () => null,
      });

      store.write('data');
      store.clear();
      expect(mockStorage.has('test-key')).toBe(false);
    });

    it('キーが無いときは initial() を返す', () => {
      const store = makeKvStore('test-key', () => 'default');
      store.setStorageForTest({
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        length: 0,
        clear: () => {},
        key: () => null,
      });

      expect(store.read()).toBe('default');
    });
  });

  describe('JSON 処理と破損耐性', () => {
    it('壊れた JSON は initial() を返す', () => {
      const store = makeKvStore('test-key', () => 'initial');
      store.setStorageForTest({
        getItem: () => 'not valid json {',
        setItem: () => {},
        removeItem: () => {},
        length: 1,
        clear: () => {},
        key: () => null,
      });

      expect(store.read()).toBe('initial');
    });

    it('write の失敗を握りつぶす(capacity exceeded 等)', () => {
      const store = makeKvStore('test-key', () => 'initial');
      let writeCalled = false;
      store.setStorageForTest({
        getItem: () => null,
        setItem: () => {
          writeCalled = true;
          throw new Error('quota exceeded');
        },
        removeItem: () => {},
        length: 0,
        clear: () => {},
        key: () => null,
      });

      // 例外を投げない
      expect(() => store.write('data')).not.toThrow();
      expect(writeCalled).toBe(true);
    });

    it('clear の失敗を握りつぶす', () => {
      const store = makeKvStore('test-key', () => 'initial');
      store.setStorageForTest({
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {
          throw new Error('access denied');
        },
        length: 0,
        clear: () => {},
        key: () => null,
      });

      // 例外を投げない
      expect(() => store.clear()).not.toThrow();
    });
  });

  describe('バリデーション', () => {
    it('validate 成功時は parsed をそのまま返す(mergeWithInitial=false)', () => {
      const store = makeKvStore(
        'test-key',
        () => ({ a: 1, b: 2 }),
        {
          validate: (v): v is { a: number; b: number } =>
            typeof v === 'object' && v !== null && typeof (v as any).a === 'number' && typeof (v as any).b === 'number',
          mergeWithInitial: false,
        },
      );

      const mockStorage = new Map<string, string>();
      store.setStorageForTest({
        getItem: (k) => mockStorage.get(k) ?? null,
        setItem: (k, v) => mockStorage.set(k, v),
        removeItem: (k) => mockStorage.delete(k),
        length: mockStorage.size,
        clear: () => mockStorage.clear(),
        key: () => null,
      });

      store.write({ a: 10, b: 20 });
      expect(store.read()).toEqual({ a: 10, b: 20 });
    });

    it('validate 失敗時は initial() を返す', () => {
      const store = makeKvStore(
        'test-key',
        () => ({ a: 1 }),
        {
          validate: (v): v is { a: number } =>
            typeof v === 'object' && v !== null && typeof (v as any).a === 'number',
        },
      );

      store.setStorageForTest({
        getItem: () => '{"b":2}', // a がない
        setItem: () => {},
        removeItem: () => {},
        length: 1,
        clear: () => {},
        key: () => null,
      });

      expect(store.read()).toEqual({ a: 1 });
    });
  });

  describe('マージ挙動(mergeWithInitial)', () => {
    it('mergeWithInitial=true で INITIAL_VALUE とマージして新フィールドを補完', () => {
      interface Data {
        x: number;
        y?: number;
        z?: number;
      }
      const store = makeKvStore(
        'test-key',
        () => ({ x: 0, y: 0, z: 0 } as Data),
        {
          validate: (v): v is Data =>
            typeof v === 'object' && v !== null && typeof (v as any).x === 'number',
          mergeWithInitial: true,
        },
      );

      const mockStorage = new Map<string, string>();
      store.setStorageForTest({
        getItem: (k) => mockStorage.get(k) ?? null,
        setItem: (k, v) => mockStorage.set(k, v),
        removeItem: (k) => mockStorage.delete(k),
        length: mockStorage.size,
        clear: () => mockStorage.clear(),
        key: () => null,
      });

      // 古いデータ(y, z が無い)を保存
      mockStorage.set('test-key', JSON.stringify({ x: 10 }));
      // マージ結果: { x: 0, y: 0, z: 0, ...{ x: 10 } } = { x: 10, y: 0, z: 0 }
      const result = store.read();
      expect(result).toEqual({ x: 10, y: 0, z: 0 });
    });
  });

  describe('storage が無い環境(Node)', () => {
    it('setStorageForTest(null) なら initial() を返す(no-op)', () => {
      const store = makeKvStore('test-key', () => 'default');
      store.setStorageForTest(null);

      expect(store.read()).toBe('default');
    });

    it('setStorageForTest(null) の write は no-op', () => {
      const store = makeKvStore('test-key', () => 'default');
      store.setStorageForTest(null);

      // 例外を投げない
      expect(() => store.write('data')).not.toThrow();
      expect(store.read()).toBe('default');
    });
  });

  describe('複雑な型', () => {
    interface RunRecord {
      v: string;
      turns: number;
    }
    it('配列バリデーション + 初期値 []', () => {
      const store = makeKvStore('history', () => [] as RunRecord[], {
        validate: (v): v is RunRecord[] => Array.isArray(v),
      });

      const mockStorage = new Map<string, string>();
      store.setStorageForTest({
        getItem: (k) => mockStorage.get(k) ?? null,
        setItem: (k, v) => mockStorage.set(k, v),
        removeItem: (k) => mockStorage.delete(k),
        length: mockStorage.size,
        clear: () => mockStorage.clear(),
        key: () => null,
      });

      const record: RunRecord = { v: '1.0', turns: 100 };
      store.write([record]);
      expect(store.read()).toEqual([record]);
    });

    it('配列でない値は initial() を返す', () => {
      const store = makeKvStore('history', () => [] as RunRecord[], {
        validate: (v): v is RunRecord[] => Array.isArray(v),
      });

      store.setStorageForTest({
        getItem: () => '{"v":"1.0","turns":100}', // 配列ではなくオブジェクト
        setItem: () => {},
        removeItem: () => {},
        length: 1,
        clear: () => {},
        key: () => null,
      });

      expect(store.read()).toEqual([]);
    });
  });
});
