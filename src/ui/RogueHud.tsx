// rogue の DOM オーバーレイ HUD。
//   左上: HP バー(数字重ね)
//   右上: システム(明かり/視点リセット/演出/音/最初から/ヘルプ)
//   右中: 所持品(開閉式。最上段に装備枠 — 攻/防はここに表示)
//   左下: ホバー中の敵情報
//   下中央: よく使う操作(マップ・フォーカス巡回・待機)+ 深度/討伐/ターン
//   右下: ログ / 死亡: スコアオーバーレイ

import { useState } from 'react';
import { useRogue, playerAtk, playerDef, depthOf, parseSeed, LIGHT } from '../state/rogue';
import { stepDist } from '../model/dungeon';
import { BEASTS } from '../model/beasts';
import { ITEMS, itemLabel, statLabel, type ItemStack } from '../model/loot';
import { resetView } from '../state/view';
import { shareUrl } from '../state/share';
import './hud.css';

/** 左上: HP バーのみ(数字はバーに重ねる)。 */
function HpPanel() {
  const player = useRogue((s) => s.player);
  const hpPct = (player.hp / player.maxHp) * 100;
  const hpColor = hpPct > 50 ? '#4ade80' : hpPct > 25 ? '#facc15' : '#ef4444';
  return (
    <div className="hud-hp">
      <div className="hud-hpbar big">
        <div style={{ width: `${hpPct}%`, background: hpColor }} />
        <span className="num">
          {player.hp}/{player.maxHp}
        </span>
      </div>
    </div>
  );
}

function SystemButtons({ onHelp }: { onHelp: () => void }) {
  const mapMode = useRogue((s) => s.mapMode);
  const busy = useRogue((s) => s.busy);
  const muted = useRogue((s) => s.muted);
  const toggleMute = useRogue((s) => s.toggleMute);
  const postFx = useRogue((s) => s.postFx);
  const togglePostFx = useRogue((s) => s.togglePostFx);
  const restart = useRogue((s) => s.restart);
  return (
    <>
      <div className="hud-system">
        {!mapMode && <LightButton busy={busy} />}
        <button onClick={() => resetView()} title="視点リセット">
          ⌖<span className="lbl">視点リセット</span>
        </button>
        <button
          className={postFx ? 'active' : ''}
          onClick={togglePostFx}
          title="光の演出(表示が重い・崩れるときはオフに)"
        >
          ✨
        </button>
        <button onClick={toggleMute}>{muted ? '🔇' : '🔊'}</button>
        <button onClick={() => restart()} title="最初から">
          ↺<span className="lbl">最初から</span>
        </button>
        <button onClick={onHelp} title="操作説明">
          ❓
        </button>
      </div>
      {mapMode && (
        <div className="hud-viewhint">
          ドラッグ=回転 / Space+ドラッグ=移動 / TAB=部屋巡回(Shift で逆順・バブルで移動) / M=戻る
        </div>
      )}
    </>
  );
}

/** 装備枠1段(所持品パネル最上段)。総攻撃力/防御力をここに表示する。 */
function EquipSlot({
  slot,
  stack,
  stat,
  locked,
}: {
  slot: 'weapon' | 'armor';
  stack: ItemStack | null;
  stat: string;
  locked: boolean;
}) {
  const unequip = useRogue((s) => s.unequip);
  return (
    <div className="equip-slot">
      <span className="slot-name">{slot === 'weapon' ? '武器' : '防具'}</span>
      <span className={`slot-item${stack ? '' : ' empty'}`} title={stack ? statLabel(stack) : ''}>
        {stack ? itemLabel(stack) : '(なし)'}
      </span>
      <span className="slot-stat">{stat}</span>
      {stack && (
        <button className="unequip" disabled={locked} onClick={() => unequip(slot)}>
          外す
        </button>
      )}
    </div>
  );
}

