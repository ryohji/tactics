# it-1 設計: 地形合成プロトタイプ

土台ルーチンは `fcc_hex_3d_strategy_spec.md` に確定済み。本書はそれを Web 上で実装するための構造・技術選定・作業分解を定める。座標系・幾何定数は仕様書に厳密準拠する（`OFFSETS` / `BASIS` / `worldPos` / `RD_VERTICES` / `RD_FACES` / `HEX_VERTICES`）。

ゴール（ROADMAP it-1）: 真の3Dボリューム地形に FCC アリーナを重ね、中心から距離 `d` 以内に地形があるセルを進入禁止+遮蔽に分類し、ユニット1体を TP カメラで動かして表示・操作の違和感を確認できる状態。

---

## 1. アーキテクチャ概要

### レイヤ分離
描画から切り離した純 TS のコア（model）を中心に置き、その周りに状態・描画・入力・UI を配置する。コアは Three.js 非依存にしてユニットテスト可能にする（幾何定数の検証はここで担保）。

```
model/   純TS・Three非依存。FCC幾何・地形SDF・分類ロジック。テスト対象。
state/   zustand ストア。params / 各Set / units / active と refresh()。
render/  React Three Fiber。Canvas・マーカー・地形・胞稜線・カメラ。
input/   クリックレイキャスト→移動、カメラ操作。
ui/      leva パネル（d 等の実時間調整・トグル）。
```

データフロー（一方向）:
`params/active 変更 → store.refresh() が model を呼び occluderSet/reachable/threatened を再計算 → render が store を購読して反映`。

再評価（`refresh`）は仕様10章どおり `active` 変更時とトグル/パラメータ変更時のみ走らせる（毎フレームではない）。中規模アリーナ（後述、数千セル）なら d 変更ごとの全再計算で十分軽い。

### ライブラリ選定（推奨確定、理由つき）

| 項目 | 採用 | 理由 |
|---|---|---|
| 描画 | **React Three Fiber + drei** | 宣言的にセル群・状態を反映でき、active 追従カメラやトグル切替が素直。drei に OrbitControls 代替・Instances・Line 等が揃う。中規模での R3F オーバーヘッドは無視できる。 |
| パラメータUI | **leva** | `d`/`S`/`Hmax`/`Lmin..Lmax`/`R_threat` のスライダとトグルを宣言一発で生成でき、要求「実時間調整UI」に直結。 |
| 状態管理 | **zustand** | React 外（入力ハンドラ・レイキャスト）からも更新でき、購読の粒度を絞れる。Redux 的な重さがない。 |
| マーカー描画 | **InstancedMesh（drei `<Instances>`）** | 数千の小球を個別 mesh にすると R3F が重い。これは性能最適化ではなく実用上の必須事項として最初から採用。 |
| ビルド | **Vite + TypeScript** | R3F の標準的な最小構成。 |

> 素の Three.js ではなく R3F を採る判断: it-1 は状態（active/各Set/トグル）に応じた再描画が中心で、命令的 scene 管理より宣言的購読が明らかに楽。性能限界に当たれば該当部だけ命令的に落とせる（R3F は逃げ道を持つ）。

---

## 2. ゲームモデル（仕様6章準拠）

座標・単位の方針: **格子座標空間（実数 `(x,y,z)`）で全ロジックを行う**。`worldPos` は正規直交基底 `e1,e2,e3` × スカラ `S` なので、ワールド距離 = `S` × 格子ユークリッド距離。`d`/`R_threat`/`Hmax` はすべて格子単位（仕様11章）なので、距離はすべて格子空間で素直に測る。`worldPos`（`S` 込み）は描画専用。

```
Cell        = [x,y,z] (整数3つ組, x+y+z 偶数)
arenaSet    : Set<cellKey>   仕様5章の六角柱で生成
occluderSet : Set<cellKey>   §4 の距離 d 判定で生成（地形に重なるセル）
units       : [{ pos, side }]   it-1 は active 1体のみ
active      : Cell           操作ユニット位置 P
enemies     : Cell[]         脅威圏素振り用（任意、仮置き）
params      : { S, d, R_threat, Hmax, Lmin, Lmax, トグル群 }
```

