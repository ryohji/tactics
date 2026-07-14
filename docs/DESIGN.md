# 設計: FCC Rogue — 蟻巣迷宮

現行(main)のアーキテクチャを記す。イテレーションごとの経緯・判断理由は
`docs/DECISIONS.md`、進捗は `docs/ROADMAP.md` を参照。前身の3Dタクティクス
試作(it-1〜6、FE式戦術戦闘)は `tactics` ブランチに保存されている
(rogue-17 でリポジトリ整理のため main から削除。設計メモは §10)。

---

## 1. 設計原則

- **クラスを使わない**。ドメインは純粋関数とデータオブジェクトの組み合わせで
  表現する(テスト補助を除きクラスは0)。
- **可変状態は境界に限る**: zustand ストア(`state/rogue.ts`)が唯一の
  可変状態の置き場。React コンポーネントの ref・毎フレーム系チャネル
  (`state/view.ts`/`unitAnim.ts`/`playerPose.ts`)も同様に境界側の可変状態。
  `model/` 配下は Three.js にも React にも依存しない純 TS で、渡された
  データから決定的に値を返す(または明示的に渡されたコレクションだけを
  in-place 更新する — 例: `discoverInto(dungeon, from, seeR, discovered)`)。
- **イベント方式**: ドメイン純関数は副作用(ログ・効果音・エフェクト)を
  実行せず `GameEvent[]` を返す。ストアがまとめて実行する
  (`applyEvents` — `model/rogue/types.ts` の `GameEvent` 参照)。
- **決定性**: 迷宮生成・敵の湧き・戦闘乱数はすべてシードから導出できる
  (プレイ再現の要件)。乱数を使う純関数は `rng: () => number` を引数で
  受け取り、モジュールを跨ぐ暗黙の乱数状態を持たない。

---

## 2. モジュール構成

```
model/            幾何・ダンジョン生成・敵/アイテム定義。Three 非依存・テスト対象
model/rogue/      ゲームのドメイン層。Three/React/zustand 非依存の純関数
  types.ts          ドメイン型(Beast/PlayerState/Trap/Turret/Decoy/GameEvent/SaveData)
  rules.ts          depthOf・playerAtk/Def/Evade・weaponReach/Sweep・parseSeed など
  visibility.ts     discoverInto(たいまつの明かり。BFS で discovered を拡張)
  reach.ts          computeReach/findPath/findPathWhere(発見済み空洞の BFS)
  combat.ts         ダメージ計算・障壁吸収・罠効果解決・砲塔照準(GameEvent を返す)
  beastAI.ts        敵1体の意思決定(気づき・ターゲット選択・追跡/逃走)
  spawn.ts          広間生成時の敵・アイテム・門番・遺物の湧き
  mastery.ts        マスタリー7系統・スキルノード25個の定義とドラフト抽選
  feats.ts          実績8種の定義(達成条件は state 側がトリガから判定)
state/            zustand ストア + 毎フレーム系チャネル
  rogue.ts          ストア本体。純関数を呼び、結果をコミットし、非同期演出
                     (自動歩行・攻撃モーション)の進行を管理する薄い層
  view.ts           カメラの旋回角・視線追跡目標(可変シングルトン)
  unitAnim.ts       ユニットの経路アニメ(離散位置と補間表示位置を分離)
  playerPose.ts     プレイヤーモデルの一時ポーズ(攻撃/投擲)
  persist.ts        localStorage 保存/復元(SaveData 丸ごと。ラン単位)
  share.ts          死亡/生還時の X 投稿テキスト生成
  history.ts        ラン履歴(localStorage 別キー。最大100件・自己ベスト)
  masteryStore.ts   マスタリー永続カウンタ(localStorage 別キー。死んでも残る)
  codexStore.ts     討伐/アイテム図鑑・実績・展示棚(localStorage 別キー。死んでも残る)
sim/              バランスシミュレータ(ヘッドレス統計。§9 参照)
  policies.ts       ボット方策(貪欲/慎重など)= (状態)→行動 のインターフェース
  runner.ts         実ストアを fake timers で高速駆動するランナー
  summary.ts        死亡深度分布・死因・種族別寄与などの集計
render/           R3F コンポーネント(フラット。旧 render/rogue/ は rogue-17 で統合)
ui/               DOM オーバーレイの HUD
audio/            WebAudio 合成(効果音・BGM)。外部音声アセットなし
input/            タッチ2段階操作・キーボード・クリック抑制
```

