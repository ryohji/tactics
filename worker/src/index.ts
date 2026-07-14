// 共有スコアボード(rogue-26)の Cloudflare Worker。ゲーム側は送信のみ、
// 記録と top100 保持はここが担う(docs/DECISIONS.md「スコアボード」節)。
//
// - POST /submit: 関門通過(進行中スナップショット)/ 死亡・生還(確定)の両方から
//   同じ形で呼ばれる。run_id(クライアントが1ランに1つ発行する UUID)で upsert する。
//   depth/kills/turns/stratum は同一ランなら本来単調増加のはずだが、リトライ等で
//   古いスナップショットが後から届いても値が後退しないよう MAX() で守る。
// - GET /top?v=<GAME_VERSION>: バージョン別の上位100件。depth 降順 → kills 降順 →
//   turns 昇順(深く・多く倒して・手数が少ないほど上位)。
//
// 認証は無し(公開ゲームのハイスコア掲示板という性質上、書き込みは誰でもできる想定)。
// 改ざん耐性(シード+行動ログの再シミュレート検証)は将来の拡張として温存
// (docs/DECISIONS.md 参照)。ここでは入力バリデーションで壊れたレコードだけ弾く。

export interface Env {
  DB: D1Database;
}

const ALLOWED_ORIGINS = new Set(['https://ryohji.github.io', 'http://localhost:5173']);

const MAX_BODY_BYTES = 2048;
const MAX_NAME_LEN = 24;
const MAX_CAUSE_LEN = 32;
const MAX_SKILLS_JSON_LEN = 400;
const MAX_V_LEN = 16;
const MAX_RUN_ID_LEN = 64;

function corsHeaders(origin: string | null): HeadersInit {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function json(data: unknown, status: number, origin: string | null, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin), ...extra },
  });
}

/** クライアント(src/state/scoreboard.ts の RunPayload)と同じ形。 */
interface SubmitPayload {
  runId: string;
  v: string;
  name?: string;
  seed: number;
  depth: number;
  kills: number;
  turns: number;
  stratum: number;
  escaped: boolean;
  dead: boolean;
  cause?: string;
  skills: string[];
}

function isFiniteInt(x: unknown, min: number, max: number): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
}

/** 壊れた/悪意あるペイロードを弾く。文字列長上限・数値範囲を見るだけの素朴な検証。 */
function validatePayload(x: unknown): { ok: true; value: SubmitPayload } | { ok: false; error: string } {
  if (typeof x !== 'object' || x === null) return { ok: false, error: 'body must be an object' };
  const p = x as Record<string, unknown>;

  if (typeof p.runId !== 'string' || p.runId.length === 0 || p.runId.length > MAX_RUN_ID_LEN) {
    return { ok: false, error: 'invalid runId' };
  }
  if (typeof p.v !== 'string' || p.v.length === 0 || p.v.length > MAX_V_LEN) {
    return { ok: false, error: 'invalid v' };
  }
  if (p.name !== undefined && (typeof p.name !== 'string' || p.name.length > MAX_NAME_LEN)) {
    return { ok: false, error: 'invalid name' };
  }
  if (typeof p.seed !== 'number' || !Number.isFinite(p.seed)) {
    return { ok: false, error: 'invalid seed' };
  }
  if (!isFiniteInt(p.depth, 0, 100_000)) return { ok: false, error: 'invalid depth' };
  if (!isFiniteInt(p.kills, 0, 1_000_000)) return { ok: false, error: 'invalid kills' };
  if (!isFiniteInt(p.turns, 0, 10_000_000)) return { ok: false, error: 'invalid turns' };
  if (!isFiniteInt(p.stratum, 0, 100_000)) return { ok: false, error: 'invalid stratum' };
  if (typeof p.escaped !== 'boolean') return { ok: false, error: 'invalid escaped' };
  if (typeof p.dead !== 'boolean') return { ok: false, error: 'invalid dead' };
  if (p.cause !== undefined && (typeof p.cause !== 'string' || p.cause.length > MAX_CAUSE_LEN)) {
    return { ok: false, error: 'invalid cause' };
  }
  if (!Array.isArray(p.skills) || !p.skills.every((s): s is string => typeof s === 'string')) {
    return { ok: false, error: 'invalid skills' };
  }
  const skills = p.skills;
  const skillsJson = JSON.stringify(skills);
  if (skillsJson.length > MAX_SKILLS_JSON_LEN) return { ok: false, error: 'skills too long' };

  // ここまでの分岐で各フィールドの型は絞り込み済み。SubmitPayload として明示的に組み立てる
  // (p を丸ごとキャストしない — 余計なフィールドが紛れ込んでも黙って通さないため)。
  return {
    ok: true,
    value: {
      runId: p.runId as string,
      v: p.v as string,
      name: p.name as string | undefined,
      seed: p.seed as number,
      depth: p.depth as number,
      kills: p.kills as number,
      turns: p.turns as number,
      stratum: p.stratum as number,
      escaped: p.escaped as boolean,
      dead: p.dead as boolean,
      cause: p.cause as string | undefined,
      skills,
    },
  };
}