- `cellKey`: `${x},${y},${z}` の文字列で Set/Map のキーにする。
- 1手 = `OFFSETS` の12近傍へ1ステップ（仕様7.3）。`reachable(P) = neighbors(P) ∩ arenaSet − occluderSet − 他ユニット占有`。it-1 は他ユニットなしなので地形と arena 境界のみ。
- `threatened`・`lineBlocked` は仕様7.4/7.5。it-1 では遮蔽フォグ・脅威圏は任意機能（○）なので近似版 `lineBlocked` で足りる。

---

## 3. 地形の内部表現 ＜技術選定: 持ち帰り(a)＞

選択肢を §6 の表と報告本文に明示する。以下は各案の要旨。

- **A. SDF（符号付き距離場・解析合成）**: 地形を `sdf(p): number`（負=内部, 正=外部, 値=最近接表面距離）で定義。プリミティブ（球・箱・平面）の union/subtract でオーバーハング・洞窟を1形状合成。描画は Marching Cubes で等値面 `sdf=0` をメッシュ化。
- **B. ボクセル占有/密度グリッド**: 細かい解像度の `density[i,j,k]`。任意形状・編集容易。距離判定は距離変換(EDT)の前計算かボクセル近傍走査。描画は Marching Cubes / greedy meshing。
- **C. 三角形メッシュ**: モデリング資産をそのまま。描画は自然だが、点→三角形 BVH で最近接距離が必要、かつ内外判定（進入禁止に内部も要る）が面倒。

**推奨: A（SDF）**。理由は §4 と一体なので次節で述べる。

---

## 4. 「中心から距離 d 以内に地形」判定 ＜技術選定: 持ち帰り(b)＞

これは §3 の内部表現とほぼ従属関係にある（表現を決めると判定法がほぼ決まる）。

- **A の場合**: `occluderSet = { cell ∈ arenaSet : sdf(center(cell)) ≤ d }`。`sdf` が「最近接表面距離」そのものなので判定は1評価 O(1)/セル。`d` を変えても係数を変えるだけで即再計算。`d` 調整 UI の要求と完全一致。
- **B の場合**: 各セル中心を含むボクセル近傍を半径 `d` ぶん走査し占有があれば true。または EDT を前計算してサンプル。前計算コスト・解像度依存の量子化誤差あり。
- **C の場合**: 点→三角形 BVH で最近接距離 ≤ d。内部にあるセル（洞窟天井の岩盤内など）を別途内外判定で拾う必要があり、符号の扱いが厄介。

**推奨: A（SDF + 解析評価）**。
理由:
1. 判定 (b) が SDF の定義そのもの。`d` の実時間調整が定数1個の変更で済み、要求の核心に最短で応える。
2. オーバーハング・洞窟を含む「実験用1形状」を解析合成で容易に作れる（DECISIONS の地形方針と合致）。
3. 描画（§5）も同じ SDF を Marching Cubes に通すだけで占有判定と表現が同一ソースから出る → 表示と分類の不整合が原理的に起きない。
4. it-1 のセル数は数千、再計算は `d`/`active` 変更時のみ。SDF 解析評価なら最適化不要で快適。

トレードオフ（A の弱点と対処）: 任意メッシュ資産を後から取り込みたくなったら SDF 化が必要。ただし it-1 は「1形状でよい」制約（REQUIREMENTS 非目標）なので問題にならない。将来資産流用が要件化したら B/C への差し替えを `Terrain` インタフェース（`sdf(p)` と `mesh()` の2メソッド）の裏で行う。

---

## 5. 地形の描画

胞構造と整合する2系統を**トグルで併置**し、検証で見比べられるようにする（仕様8章の 7=塗りつぶし菱形十二面体 / ボリューム表示）。

1. **ボリューム表示**: SDF を Marching Cubes に通した等値面メッシュ。地形の連続的な姿（オーバーハング・洞窟）を見る。
2. **占有セルの菱形十二面体塗り**: `occluderSet` の各セルを `RD_VERTICES`/`RD_FACES` から作った半透明メッシュで塗る。「どのセルが進入禁止になったか」を胞単位で見せ、距離 `d` の効きを直接確認できる。

両者を重ねると「連続地形 ↔ 胞分割」の対応が一望でき、it-1 の検証目的（合成が破綻なく成立しているか）に直結する。マーカー等その他レイヤは仕様8章どおり。

---

## 6. 技術選定表

