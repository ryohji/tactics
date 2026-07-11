# 設計整理計画(rogue-17: モジュール統廃合と純関数化)

**✅ 完了済み(2026-07-08)。** 全フェーズ実施済み — 結果は DECISIONS「rogue-17 完了」、
現行アーキテクチャは DESIGN.md を参照。本書は計画時の記録として残す。

2026-07-08 起案。場当たりに積んだ機能を、機能の観点でモジュールへ整理する。
スタイル方針: **クラスは使わない(現状すでに0 — 維持を明文化)。ドメインは
純粋関数+データオブジェクトで表現し、可変状態は境界に集約する。**

## 1. 現状の棚卸し

src 全体 約 12,600 行(テスト込み、旧タクティクス含む)。

### 1.1 死蔵コード(旧タクティクス it-1〜6) — main では未配線

App.tsx は rogue 系のみを配線しており、以下は main から到達不能。
コードは `tactics` ブランチに保存済みなので削除しても失われない。

| 区分 | ファイル | 行数 |
|---|---|---|
| model | terrain / cathedral / classify / rules / units / ai | 1,901 |
| state | game / store | 825 |
| render | Scene / Terrain / Units / TargetField / CameraRig / Effects / HexFloor / focusAnim | 1,408 |
| ui | GameHud / Controls | 394 |
| input | pick | 37 |
| tests | 上記のテスト7本 | 1,076 |
| scripts | preview-terrain(cathedral 依存) | 128 |

計 約 5,800 行。加えて `leva` 依存(Controls/Terrain のみ使用)を package.json から外せる。

**共有につき残すもの**: `model/fcc.ts`(幾何の土台)、`render/rd.ts`(菱形十二面体 —
DungeonShell が使用)、`render/hex.ts`(LevelFloor/MoveMarkers が使用)、
`state/view.ts` / `unitAnim.ts`(rogue が使用)、`audio/sfx.ts`(音名は後述で整理)。

### 1.2 生きているコード(rogue)の問題

- **`state/rogue.ts` が 1,547 行の神モジュール**。ドメイン型、純ヘルパ、可視性、
  経路探索、戦闘、罠・装置、敵AI、湧き、ターン進行、UI 状態(uiMode/armedKey/
  hover/map)、非同期演出、保存・再開、効果音・BGM 呼び出しが同居。
  テストは store 経由でしか書けず、粒度が粗い。
- **`render/rogue/BeastsView.tsx` 690 行**: モデル定義データ・glTF ボディ・
  プロシージャル8種・シルエット・クリック/向き制御が1ファイル。
- **`render/rogue/DungeonShell.tsx` 480 行**: シェル構築と岩肌シェーダ注入が同居。
- **可変シングルトン**が複数(view / unitAnim / playerPose / suppress / touch /
  rogueFocus)。毎フレーム系チャネルとして意図的な設計だが、契約が各ファイルの
  コメント頼み。
- クラスは 0(テスト補助 MemStorage のみ)。zustand ストア1つ+関数群という
  構成自体は好みに合致しており、問題は**境界の混濁**にある。

## 2. 目標アーキテクチャ

```
src/model/          幾何・生成・種族・アイテム(現状維持: 既に純関数+データ)
src/model/rogue/    ★新設: ゲームのドメイン層(Three/React/zustand 非依存)
  types.ts            Beast/PlayerState/Trap/Turret/Decoy/イベント型/SaveData
  player.ts           playerAtk/Def・weaponReach/Sweep・depthOf など純ヘルパ
  visibility.ts       discover: (dungeon, pos, light) → 発見集合の差分
  reach.ts            computeReach/findPath: (open, blockers, start) → BFS 結果
  combat.ts           打撃・被弾・罠発動・砲塔斉射: (slice, rng) → {次slice, events}
  beastTurn.ts        敵1ターン: (world, rng) → {移動/攻撃の決定列, events}
  spawn.ts            populate: (chamber, depth, rng, seq) → {beasts, items}
src/state/rogue.ts  ★縮小(目標 ~400行): 状態+アクション。純関数を呼び、
                     結果をコミットし、イベント列を実行(ログ/SFX/FX/保存)、
                     非同期演出(walkPath 等)の進行だけを持つ
src/state/          view/unitAnim/playerPose = 毎フレーム系チャネル(現状維持、
                     冒頭に契約コメントを統一書式で)
src/render/rogue/   表示コンポーネント(BeastsView を分割、岩マテリアル抽出)
src/audio/          sfx の音色定義をデータ表化(bgmStyles と同じ思想)
```