async function handleSubmit(req: Request, env: Env, origin: string | null): Promise<Response> {
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json({ error: 'payload too large' }, 400, origin);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid json' }, 400, origin);
  }
  const validated = validatePayload(body);
  if (!validated.ok) return json({ error: validated.error }, 400, origin);
  const p = validated.value;

  const name = (p.name ?? '').slice(0, MAX_NAME_LEN);
  const cause = (p.cause ?? '').slice(0, MAX_CAUSE_LEN);
  const skillsJson = JSON.stringify(p.skills);
  const updated = Date.now();

  // run_id で upsert。関門通過ごとに呼ばれるため既存行のほうが先に進んでいることは
  // 無いはずだが、MAX() で万一の後退(リトライの遅延到着等)から守る。
  await env.DB.prepare(
    `INSERT INTO runs (run_id, v, name, seed, depth, kills, turns, stratum, escaped, dead, cause, skills, updated)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
     ON CONFLICT(run_id) DO UPDATE SET
       v = excluded.v,
       name = excluded.name,
       seed = excluded.seed,
       depth = MAX(excluded.depth, runs.depth),
       kills = MAX(excluded.kills, runs.kills),
       turns = MAX(excluded.turns, runs.turns),
       stratum = MAX(excluded.stratum, runs.stratum),
       escaped = excluded.escaped,
       dead = excluded.dead,
       cause = excluded.cause,
       skills = excluded.skills,
       updated = excluded.updated`,
  )
    .bind(
      p.runId,
      p.v,
      name,
      p.seed,
      p.depth,
      p.kills,
      p.turns,
      p.stratum,
      p.escaped ? 1 : 0,
      p.dead ? 1 : 0,
      cause,
      skillsJson,
      updated,
    )
    .run();

  return json({ ok: true }, 200, origin);
}

interface RunRow {
  run_id: string;
  v: string;
  name: string | null;
  seed: number;
  depth: number;
  kills: number;
  turns: number;
  stratum: number;
  escaped: number;
  dead: number;
  cause: string | null;
  skills: string | null;
  updated: number;
}

/** クライアント(src/state/scoreboard.ts の ScoreEntry)と同じ形へ整形する。 */
function toEntry(r: RunRow) {
  let skills: string[] = [];
  try {
    const parsed = JSON.parse(r.skills ?? '[]');
    if (Array.isArray(parsed)) skills = parsed;
  } catch {
    skills = [];
  }
  return {
    runId: r.run_id,
    v: r.v,
    name: r.name,
    seed: r.seed,
    depth: r.depth,
    kills: r.kills,
    turns: r.turns,
    stratum: r.stratum,
    escaped: !!r.escaped,
    dead: !!r.dead,
    cause: r.cause,
    skills,
    updated: r.updated,
  };
}

async function handleTop(req: Request, env: Env, origin: string | null): Promise<Response> {
  const url = new URL(req.url);
  const v = url.searchParams.get('v');
  if (!v || v.length === 0 || v.length > MAX_V_LEN) {
    return json({ error: 'v required' }, 400, origin);
  }
  const { results } = await env.DB.prepare(
    `SELECT run_id, v, name, seed, depth, kills, turns, stratum, escaped, dead, cause, skills, updated
     FROM runs
     WHERE v = ?1
     ORDER BY depth DESC, kills DESC, turns ASC
     LIMIT 100`,
  )
    .bind(v)
    .all<RunRow>();

  const entries = (results ?? []).map(toEntry);
  return json(entries, 200, origin, { 'Cache-Control': 'public, max-age=30' });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin');
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (req.method === 'POST' && url.pathname === '/submit') {
      return handleSubmit(req, env, origin);
    }
    if (req.method === 'GET' && url.pathname === '/top') {
      return handleTop(req, env, origin);
    }
    return json({ error: 'not found' }, 404, origin);
  },
};