依存の向きは一方向: `model → model/rogue → state → render/ui`。
`state/rogue.ts` は `model/rogue/*` の純関数を呼ぶだけで、逆方向の依存はない。

---

## 3. 幾何(`model/fcc.ts`)

FCC(面心立方)格子をゲームの土台に使う。セルは `[x,y,z]`(整数3つ組・
`x+y+z` が偶数)。`OFFSETS` が12近傍、`worldPos(x,y,z,S)` が格子座標→
ワールド座標の変換(正規直交基底 `e1,e2,e3` × スカラ `S`)、`latticeAt` が
その逆変換(丸め前の実数格子座標)、`nearestFCC` が実数点の量子化。
「水平はヘックス、高さは層」で読める(`layer(c) = (x+y+z)/2`)。

---

## 4. ダンジョン生成(`model/dungeon.ts`)

**スロット式生成**(rogue-16 で再設計)。空間を一辺 `SLOT=12`(ワールド単位)
の立方体スロットに分割し、各スロットの「広間があるか・中心アンカー・半径」
「隣接スロットへのリンク(通路)」を **(シード, スロット座標) の純関数**として
定義する。実体化(`materializeSlot`)しなくても値は計算でき、掘削は加法的
(和集合)なので**どの順に実体化しても同じ巣になる**。

- 重なりは構造で排除: 広間はスロットに最大1つ、予約領域(`1.27×半径+余白`)
  がスロット内に収まる。通路は掘削中、両端スロットの外に出ない。
- 2方向から同じスロットへリンクすると合流(ループ)が自然に生まれる。
- `expandAt(dg, stub)` がスタブ位置のスロットを実体化、`maybeExpand(dg, pos, radius)`
  がプレイヤー接近時に呼ばれる(状態機械側の唯一の呼び出し口)。
- 深度表示(`model/rogue/rules.ts` の `depthOf`)はスロット1段(レイヤ約10)を
  1/4 に換算し、従来の「1部屋の下降 ≈ +2〜3」ペースと敵/アイテムの深度
  テーブルを保っている。

セル位置から導出する `cellRng(seed, cell, salt)` が生成全体の乱数源。
広間の湧き(`model/rogue/spawn.ts`)も広間中心から導出した rng を使うため、
探索順・戦闘乱数に依らずシードだけで結果が決まる。

---

## 5. ドメイン層(`model/rogue/`)

state/rogue.ts の神モジュール化を避けるため(rogue-17)、ゲームロジックを
Three/React/zustand 非依存の純関数へ分離した。

- **visibility.ts / reach.ts**: 発見・到達範囲・経路探索の BFS。
  いずれも `(dungeon, discovered, occupied, ...)` を明示引数に取り、
  ストアのクロージャに依存しない。
- **combat.ts**: `rollAtkDamage(atk, def, rng)` を敵→プレイヤー攻撃・
  近接攻撃で共有。`resolveTrapEffect` が罠の効果(ダメージ or 状態異常)を
  データとして返し、実際の hp 適用・死亡処理はストア側の `damageBeast`/
  `killBeast` が担う(討伐数・ロット抽選・広間の掃討判定まで広く扱うため、
  意図的にストアへ残置)。
- **beastAI.ts**: 敵1体の意思決定 — `stepCandidates`(移動先候補)・
  `checkAggro`(気づき判定。明かりが強いほど遠くから気づかれる)・
  `chooseTarget`(プレイヤー/囮のうち近い方)・`chooseFleeStep`(恐慌時)・
  `outOfTerritory`(縄張り離脱で追跡を諦める)・`chooseChaseStep`(縄張り・
  階層制限内での追跡)。ストアの `beastsTurn` はこれらを呼ぶだけのループ。
- **spawn.ts**: `spawnChamber(dungeon, chamber, nextBeastId, nextItemId)` が
  広間の中心から導出した rng で敵→アイテムの順に湧かせる(呼び出し順が
  乱数列の順序を決めるため厳密に保つ)。

---

## 6. 状態機械(`state/rogue.ts`)

古典ローグ式「プレイヤー1行動=1ターン」。行動のたびに敵が1歩動く
(陣営ターンなし)。ストアは `model/rogue/*` の純関数を呼び、結果を
`set()` でコミットし、`GameEvent[]` を `applyEvents` で実行し、
`await` を跨ぐ非同期演出(自動歩行・攻撃モーション)の進行を管理する
「コミット+実行」の薄い層に位置づける。

