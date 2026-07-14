-- 共有スコアボード(rogue-26)のスキーマ。D1(SQLite)。
-- 1ラン=1行。関門通過のたびに run_id で upsert し、死亡/生還で確定させる
-- (docs/DECISIONS.md「スキル体系の改訂 — スコアボードとの接続」参照)。
-- v(GAME_VERSION)ごとにボードを分ける前提なので、top100 取得は常に v で絞り込む。

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  name TEXT,
  seed INTEGER,
  depth INTEGER,
  kills INTEGER,
  turns INTEGER,
  stratum INTEGER,
  escaped INTEGER,
  dead INTEGER,
  cause TEXT,
  skills TEXT,
  updated INTEGER
);

-- top100 取得(v 絞り込み + depth/kills/turns の並べ替え)を速くする。
CREATE INDEX IF NOT EXISTS idx_runs_top ON runs (v, depth DESC, kills DESC, turns ASC);
