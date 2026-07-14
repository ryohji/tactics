# 蟻巣迷宮 — 共有スコアボード Worker(rogue-26)

ゲーム本体(`src/state/scoreboard.ts`)は送信のみ。記録と top100 の保持は
この Cloudflare Worker + D1(SQLite)が担う。設計の詳細は
`docs/DECISIONS.md`「スコアボード」「スキル体系の改訂 — スコアボードとの接続」節を参照。

## エンドポイント

- `POST /submit` — ラン1件を `run_id` で upsert する(関門通過のたびのスナップショット
  → 死亡/生還で確定)。JSON 本体は 2KB まで、`name`/`cause`/`skills` に文字数上限あり。
  不正な形は 400。
- `GET /top?v=<GAME_VERSION>` — 指定バージョンの上位100件を
  `depth DESC, kills DESC, turns ASC` で返す(`Cache-Control: public, max-age=30`)。

CORS は `https://ryohji.github.io` と `http://localhost:5173` のみ許可。

## セットアップ(本番デプロイはユーザーが実施)

Cloudflare アカウントが必要なため、このセットアップはユーザー側で行う。

```sh
cd worker
npm install                                   # wrangler・型定義を取得

# 1. D1 データベースを作成(初回のみ)
npx wrangler d1 create fcc-rogue-scoreboard
# 出力される database_id を wrangler.toml の "REPLACE_WITH_D1_DATABASE_ID" に書き込む

# 2. スキーマを適用
npx wrangler d1 execute fcc-rogue-scoreboard --remote --file=./schema.sql

# 3. デプロイ
npx wrangler deploy
```

デプロイ後に表示される Worker の URL(例: `https://fcc-rogue-scoreboard.<subdomain>.workers.dev`)
を、ゲーム側のビルド時環境変数 `VITE_SCOREBOARD_URL` に設定する
(例: GitHub Actions の deploy ワークフローで
`VITE_SCOREBOARD_URL=https://fcc-rogue-scoreboard.<subdomain>.workers.dev npm run build`)。
**未設定(空文字)ならスコアボード機能全体が無効化され、送信も UI も一切動かない** ——
段階的にデプロイできる設計。

## ローカル開発・動作確認

```sh
cd worker
npx wrangler dev --local   # 認証不要。ローカル sqlite(.wrangler/state)で D1 を模擬する
```

別ターミナルで:

```sh
# 送信
curl -X POST http://localhost:8787/submit \
  -H 'Content-Type: application/json' \
  -d '{"runId":"test-1","v":"r25","name":"テスト","seed":1,"depth":3,"kills":2,"turns":10,"stratum":0,"escaped":false,"dead":true,"cause":"グール","skills":[]}'

# 取得
curl 'http://localhost:8787/top?v=r25'
```

ゲーム側をこの Worker に向けて起動する場合は、リポジトリ直下で:

```sh
VITE_SCOREBOARD_URL=http://localhost:8787 npm run dev
```

## スキーマ

`schema.sql` 参照。`runs` テーブル1行=1ラン(`run_id` が主キー)。バージョン別に
ボードを分けるため、取得は必ず `v`(`GAME_VERSION`)で絞り込む。

## 今後の拡張(未実装)

- 改ざん耐性: シード+行動ログを送信し、Worker → `repository_dispatch` →
  GitHub Actions が決定論モデル(vitest/vite-node と同じ経路)で再シミュレートして検証。
  行動ログは既にクライアント側で記録されているが、現段階では送信しない。