| 論点 | 選択肢 | トレードオフ | 推奨 |
|---|---|---|---|
| **(a) 地形の内部表現** | A: SDF（解析合成） | 距離判定が自明・形状合成容易・描画はMC1本。任意メッシュ取込は要SDF化 | **A** |
| | B: ボクセル/密度グリッド | 任意形状・編集容易だが、距離は前計算(EDT)か近傍走査・量子化誤差 | |
| | C: 三角形メッシュ | 描画自然・資産流用可だが、距離にBVH・内外判定が厄介 | |
| **(b) 距離 d 判定** | A: SDF解析評価 `sdf(center)≤d` | O(1)/セル・`d`即時調整。(a)=Aに従属 | **A** |
| | B: ボクセル近傍走査/EDT | 前計算コスト・解像度依存 | |
| | C: BVH最近接距離 | 内部セルの符号付き距離が厄介 | |
| 描画ライブラリ | React Three Fiber / 素Three.js | R3Fは宣言的で状態反映が楽・drei資産 | **R3F+drei** |
| パラメータUI | leva / 自作 | levaは宣言一発、要求に直結 | **leva** |
| 状態管理 | zustand / Redux / Context | zustandはReact外更新可・軽量 | **zustand** |

(a)(b) の最終決定はメインスレッドがユーザーと握る。本書は推奨 A を前提に作業分解するが、`Terrain` インタフェース（`sdf(p)` / `mesh()`）で裏を差し替え可能にし、B/C へ転んでも model 上流・描画・分類は無改修で済む構造にする。

---

## 7. TPカメラ と クリック移動（仕様9.1 / 10章）

- **TPカメラ（自己中心旋回）**: 回転中心 `T = worldPos(active)`。`camera.position = T + R_cam·(cosθ·sinφ, sinθ, cosθ·cosφ)`、`lookAt(T)`、FOV≈42°。ドラッグで `φ += dx·k; θ -= dy·k`（θ は ±π/2 弱でクランプ）、ホイールで `R_cam *= (1+dWheel·0.001)`（`[4·S,19·S]` クランプ）。`active` 移動時 `T` が追従。標準 OrbitControls ではなく仕様式に沿った自前リグにする（回転中心を active に固定するため）。
- **クリック移動**: 画面クリック → R3F のレイキャストでヒットしたマーカー球の Cell を取得 → `reachable(active)` に含まれれば `active` を更新し `refresh()`。
- **パラメータ実時間調整UI（leva）**: `d`（遮蔽許容半径, 主役）, `S`, `Hmax`, `Lmin/Lmax`, `R_threat`, トグル（脅威圏 / 遮蔽フォグ / 隣接稜線 / TP⇄FP）。`d`/`S`/アリーナ系の変更は `refresh()` とアリーナ再生成をトリガ。

FP視点・遮蔽フォグ・脅威圏は○（あれば）。トグル枠とロジック（`lineBlocked`/`threatened`）は用意するが、it-1 完了条件には含めない。

---

## 8. 作業分解（実装サブエージェント単位）

依存順: **W0 → (W1, W2 並行) → W3 → W4 → (W5, W6, W7, W8 並行)**。
型の境界を先に固定するため、W3完了時に `Terrain` インタフェースと `store` の型を凍結し、下流はそれを import するだけにする。

| ID | 目的 | 対象ファイル/モジュール | 完了条件 | 依存 |
|---|---|---|---|---|
| **W0** | プロジェクト雛形 | `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/App.tsx`, `src/main.tsx` | `npm run dev` で空の R3F Canvas が表示される | なし |
| **W1** | コア幾何 | `src/model/fcc.ts`（+ `fcc.test.ts`） | `OFFSETS`/`worldPos`/`nearestFCC`/`neighbors`/層`L`/`horizRadius`/`buildArena` を実装。仕様定数一致・arena 個数が `Hmax`/`L` で正しいことをテストで確認 | W0 |
| **W2** | 地形SDF | `src/model/terrain.ts` | `Terrain` インタフェース（`sdf(p)`/`mesh(level)`）と、オーバーハング・洞窟を含むサンプル形状1つ。符号が内外で正しい | W0 |
| **W3** | 分類ロジック | `src/model/classify.ts` | `occluderSet`(`sdf(center)≤d`)・`reachable`・`threatened`・近似`lineBlocked`。`d`↑で occluder 単調増加、reachable が地形/占有を除外 | W1,W2 |
| **W4** | 状態ストア | `src/state/store.ts` | zustand。params・各Set・active・`refresh()`。active/param 変更で W3 を呼び集合更新。**型をここで凍結** | W3 |
| **W5** | マーカー描画 | `src/render/Scene.tsx`, `src/render/Markers.tsx` | InstancedMesh で格子点小球。空き/到達(強調)/脅威で色分け（仕様8章 1・2） | W4 |
| **W6** | 地形描画 | `src/render/Terrain.tsx` | Marching Cubes 等値面メッシュ + `occluderSet` の菱形十二面体塗り（トグル）。`RD_FACES` 準拠 | W4,W2 |
| **W7** | TPカメラ+移動 | `src/render/CameraRig.tsx`, `src/input/pick.ts` | 仕様9.1 の自己中心旋回・ホイール寄り引き・クリック→reachable なら active 更新+refresh | W4,W5 |
| **W8** | パラメータUI | `src/ui/Controls.tsx` | leva で `d` 他・トグル。変更が即 `refresh()`/アリーナ再生成に反映 | W4 |

