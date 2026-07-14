// 共有スコアボード(rogue-26)クライアント基盤の単体テスト。
// - buildRunPayload: 純関数(グローバル状態に触れない)としての形を確認
// - URL 未設定(既定)なら fetch が一切呼ばれないこと(現状維持の要)
// - URL 設定時に fetch へ渡る内容の形(スタブ)

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  buildRunPayload,
  submitRun,
  fetchTop,
  setScoreboardUrlForTest,
  isScoreboardEnabled,
  readPlayerName,
  readPlayerNameRaw,
  writePlayerName,
  setNameStorageForTest,
  startNewRun,
  getRunId,
  resetRunIdForTest,
  type RunSnapshot,
} from './scoreboard';

/** localStorage 互換のインメモリ実装(他ストアのテストと同じ手法)。 */
function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, v),
  } as unknown as Storage;
}

function snapshot(over: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    seed: 12345,
    turn: 10,
    kills: 2,
    maxDepth: 5,
    stratum: 0,
    deathCause: null,
    skillEquipped: [],
    ...over,
  };
}

afterEach(() => {
  setScoreboardUrlForTest(null);
  setNameStorageForTest(null);
  resetRunIdForTest();
  vi.unstubAllGlobals();
});

describe('buildRunPayload(純関数)', () => {
  it('潜行中(関門通過時点)は escaped/dead=false・cause=空文字', () => {
    const p = buildRunPayload(snapshot(), {
      runId: 'run-1',
      name: 'てすと',
      escaped: false,
      dead: false,
    });
    expect(p.escaped).toBe(false);
    expect(p.dead).toBe(false);
    expect(p.cause).toBe('');
    expect(p.runId).toBe('run-1');
    expect(p.name).toBe('てすと');
    expect(p.depth).toBe(5); // maxDepth
    expect(p.kills).toBe(2);
    expect(p.turns).toBe(10);
    expect(p.stratum).toBe(0);
    expect(p.skills).toEqual([]);
    expect(typeof p.v).toBe('string');
  });

  it('死亡は dead=true・cause=deathCause', () => {
    const p = buildRunPayload(snapshot({ deathCause: 'グール' }), {
      runId: 'run-2',
      name: '名無しの探索者',
      escaped: false,
      dead: true,
    });
    expect(p.dead).toBe(true);
    expect(p.escaped).toBe(false);
    expect(p.cause).toBe('グール');
  });

  it('死因が null の死亡は cause="不明"', () => {
    const p = buildRunPayload(snapshot({ deathCause: null }), {
      runId: 'run-3',
      name: 'x',
      escaped: false,
      dead: true,
    });
    expect(p.cause).toBe('不明');
  });

  it('生還は escaped=true・cause="生還"', () => {
    const p = buildRunPayload(snapshot(), {
      runId: 'run-4',
      name: 'x',
      escaped: true,
      dead: false,
    });
    expect(p.escaped).toBe(true);
    expect(p.cause).toBe('生還');
  });

  it('skillEquipped をコピーして返す(元配列を破壊しない)', () => {
    const skills = ['ryoteHoji', 'katate'];
    const p = buildRunPayload(snapshot({ skillEquipped: skills }), {
      runId: 'run-5',
      name: 'x',
      escaped: false,
      dead: false,
    });
    expect(p.skills).toEqual(skills);
    expect(p.skills).not.toBe(skills);
  });

  it('呼び出しのたびに同じ入力なら同じ出力(副作用なし)', () => {
    const s = snapshot();
    const a = buildRunPayload(s, { runId: 'r', name: 'n', escaped: false, dead: true });
    const b = buildRunPayload(s, { runId: 'r', name: 'n', escaped: false, dead: true });
    expect(a).toEqual(b);
  });
});

describe('SCOREBOARD_URL 未設定(既定)なら fetch を一切呼ばない', () => {
  it('submitRun は fetch を呼ばずに解決する', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(isScoreboardEnabled()).toBe(false);
    await submitRun(
      buildRunPayload(snapshot(), { runId: 'r', name: 'n', escaped: false, dead: true }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetchTop は fetch を呼ばずに null を返す', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchTop('r25');
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('SCOREBOARD_URL 設定時(fetch はスタブ)', () => {
  it('submitRun は /submit へ POST し、ペイロードをそのまま JSON で送る', async () => {
    setScoreboardUrlForTest('http://localhost:8787');
    expect(isScoreboardEnabled()).toBe(true);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const payload = buildRunPayload(snapshot({ deathCause: '毒' }), {
      runId: 'run-x',
      name: 'テスター',
      escaped: false,
      dead: true,
    });
    await submitRun(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8787/submit');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  it('submitRun は fetch が失敗しても例外を投げない(console.warn のみ)', async () => {
    setScoreboardUrlForTest('http://localhost:8787');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      submitRun(buildRunPayload(snapshot(), { runId: 'r', name: 'n', escaped: false, dead: true })),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('fetchTop は /top?v=<version> へ GET し、配列を返す', async () => {
    setScoreboardUrlForTest('http://localhost:8787');
    const entries = [{ runId: 'a', v: 'r25' }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(entries),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchTop('r25');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8787/top?v=r25');
    expect(result).toEqual(entries);
  });

  it('fetchTop は非200なら null', async () => {
    setScoreboardUrlForTest('http://localhost:8787');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchTop('r25')).toBeNull();
  });

  it('fetchTop は例外時に null(console.warn のみ)', async () => {
    setScoreboardUrlForTest('http://localhost:8787');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await fetchTop('r25')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('fetchTop は配列でない応答なら null', async () => {
    setScoreboardUrlForTest('http://localhost:8787');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ not: 'array' }) }),
    );
    expect(await fetchTop('r25')).toBeNull();
  });
});

describe('プレイヤー名(localStorage)', () => {
  it('未設定なら readPlayerName は既定名', () => {
    setNameStorageForTest(memStorage());
    expect(readPlayerName()).toBe('名無しの探索者');
    expect(readPlayerNameRaw()).toBe('');
  });

  it('writePlayerName で保存・読み出しできる', () => {
    setNameStorageForTest(memStorage());
    writePlayerName('こんにちは');
    expect(readPlayerName()).toBe('こんにちは');
    expect(readPlayerNameRaw()).toBe('こんにちは');
  });

  it('24字を超える名前は切り詰められる', () => {
    setNameStorageForTest(memStorage());
    const long = 'あ'.repeat(30);
    writePlayerName(long);
    expect(readPlayerName().length).toBe(24);
  });

  it('storage が無い(Node 環境相当)でも例外を投げない', () => {
    setNameStorageForTest(null);
    expect(() => writePlayerName('x')).not.toThrow();
    expect(readPlayerName()).toBe('名無しの探索者');
  });
});

describe('ラン ID', () => {
  it('startNewRun のたびに異なる ID を採番する', () => {
    startNewRun();
    const a = getRunId();
    startNewRun();
    const b = getRunId();
    expect(a).not.toBe(b);
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
  });

  it('採番前でも getRunId は例外を投げず何かを返す', () => {
    resetRunIdForTest();
    expect(typeof getRunId()).toBe('string');
  });
});