- `uiMode`: `walk`(移動)/`throw`(投擲対象選択)/`place`(罠の設置先選択)。
- `phase`: `play` / `dead` / `escaped`(rogue-25: 脱出=生還。dead と同様に
  操作停止・セーブ破棄だが、pack の遺物を展示棚へ確定してから終える)。
- `runSeq`(世代トークン): `restart` のたびに増分し、await を跨ぐ古い
  非同期処理(自動歩行中に再挑戦した場合など)を打ち切る。
- 保存(`SaveData`, `model/rogue/types.ts`): 毎ターン `autoSave` が
  localStorage へスナップショット。バージョン付き(現在 **v6**。破壊的変更の
  たびに繰り上げて旧版は破棄 — v3=層リセット/事前ロール/行動ログ、
  v4=障壁/状態異常、v5=盾、v6=スキルスロット/装着/ドラフト)。
- 行動ログ(`actionLog`): 状態を変える全アクションを `[turn, code, ...args]`
  で記録(将来のリプレイ検証 rogue-26 向け。今は記録のみ)。

### 6a. 層と関門(rogue-19b)

ダンジョンが無限に成長してメモリ・セーブ容量が破綻しないよう、深度
`STRATUM_DEPTH=8` ごとに層を区切る。`endTurn` の `checkStratum` が深度
8(stratum+1) で警告を1回出し、+2 で崩落(`triggerCollapse`)を発動する。
崩落は `Dungeon.cutLayer`(1整数)を下げ、`collapseAbove` が cutLayer より
浅い open セルを刈り・広間を墓標化(id=配列添字の不変条件を守るため
`cells:[]` で残す)・境界向きスタブを used 化する。`materializeSlot` は
cutLayer 付近より浅いスロットを**二度と実体化しない**(集合を持たない
恒久ガード)。store 側も discovered・敵・アイテム・罠等を同じ基準で刈る。
崩落は関門の儀式でもある: スキルスロット+1・3択ドラフト・障壁の剥がれ・
灯火マスタリーの加算がここで起きる。

### 6b. スキル(マスタリー×スロット。rogue-23/24)

二層構造 — **マスタリー(永続・横の広がり)×スロット(ラン内・縦の力)**。
- マスタリー7系統(武技/盾/甲殻/拳闘/隠密/罠師/灯火)は使用実績カウンタ
  (`masteryStore.ts`・死んでも残る)を閾値で Lv0〜3 に離散化し、レベルが
  ノード(全25個・`model/rogue/mastery.ts`)を「選べる候補」として解禁する。
- スロットは初期2・関門+1・門番撃破+1・上限6。装着の組み替えはラン開始の
  「支度」と関門ドラフト(解禁済み未装着から乱数3択)でのみ。
- **決定論ガード**: 候補ゼロ(マスタリー未育成)ではドラフトの乱数もモーダルも
  発生しない(`draftCandidates` は空プールで rng を呼ばない)。ゴールデン
  テストとシミュレータのボットはこの経路を通るため乱数列が保たれる。
  ノード効果の乱数(延焼の刃など)も装着時のみ消費する。

### 6c. 戦闘の拡張(rogue-21/22/24)

- **障壁**: `PlayerState.barrier`(上書き式)。被弾はまず `absorbBarrier` が
  障壁を削り余りが HP へ。酸(acidBarrier)は障壁への削りだけ2倍、毒 DoT は
  障壁を素通り。層の崩落で剥がれる。
- **状態異常**: プレイヤー側は毒/混乱(`PlayerStatus`)、敵側は延焼/混乱/
  恐慌/昏睡(`BeastStatus`)。解毒の水薬が治療+品質ターンの予防。
- **回避**: 盾(+スキル)由来の `playerEvade`。盾なし(回避0)では
  `beastStrike` が回避判定の乱数を引かない(既存ランの乱数列を守る)。
- **遠隔**: `ranged` を持つ敵は射程内かつ `lineOfSight`(0.5刻みの線分
  サンプリング)が通れば離れて撃つ。掲盾スキルが遠隔専用の回避を足す。
- **個体差**: 深度24超の係数スケールと門番の層スケールは `Beast.atkOverride/
  defOverride` で表現(種の定義 `BeastDef` は不変に保つ)。

---

## 7. 描画(`render/`)

