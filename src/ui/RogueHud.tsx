// rogue の DOM オーバーレイ HUD。
//   左上: プレイヤー状態(HP・深度・ターン・討伐・装備)
//   右上: システム(視点モード/視点リセット/ミュート/最初から)
//   右中: 所持品(クリックで 使う/構える/投擲モード)
//   左下: ホバー中の敵情報
//   右下: ログ / 下中央: 待機・投擲キャンセル
//   死亡: スコアオーバーレイ

import { useRogue, playerAtk, playerDef, depthOf, LIGHT } from '../state/rogue';
import { stepDist } from '../model/dungeon';
import { BEASTS } from '../model/beasts';
import { ITEMS, itemLabel, statLabel, type ItemStack } from '../model/loot';
import { resetView } from '../state/view';
import './hud.css';

function StatusPanel() {
  const player = useRogue((s) => s.player);
  const turn = useRogue((s) => s.turn);
  const kills = useRogue((s) => s.kills);
  const maxDepth = useRogue((s) => s.maxDepth);
  const hpPct = (player.hp / player.maxHp) * 100;
  const hpColor = hpPct > 50 ? '#4ade80' : hpPct > 25 ? '#facc15' : '#ef4444';
  return (
    <div className="hud-rogue-status">
      <h3>
        探索者
        <span className="tag">深度 {depthOf(player.pos)}(最深 {maxDepth})</span>
      </h3>
      <div className="hud-hpbar">
        <div style={{ width: `${hpPct}%`, background: hpColor }} />
      </div>
      <div className="hud-stats">
        <span>HP<b>{player.hp}/{player.maxHp}</b></span>
        <span>攻<b>{playerAtk(player)}</b></span>
        <span>防<b>{playerDef(player)}</b></span>
        <span>ターン<b>{turn}</b></span>
        <span>討伐<b>{kills}</b></span>
      </div>
      <div className="hud-equip">
        <span>
          武器: {player.weapon ? `${itemLabel(player.weapon)}(${statLabel(player.weapon)})` : 'なし'}
        </span>
        <span>
          防具: {player.armor ? `${itemLabel(player.armor)}(${statLabel(player.armor)})` : 'なし'}
        </span>
      </div>
    </div>
  );
}

function SystemButtons() {
  const freeCam = useRogue((s) => s.freeCam);
  const toggleFreeCam = useRogue((s) => s.toggleFreeCam);
  const mapMode = useRogue((s) => s.mapMode);
  const toggleMap = useRogue((s) => s.toggleMap);
  const muted = useRogue((s) => s.muted);
  const toggleMute = useRogue((s) => s.toggleMute);
  const restart = useRogue((s) => s.restart);
  return (
    <>
      <div className="hud-system">
        <button className={mapMode ? 'active' : ''} onClick={toggleMap}>
          🗺マップ(M)
        </button>
        {!mapMode && (
          <button className={freeCam ? 'active' : ''} onClick={toggleFreeCam}>
            🎥視点モード
          </button>
        )}
        <button onClick={() => resetView()}>⌖視点リセット</button>
        <button onClick={toggleMute}>{muted ? '🔇' : '🔊'}</button>
        <button onClick={() => restart()}>↺最初から</button>
      </div>
      {freeCam && !mapMode && (
        <div className="hud-viewhint">左ドラッグ=移動 / 右ドラッグ=旋回 / ホイール=寄り引き</div>
      )}
      {mapMode && (
        <div className="hud-viewhint">
          ドラッグ=回転 / Space+ドラッグ=移動 / TAB=部屋巡回(バブルで移動) / M=戻る
        </div>
      )}
    </>
  );
}

function PackPanel() {
  const pack = useRogue((s) => s.player.pack);
  const useItem = useRogue((s) => s.useItem);
  const mergeItem = useRogue((s) => s.mergeItem);
  const uiMode = useRogue((s) => s.uiMode);
  const phase = useRogue((s) => s.phase);
  const busy = useRogue((s) => s.busy);
  const mapMode = useRogue((s) => s.mapMode);
  if (mapMode) return null;

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
      <h4>所持品</h4>
      {groups.length === 0 && <div className="empty">(なし)</div>}
      {groups.map((g) => {
        const def = ITEMS[g.stack.item];
        const throwing = def.kind === 'thrown' && uiMode === 'throw';
        const verb =
          def.kind === 'potion'
            ? '飲む'
            : def.kind === 'thrown'
              ? throwing
                ? '解除'
                : '投げる'
              : def.kind === 'weapon' || def.kind === 'armor'
                ? '装備'
                : '設置';
        return (
          <div className="pack-row" key={`${g.stack.item}:${g.stack.q}`}>
            <button
              className={throwing ? 'active' : ''}
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

function ActionBar() {
  const phase = useRogue((s) => s.phase);
  const busy = useRogue((s) => s.busy);
  const uiMode = useRogue((s) => s.uiMode);
  const mapMode = useRogue((s) => s.mapMode);
  const wait = useRogue((s) => s.wait);
  const cancelThrow = useRogue((s) => s.cancelThrow);
  if (phase !== 'play' || mapMode) return null;
  return (
    <div className="hud-actions">
      {uiMode === 'throw' ? (
        <>
          <span className="hint">投げナイフ: 射程内の敵をクリック</span>
          <button onClick={cancelThrow}>やめる</button>
        </>
      ) : (
        <>
          <span className="hint">青マーカー=移動 / 隣の敵クリック=攻撃 / TAB=敵に視線</span>
          <LightButton busy={busy} />
          <button disabled={busy} onClick={wait}>
            待機
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
  const restart = useRogue((s) => s.restart);
  if (phase !== 'dead') return null;
  return (
    <div className="hud-over">
      <h1 className="lose">力尽きた…</h1>
      <div className="hud-score">
        最深到達 深度{maxDepth} ／ 討伐 {kills} ／ {turn}ターン
      </div>
      <button className="primary" onClick={() => restart()}>
        再挑戦
      </button>
    </div>
  );
}

export function RogueHud() {
  return (
    <div className="hud">
      <StatusPanel />
      <SystemButtons />
      <PackPanel />
      <BeastPanel />
      <ActionBar />
      <LogPanel />
      <DeadOverlay />
    </div>
  );
}