### ファイル衝突の注意
- **`src/App.tsx` / `src/render/Scene.tsx`** は W5/W6/W7 の合成点。各 W は自前の独立コンポーネント（`Markers`/`Terrain`/`CameraRig`）を別ファイルで実装し、`Scene.tsx` への組み込みは1単位（W5 を統合担当に指定）に集約する。他 W は Scene を直接編集せず、エクスポートしたコンポーネントを W5 が差し込む。
- **`src/state/store.ts`** は W4 が型・API を確定。W5〜W8 は import のみ・編集しない。型変更が要るなら W4 担当へ要求を回す。
- **`src/model/terrain.ts` の `Terrain` 型** は W2 が定義、W3/W6 が参照。(a) の最終決定が A 以外になっても、この型の裏だけ差し替える。

---

## 9. 検証観点（it-1 完了判定）

- アリーナ六角柱が `Hmax`/`Lmin..Lmax` どおり生成され、空きセルが小球で見える。
- 地形ボリュームと占有セル菱形十二面体塗りが重なり、`d` スライダを動かすと occluder が連続的に増減する。
- TPカメラが active 中心で旋回・寄り引きでき、クリックで隣接到達セルへ移動し再評価が走る。
- 「3D地形のヘックス分割・移動・表示が気持ちよくハマっているか」（VISION 北極星）を体で確認できる。

---

## 10. 地形オーサリング層（it-5 追加）

§3-5 の SDF 単一ソース方針は不変。それを「作りやすく・見やすく」する2層を足した。

### 10.1 SDF ツールキット（`src/model/terrain.ts`）
プリミティブ（`sdSphere`/`sdBox`/`sdCappedCylinder`/`sdBoxOriented`）・合成（`smoothUnion`/`subtract`）・
フレーム変換（`toFrame`/`fromFrame`）・`marchingCubes`・`Terrain`/`TerrainMesh` 型を **export する純粋な道具箱**に再編。
具体地形は持たない。Three 非依存。

### 10.2 大聖堂ブループリント（`src/model/cathedral.ts`）
40個の生定数を手で彫る代わりに、**意味のあるパラメータ + 廃墟部品リスト**から距離場を生成する `CathedralSpec` を導入。
- 寸法パラメータ: `naveHalfLen/naveHalfWidth/aisleHalfWidth/floorTop/aisleWallTop/arcadeSpring/clerestoryTop/vaultCrownExtra/bays/apse/westFacade`。柱位置・ベイ中心・アーチ寸法は**ここから導出**する（座標を直に書かない）。
- 廃墟部品（開放性が主役）: `breaches`（不規則カッター群でギザギザの大欠損）/`rubble`（smoothUnion で積む山＝飛行で留まれる足場）/`fallen`（倒れ柱）/`brokenPillars`（崩れたアーケードベイ）/`roofGaps`（屋根が抜け空が覗く）。
- `breaches`/`rubble` は seed つき決定的乱数（LCG）で**再現可能**。
- バシリカ断面（高く細い身廊＋低い側廊＋クリアストーリー）で垂直性を、列柱アーケード（穴あき壁）で見通しを出す。
- `aisles` フラグ: `true`=バシリカ断面（身廊＋側廊＋アーケード）、`false`=側廊なしの**単一大空間**（システィーナ型。背の高い窓が並ぶ一室の大ホール）。
- `buildCathedral(spec): Terrain` が `sdf`+`mesh` を返す。**分類も描画も同一 sdf** なので見た目と移動可否は原理的に一致（不変条件維持）。