- **カットアウェイ**(`DungeonShell.tsx`): 世界モデルは「無限の土の塊から
  発見済みの空洞だけがくり抜かれている」。描くのは空洞の内表面だけで、
  視点手前をクリッピング平面で切り、ステンシルキャップで断面を土色に塗る
  (three.js 公式 `clipping_stencil` の手法)。岩肌はトライプレーナー投影の
  ノイズ(`rockMaterial.ts`)+頂点変位(共有頂点は同量動くので水密性を保つ)。
- **敵**(`BeastsView.tsx` ほか): `beastModels.ts` が種族→glTF モデルの
  データ表、`GltfBeastBody.tsx`/`ProceduralBodies.tsx` が本体、
  `Silhouette.tsx` がフォーカス時の反転ハル(プロシージャル種)。glTF 種は
  骨アニメと同期しない反転ハルの代わりに発光パルスでフォーカスを示す。
  スキン付きメッシュのスケール正規化は**バインドポーズの
  ジオメトリ境界**(`geometry.boundingBox × matrixWorld`)から行う —
  `Box3.setFromObject` は描画前のボーン行列が単位行列のため、armature に
  スケールを持つモデル(Quaternius 系)で境界が暴発する既知の落とし穴。
- **プレイヤー**(`PlayerView.tsx`): KayKit Knight.glb。状態機械
  死亡>攻撃/投擲(一時ポーズ)>歩行>待機。
- **カメラ**(`RogueCamera.tsx`): 1本指旋回/2本指パン(マップのみ)/
  ピンチズーム。TAB フォーカス中は敵の補間位置へ毎フレーム視線目標を
  更新し、短弧トゥイーンで追従(到達しても追跡中は解除しない)。

---

## 8. 音(`audio/`)

- **効果音**(`sfx.ts`): 音色は宣言的なレイヤー配列(`SfxName → SfxLayer[]`)
  のデータ表。`tone`/`noise` の2つの合成関数に対し `playLayer` が
  ディスパッチする。外部音声アセットなし。
- **BGM**(`bgmEngine.ts` + `bgmStyles.ts`): エンジンは音階・和音・音色・
  リズムパターンを `BgmStyle` データとして受け取る生成器。ゲーム本編は
  `bgm.ts`(薄いラッパ)経由で「洞窟」スタイルを常用し、深度に応じて層
  (リズム/流水/旋律)がフェードインする。加わる層が埋もれないよう、
  ベース層(ドローン/パッド/風)を深度でダッキングする。`bgm.html`
  (試聴室)で深度・シーン別の聴き比べと、地域風スタイルの試作
  (ケルト/アラブ/エジプト/インド)を確認できる。

---

## 9. テスト戦略とバランス計測

- `model/**/*.test.ts`: 純関数の単体テスト(幾何・生成・戦闘計算など)。
- `state/rogue.test.ts`: ストア経由の統合テスト(fake timers で非同期
  演出を進める)。
- `state/golden.test.ts`(rogue-17): 固定シード+固定方針で戦闘・回復・
  罠設置・探索・広間拡張・深層降下・死亡までを1本通し、最終状態を
  スナップショット固定する。リファクタリングで**乱数の呼び出し順**が
  崩れていないことを検知する回帰網(意図した挙動変更時のみ更新)。
  ※ golden の固定方針と `sim/policies.ts` の貪欲方策は似ているが
  **意図的に別物**(golden は凍結された回帰網なので共通化しない)。
- **バランスシミュレータ**(`src/sim/`・rogue-19a): `npm run balance` で
  実ゲームと同じストアを `setTimeScaleForTest(0)`(演出待ちゼロ)で数百〜
  数千ラン回すヘッドレス統計。ボット方策(貪欲/慎重)×シード集合で
  死亡深度分布(percentile)・死因・通過層数を集計し、**変更前後の A/B 差分**で
  難度の意図せぬ変動を検出する(ベースラインは `docs/balance/`)。厳密一致は
  golden、統計はシミュレータ、人間の実データはローカルスコアボード
  (`state/history.ts`)という三段構え。

---

## 10. 旧タクティクス(it-1〜6)

FE式陣営交互ターン・命中率戦闘・3D ZOC を持つ前身の試作。座標系・幾何は
本書と同じ `fcc.ts` を共有していたが、地形は SDF+Marching Cubes、状態は
`state/game.ts`(盤面ストア+ゲーム状態機械)という別系統だった。
コード一式は `tactics` ブランチに残る。設計判断の経緯は git 履歴の
本ファイル(rogue-17 より前のバージョン)、または `tactics` ブランチの
`docs/DECISIONS.md` を参照。