function PackPanel() {
  const player = useRogue((s) => s.player);
  const useItem = useRogue((s) => s.useItem);
  const mergeItem = useRogue((s) => s.mergeItem);
  const uiMode = useRogue((s) => s.uiMode);
  const placeIndex = useRogue((s) => s.placeIndex);
  const phase = useRogue((s) => s.phase);
  const busy = useRogue((s) => s.busy);
  const mapMode = useRogue((s) => s.mapMode);
  const [open, setOpen] = useState(true);
  if (mapMode) return null;
  const pack = player.pack;

  // 閉じているときは小さなボタンだけ(画面を奪わない)。
  if (!open) {
    return (
      <button className="hud-pack-fab" onClick={() => setOpen(true)} title="所持品を開く">
        🎒{pack.length > 0 && <span className="cnt">{pack.length}</span>}
      </button>
    );
  }

  // 同種・同品質をまとめて表示(クリックは最初の1個に対して)。
  const groups: { stack: ItemStack; count: number; index: number }[] = [];
  pack.forEach((stack, index) => {
    const g = groups.find((x) => x.stack.item === stack.item && x.stack.q === stack.q);
    if (g) g.count++;
    else groups.push({ stack, count: 1, index });
  });
  const locked = phase !== 'play' || busy;

  return (
    <div className="hud-pack">
      <h4 onClick={() => setOpen(false)} title="たたむ">
        🎒所持品<span className="fold">▾</span>
      </h4>
      <EquipSlot slot="weapon" stack={player.weapon} stat={`攻${playerAtk(player)}`} locked={locked} />
      <EquipSlot slot="armor" stack={player.armor} stat={`防${playerDef(player)}`} locked={locked} />
      {groups.length === 0 && <div className="empty">(なし)</div>}
      {groups.map((g) => {
        const def = ITEMS[g.stack.item];
        const throwing = def.kind === 'thrown' && uiMode === 'throw';
        const placing = def.kind === 'trap' && uiMode === 'place' && placeIndex === g.index;
        const verb =
          def.kind === 'potion'
            ? '飲む'
            : def.kind === 'thrown'
              ? throwing
                ? '解除'
                : '投げる'
              : def.kind === 'weapon' || def.kind === 'armor'
                ? '装備'
                : placing
                  ? '解除'
                  : '設置';
        return (
          <div className="pack-row" key={`${g.stack.item}:${g.stack.q}`}>
            <button
              className={throwing || placing ? 'active' : ''}
              disabled={locked}
              onClick={() => useItem(g.index)}
            >
              {itemLabel(g.stack)}
              {g.count > 1 ? ` ×${g.count}` : ''}
              <span className="use">
                {statLabel(g.stack)}·{verb}
              </span>
            </button>
            {g.count >= 2 && (
              <button className="merge" disabled={locked} onClick={() => mergeItem(g.index)}>
                合成
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BeastPanel() {
  const hoverBeastId = useRogue((s) => s.hoverBeastId);
  const beasts = useRogue((s) => s.beasts);
  const playerPos = useRogue((s) => s.player.pos);
  const b = beasts.find((x) => x.id === hoverBeastId && x.alive);
  if (!b) return null;
  const def = BEASTS[b.kind];
  return (
    <div className="hud-unit">
      <h3>
        <span className="side-enemy">{def.name}</span>
        <span className="tag">{b.awake ? '警戒' : 'まどろみ'}</span>
      </h3>
      <div className="hud-hpbar">
        <div style={{ width: `${(b.hp / def.hp) * 100}%`, background: '#ef4444' }} />
      </div>
      <div className="hud-stats">
        <span>HP<b>{b.hp}/{def.hp}</b></span>
        <span>攻<b>{def.atk}</b></span>
        <span>防<b>{def.def}</b></span>
        <span>距離<b>{stepDist(playerPos, b.pos)}歩</b></span>
      </div>
    </div>
  );
}

/** 下中央バー: よく使う操作(マップ・フォーカス巡回・待機)+ 深度/討伐/ターン。 */
function BottomBar() {
  const phase = useRogue((s) => s.phase);
  const busy = useRogue((s) => s.busy);
  const uiMode = useRogue((s) => s.uiMode);
  const mapMode = useRogue((s) => s.mapMode);
  const wait = useRogue((s) => s.wait);
  const cancelThrow = useRogue((s) => s.cancelThrow);
  const cycleTarget = useRogue((s) => s.cycleTarget);
  const toggleMap = useRogue((s) => s.toggleMap);
  const playerPos = useRogue((s) => s.player.pos);
  const turn = useRogue((s) => s.turn);
  const kills = useRogue((s) => s.kills);
  const maxDepth = useRogue((s) => s.maxDepth);
  if (phase !== 'play') return null;
  const stats = (
    <span className="run-stats">
      深度<b>{depthOf(playerPos)}</b>
      <i>最深{maxDepth}</i> 討伐<b>{kills}</b> <b>{turn}</b>T
    </span>
  );
  return (
    <div className="hud-actions hud-bottom">
      {stats}
      {mapMode ? (
        <>
          {/* 部屋のフォーカス巡回(TAB / Shift+TAB のボタン代替) */}
          <button onClick={() => cycleTarget(-1)} title="前の部屋(Shift+TAB)">
            ◀
          </button>
          <span className="mini">部屋</span>
          <button onClick={() => cycleTarget(1)} title="次の部屋(TAB)">
            ▶
          </button>
          <button className="active" onClick={toggleMap} title="ゲームへ戻る(M)">
            🗺戻る
          </button>
        </>
      ) : uiMode === 'throw' ? (
        <>
          <span className="hint">投げナイフ: 射程内の敵をクリック</span>
          <button onClick={cancelThrow}>やめる</button>
        </>
      ) : uiMode === 'place' ? (
        <>
          <span className="hint">罠の設置: 足元か隣の橙マーカーをクリック</span>
          <button onClick={cancelThrow}>やめる</button>
        </>
      ) : (
        <>
          {/* 敵への視線巡回(TAB / Shift+TAB のボタン代替) */}
          <button disabled={busy} title="前の敵へ視線(Shift+TAB)" onClick={() => cycleTarget(-1)}>
            ◀
          </button>
          <span className="mini">敵</span>
          <button disabled={busy} title="次の敵へ視線(TAB)" onClick={() => cycleTarget(1)}>
            ▶
          </button>
          <button disabled={busy} onClick={wait}>
            待機
          </button>
          <button onClick={toggleMap} title="マップ(M)">
            🗺
          </button>
        </>
      )}
    </div>
  );
}

/** 明かりの段階(視界・回復・敵の気づきやすさのトレードオフ)。 */
function LightButton({ busy }: { busy: boolean }) {
  const lightLevel = useRogue((s) => s.lightLevel);
  const cycleLight = useRogue((s) => s.cycleLight);
  return (
    <button
      disabled={busy}
      onClick={cycleLight}
      title="明かり: 広げるほど視界と回復が増すが、敵に気づかれやすくなる"
    >
      🔥{LIGHT[lightLevel].name}
    </button>
  );
}

function LogPanel() {
  const log = useRogue((s) => s.log);
  return (
    <div className="hud-log">
      {log.slice(-5).map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

function DeadOverlay() {
  const phase = useRogue((s) => s.phase);
  const maxDepth = useRogue((s) => s.maxDepth);
  const kills = useRogue((s) => s.kills);
  const turn = useRogue((s) => s.turn);
  const deathCause = useRogue((s) => s.deathCause);
  const player = useRogue((s) => s.player);
  const seed = useRogue((s) => s.seed);
  const restart = useRogue((s) => s.restart);
  const [seedInput, setSeedInput] = useState('');
  if (phase !== 'dead') return null;
  const result = {
    maxDepth,
    kills,
    turn,
    deathCause,
    weapon: player.weapon,
    armor: player.armor,
    seed,
  };
  const equip = (s: ItemStack | null) => (s ? `${itemLabel(s)}(${statLabel(s)})` : 'なし');
  return (
    <div className="hud-over">
      <h1 className="lose">力尽きた…</h1>
      <div className="hud-score">
        最深到達 深度{maxDepth} ／ 討伐 {kills} ／ {turn}ターン
      </div>
      <div className="hud-score-sub">
        死因: {deathCause ?? '不明'} ／ 武器: {equip(player.weapon)} ／ 防具: {equip(player.armor)}
      </div>
      <div className="hud-score-sub">この迷宮のシード: {seed}</div>
      <div className="hud-seed-row">
        <input
          value={seedInput}
          onChange={(e) => setSeedInput(e.target.value)}
          placeholder="シード(空欄=新しい迷宮)"
          spellCheck={false}
        />
        <button onClick={() => setSeedInput(String(seed))} title="今回のシードを入力欄へ">
          同じ迷宮
        </button>
      </div>
      <div className="hud-over-buttons">
        <button className="primary" onClick={() => restart(parseSeed(seedInput))}>
          再挑戦
        </button>
        <button
          className="share-x"
          title="この結果を X の投稿画面に載せる(送信は X 側で確認できる)"
          onClick={() => window.open(shareUrl(result), '_blank', 'noopener,noreferrer')}
        >
          𝕏 結果をポスト
        </button>
      </div>
    </div>
  );
}

/** 操作説明(❓)。PC とタッチの両方をここに集約し、HUD 上の説明文は最小限にする。 */
function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="hud-help" onClick={onClose}>
      <div className="hud-help-panel" onClick={(e) => e.stopPropagation()}>
        <h2>操作説明</h2>
        <h3>マウス / キーボード</h3>
        <table>
          <tbody>
            <tr><td>左ドラッグ / ホイール</td><td>視点の回転 / 寄り引き</td></tr>
            <tr><td>青マーカーをクリック</td><td>移動(1歩=1ターン)。ホバーで同じ高さの範囲表示</td></tr>
            <tr><td>敵をクリック</td><td>武器リーチ内なら攻撃(ホバーで情報)</td></tr>
            <tr><td>バブルをクリック</td><td>ファストトラベル(敵に気づかれると中断)</td></tr>
            <tr><td>TAB / Shift+TAB</td><td>敵・部屋へ視線やフォーカスを巡回 / 逆順</td></tr>
            <tr><td>M</td><td>マップモード切替(ドラッグ=回転 / Space+ドラッグ=移動)</td></tr>
          </tbody>
        </table>
        <h3>タッチ(スマートフォン)</h3>
        <table>
          <tbody>
            <tr><td>1本指ドラッグ / ピンチ</td><td>視点の回転 / 寄り引き</td></tr>
            <tr><td>2本指ドラッグ</td><td>視点の移動(マップ中)</td></tr>
            <tr><td>マーカー・敵・バブル</td><td><b>1度目のタップ=選択</b>(情報表示)、<b>2度目=実行</b></td></tr>
            <tr><td>◀ ▶ ボタン</td><td>敵・部屋の巡回(TAB の代わり)</td></tr>
          </tbody>
        </table>
        <h3>しくみ</h3>
        <table>
          <tbody>
            <tr><td>🔥明かり</td><td>広げるほど視界と回復が増すが、敵に気づかれやすい</td></tr>
            <tr><td>合成</td><td>同じアイテム・同じ品質の2つ → 品質+1(1ターン)</td></tr>
            <tr><td>罠</td><td>足元か隣接セルに設置。敵が踏むと発動</td></tr>
            <tr><td>セーブ</td><td>毎ターン自動保存。死ぬと消える(再挑戦のみ)</td></tr>
          </tbody>
        </table>
        <button className="primary" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}

export function RogueHud() {
  const [help, setHelp] = useState(false);
  return (
    <div className="hud">
      <HpPanel />
      <SystemButtons onHelp={() => setHelp(true)} />
      <PackPanel />
      <BeastPanel />
      {/* 下部領域: デスクトップでは別配置(display:contents)、狭い画面では
          ログ → ステータス/ボタン の縦積みにして重なりを防ぐ。 */}
      <div className="hud-bottomarea">
        <LogPanel />
        <BottomBar />
      </div>
      <DeadOverlay />
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
    </div>
  );
}