### 10.2.1 スケールとアリーナ整合（it-5）
- **1セル = 人型1体**。地形の寸法（セル数）がそのまま「ユニットから見た空間の広さ」になる。既定 `RUINED_CATHEDRAL` はヴォールト頂 ~20セル＝身長の約20倍の大空間。
- 座標↔アリーナ: `horizRadius = hypot(a,b)` / `layer L = u·√3/2`。アリーナは**水平半径 Hmax の円柱 × u 範囲**。`recommendedArena(spec)` が地形フットプリント＋飛行余白から Hmax/Lmax を導出する（身廊長手 a=±naveHalfLen をくるむため Hmax≈naveHalfLen＋余白）。
- `PRESETS`（`ruined` 約29kセル / `sistine` 約85kセル）＝ `{ spec, arena, d }`。`DEFAULT_PRESET`=ruined を store が初期地形・アリーナ・d に使う。`createSampleTerrain()` は `DEFAULT_PRESET.spec` を返す。

### 10.3 オフライン地形プレビュー（`npm run preview:terrain`）
ヘッドレス環境で `/browse` が WebGL を撮れず、毎イテレーション QA が「ユーザ目視待ち」で停滞していた慢性ブロッカーへの対処。
`terrain.ts` が Three 非依存な点を使い、**Node で `Terrain.mesh()` を焼き、自前ソフトウェアレンダラ（zバッファ + Lambert）で複数アングルの PNG に落とす**（`scripts/preview-terrain.ts`）。
ブラウザを起動せず地形のシルエットを反復確認でき、SDF/ブループリントの盲目チューニングを解消する。出力は `docs/qa/preview/`。

---

## 11. ゲームルール層(it-6)

移動基盤(§1-10)の上に載せる層。数値・ルールの確定値は DECISIONS 2026-07-02。

### 11.1 モジュール構成
```
model/units.ts   クラス定義(ステータス・飛行/歩行・スキル)・陣営ロスター。純TS。
model/rules.ts   足場判定・ZOC・移動範囲BFS・射線(clear/cover/blocked)・戦闘予測/解決・支援/高低差補正。純TS。
model/ai.ts      敵行動プラン(移動先×対象のスコアリング)。純TS。
state/game.ts    ゲーム状態機械(zustand)。フェーズ・ユニット・選択・演出キュー・RNG・勝敗。
render/Units.tsx / TargetField.tsx / Effects.tsx   ユニット・対象セル・戦闘演出。
ui/GameHud.tsx   DOMオーバーレイ(バナー・パネル・行動メニュー・予測・ログ・勝敗)。
audio/sfx.ts     WebAudio 合成効果音。
```
既存 `state/store.ts` は**盤面ストア**(terrain / arena / occluder / params / toggles)に縮退。
プロトタイプ専用だった active / enemies / reachableSet / threatSet と Markers / Region / activeAnim は撤去し、ゲーム層が置き換える。データフローは一方向のまま: `盤面ストア(占有情報) → game.ts(ルール適用) → render/ui`。

### 11.2 状態機械
```
phase: deploy → player ⇄ enemy → over(勝敗)
uiMode(player中): idle → unitSelected(移動範囲表示) → actionMenu(移動後)
                → targetSelect(攻撃/ヒール/浮遊) → (解決アニメ) → idle
```
- 移動は確定前キャンセル可(行動前なら元位置へ戻す)。行動(攻撃/スキル/待機)で acted 確定。
- 全味方 acted で自動ターン終了(手動「ターン終了」も可)。陣営ターン終了時に浮遊カウンタを減算し、切れた空中ユニットは直下の足場へ降着。
- 敵ターンは AI が1体ずつ順次実行(演出ディレイ付き・カメラが行動ユニットへフォーカス)。
- 勝敗: リーダー hp0 で即 over。

### 11.3 演出・音
- ユニット = クラス別プリミティブ合成(帽子・翼・盾など)+ 陣営色。HP バー/ダメージ数字は drei Html。
- 演出キュー: game.ts が fx イベント(投射体・被弾・回復・死亡)を発行し Effects.tsx が消費。解決は setTimeout ベースの逐次シーケンス(状態遷移は演出完了後)。
- 効果音は AudioContext + オシレータ/ノイズ合成。初回ユーザ操作で resume。ミュートトグルあり。

### 11.4 性能
- 移動範囲 BFS は Move≤5 で高々数百セル。ZOC/支援判定は12近傍走査。占有 Set はユニット数 O(12)。
- occluderSet は盤面ストアの前計算を共有(ユニット移動では再計算しない — it-5 の教訓を維持)。