**イベント方式**: ドメイン純関数は副作用を実行せず
`{ log?: string; sfx?: SfxName; fx?: FxSpec; }[]` を返す。store がまとめて実行する。
これで「同じ入力→同じ出力」がテスト可能になり、乱数呼び出し順も関数内に閉じる。

## 3. フェーズ計画

各フェーズ末で typecheck / 全テスト / build 緑 → コミット → デプロイ可能を維持。

### Phase 0 — 安全網(小)
- **ゴールデンテスト**を追加: 固定シード+固定操作列(歩行・戦闘・罠・階層下降
  を含む 100 ターン程度)を store で再生し、最終状態の要約(プレイヤー/敵/
  アイテム/ターン数/discovered サイズ)をスナップショット固定。
  以降の全フェーズで「挙動が変わっていない」ことの回帰検知に使う。
  ※ シード再現性は**乱数の呼び出し順**に依存するため、分割時の最重要ガード。

### Phase 1 — 死蔵コードの削除(小・効果大)
- §1.1 の一覧を削除。leva を依存から外す。sfx から不使用音名を削除
  (battle/victory/turn/levitate/miss/move — rogue 使用分は残す)。
- README「リポジトリ構成」/ docs/DESIGN.md の該当章を更新。
- メモリーの preview:terrain 注記を更新(スクリプト消滅のため)。
- リスク: 低(未配線の削除)。1コミット。

### Phase 2 — rogue.ts の分割(大・本丸)
挙動を変えずに移すため 5 ステップに分割。各ステップでゴールデンテスト一致を確認。
1. **2a 型と純ヘルパ**: types.ts / player.ts を抽出(機械的な移動+re-export)。
2. **2b 可視性・経路**: discover / computeReach / findPath を純関数化
   (store の Set/Map を引数に。イベントなし)。
3. **2c 戦闘・罠・装置**: beastStrike / damageBeast / triggerTrap / turretsFire を
   イベント返却型へ。rand の受け渡しは「rng 関数を引数に取る」形で順序を保存。
4. **2d 敵ターン**: beastsTurn を (world, rng) → 決定列+イベントへ。
   store 側は決定列を逐次アニメ実行。
5. **2e 湧きと保存境界**: populate 純関数化、autoSave/resume の入出力を
   types.ts の SaveData に寄せる(persist.ts は現状維持)。
- 新テスト: 各純関数モジュールに単体テストを追加(store 経由テストは維持)。
- リスク: 中。緩和 = ゴールデンテスト+ステップごとコミット。

### Phase 3 — 表示・音の整頓(中)
- BeastsView 分割: `beastModels.ts`(種族→モデル/クリップ/色の**データ表**)、
  `GltfBeastBody.tsx`、`ProceduralBodies.tsx`(8種)、`Silhouette.tsx`、
  本体 `BeastsView.tsx`(配置・向き・クリックのみ)。
- DungeonShell から `rockMaterial.ts`(onBeforeCompile 注入)を抽出。
- sfx: 音色パラメータをデータ表化(関数の switch → 定義オブジェクト)。
- リスク: 低〜中(描画は目視確認が必要 → デプロイして QA)。

### Phase 4 — 仕上げ(小)
- `render/rogue/` → `render/` へのフラット化(タクティクス消滅後は階層が冗長)。
  ※ 差分が読みにくくなるため独立コミット。任意 — 好みを確認したい。
- docs/DESIGN.md をローグ現行アーキテクチャで書き直し(モジュール図+
  「クラス不使用・純関数+データ・可変状態は境界のみ」の設計原則を明文化)。
- 未使用 export の掃除。

## 4. やらないこと(今回のスコープ外)
- zustand の廃止(ストア1つ=可変状態の境界として妥当。関数APIでクラスも不要)
- セーブ形式の変更(v2 を維持。Phase 2e は型の置き場所を動かすだけ)
- ゲームバランス・機能追加(整理と混ぜない)

## 5. 見積り
| フェーズ | コミット数 | 主リスク |
|---|---|---|
| 0 | 1 | なし |
| 1 | 1 | 消し漏れ/消し過ぎ(共有モジュール表で防止) |
| 2 | 5 | 乱数順序・敵ターン処理順の非保存 → ゴールデンで検知 |
| 3 | 2〜3 | 見た目の劣化(目視 QA) |
| 4 | 1〜2 | なし |
