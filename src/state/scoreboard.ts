// 共有スコアボード(rogue-26)クライアント基盤。ゲーム側は送信のみ(記録・top100保持は
// worker/ の Cloudflare Worker + D1)。VITE_SCOREBOARD_URL 未設定(空文字)なら
// 機能全体を no-op にする — 現状の挙動を完全維持し、Node/テスト環境でも安全に動く。
//
// ラン ID(runId): restart/resume のたびに crypto.randomUUID() で採番する。ゲームの
// 決定論(戦闘乱数はシード列 rand() から引く。Math.random 禁止 — docs/DECISIONS.md
// 「両手持ち・盾」節)とは無関係な、送信専用の識別子なのでこの禁則の対象外。
// saveData には入れない(再開したランは新 ID になる。簡潔さ優先の判断 — 判断変更するなら報告)。

import { makeKvStore } from './kvStore';
import { GAME_VERSION } from '../model/rogue/types';

const ENV_URL = (import.meta.env.VITE_SCOREBOARD_URL as string | undefined) ?? '';
/** テストで上書きできるよう変数にする(kvStore の setStorageForTest と同じ流儀)。 */
let scoreboardUrl = ENV_URL;

/** テスト用: URL を上書きする。null で環境変数の既定値に戻す。 */
export function setScoreboardUrlForTest(url: string | null): void {
  scoreboardUrl = url ?? ENV_URL;
}

/** SCOREBOARD_URL が設定されているか(UI がボタンの出し分けに使う)。 */
export function isScoreboardEnabled(): boolean {
  return scoreboardUrl !== '';
}

// --- プレイヤー名(localStorage。kvStore と同じ流儀) --------------------------------

const NAME_KEY = 'fcc-rogue-name';
const NAME_MAX = 24;
const DEFAULT_NAME = '名無しの探索者';

const nameStore = makeKvStore<string>(NAME_KEY, () => '', {
  validate: (v): v is string => typeof v === 'string',
});

/** 未設定なら '名無しの探索者'。送信ペイロード組み立て(buildRunPayload)にそのまま渡せる。 */
export function readPlayerName(): string {
  const v = nameStore.read();
  return v.trim().length > 0 ? v.slice(0, NAME_MAX) : DEFAULT_NAME;
}

/** タイトルの名前入力欄から呼ぶ(24字まで切り詰め)。 */
export function writePlayerName(name: string): void {
  nameStore.write(name.slice(0, NAME_MAX));
}

/** タイトルの入力欄の現在値を読む(未設定なら空文字。プレースホルダ表示のため readPlayerName と分ける)。 */
export function readPlayerNameRaw(): string {
  return nameStore.read();
}

/** テスト用: インメモリ実装などに差し替える。 */
export function setNameStorageForTest(s: Storage | null): void {
  nameStore.setStorageForTest(s);
}

// --- ラン ID --------------------------------------------------------------------

let runId: string | null = null;

/** restart/resume の入口から呼ぶ。新しいランに1つの ID を採番する。 */
export function startNewRun(): void {
  runId = crypto.randomUUID();
}

/** 採番前に呼ばれた場合の保険として、その場で1つ発行する(通常は起きない)。 */
export function getRunId(): string {
  if (!runId) runId = crypto.randomUUID();
  return runId;
}

/** テスト用: ラン ID をリセットする。 */
export function resetRunIdForTest(): void {
  runId = null;
}

// --- 送信ペイロード(純関数。テスト対象) -------------------------------------------

/** RogueState から送信に必要なぶんだけを抜き出した形。 */
export interface RunSnapshot {
  seed: number;
  turn: number;
  kills: number;
  maxDepth: number;
  stratum: number;
  deathCause: string | null;
  skillEquipped: readonly string[];
}

export interface RunPayload {
  runId: string;
  v: string;
  name: string;
  seed: number;
  depth: number;
  kills: number;
  turns: number;
  stratum: number;
  escaped: boolean;
  dead: boolean;
  cause: string;
  skills: string[];
}

/**
 * 送信ペイロードを組み立てる純関数(テスト対象)。runId/name は呼び出し側が明示的に渡す
 * ため、グローバル状態(localStorage・現在のラン ID)を読まずにテストできる。
 * escaped/dead どちらも false は「潜行中」(関門通過時点のスナップショット)。
 */
export function buildRunPayload(
  s: RunSnapshot,
  opts: { runId: string; name: string; escaped: boolean; dead: boolean },
): RunPayload {
  const cause = opts.dead ? (s.deathCause ?? '不明') : opts.escaped ? '生還' : '';
  return {
    runId: opts.runId,
    v: GAME_VERSION,
    name: opts.name,
    seed: s.seed,
    depth: s.maxDepth,
    kills: s.kills,
    turns: s.turn,
    stratum: s.stratum,
    escaped: opts.escaped,
    dead: opts.dead,
    cause,
    skills: [...s.skillEquipped],
  };
}

// --- 送受信(SCOREBOARD_URL 未設定なら即 return の no-op) ---------------------------

/**
 * fire-and-forget(呼び出し側は await しない設計)。失敗しても console.warn のみで
 * ゲームは止めない。Promise を返すのはテストで「送信が終わるまで待つ」ため。
 */
export async function submitRun(payload: RunPayload): Promise<void> {
  if (!scoreboardUrl) return;
  try {
    await fetch(`${scoreboardUrl}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn('[scoreboard] 送信に失敗した', err);
  }
}

export interface ScoreEntry {
  runId: string;
  v: string;
  name: string | null;
  seed: number;
  depth: number;
  kills: number;
  turns: number;
  stratum: number;
  escaped: boolean;
  dead: boolean;
  cause: string | null;
  skills: string[];
  updated: number;
}

/** 取得失敗(未設定・ネットワークエラー・非200)は null。 */
export async function fetchTop(v: string): Promise<ScoreEntry[] | null> {
  if (!scoreboardUrl) return null;
  try {
    const res = await fetch(`${scoreboardUrl}/top?v=${encodeURIComponent(v)}`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as ScoreEntry[]) : null;
  } catch (err) {
    console.warn('[scoreboard] 取得に失敗した', err);
    return null;
  }
}
