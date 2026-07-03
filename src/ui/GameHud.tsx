// ゲーム HUD（it-6）。Canvas の上の DOM オーバーレイ。
// ターンバナー / ユニットパネル / 行動メニュー / 戦闘予測 / ログ / 勝敗 / 配置操作。
// 状態はすべて game ストア購読。ここからの入力は game のアクションを呼ぶだけ。

import './hud.css';
import { useGame, availableActions, previewExchange, type ActionKind } from '../state/game';
import { resetView } from '../state/view';
import { CLASSES, SIDE_NAME, isLeader, isFlying, type Unit } from '../model/units';
import { LEADER_WAKE_DIST } from '../model/ai';

void LEADER_WAKE_DIST; // （現状 HUD 未使用。AI 解説を出すときに使う）

const ACTION_LABEL: Record<ActionKind, string> = {
  attack: '⚔ 攻撃',
  heal: '✚ ヒール',
  levitate: '⬆ 浮遊',
};

function Banner() {
  const phase = useGame((s) => s.phase);
  const turn = useGame((s) => s.turn);
  const startBattle = useGame((s) => s.startBattle);
  const endPlayerTurn = useGame((s) => s.endPlayerTurn);
  const uiMode = useGame((s) => s.uiMode);

  if (phase === 'deploy') {
    return (
      <div className="hud-banner">
        <span className="phase-deploy">配置フェーズ</span>
        <span>ユニットを選んで紫のセルへ配置（🎥視点モードで敵陣も確認できる）</span>
        <button className="primary" onClick={startBattle}>出撃</button>
      </div>
    );
  }
  if (phase === 'player') {
    return (
      <div className="hud-banner">
        <span className="phase-player">ターン {turn} ― {SIDE_NAME.player}の番</span>
        <button onClick={endPlayerTurn} disabled={uiMode === 'busy'}>ターン終了</button>
      </div>
    );
  }
  if (phase === 'enemy') {
    return (
      <div className="hud-banner">
        <span className="phase-enemy">{SIDE_NAME.enemy}の行動…</span>
      </div>
    );
  }
  return null;
}

function SystemButtons() {
  const muted = useGame((s) => s.muted);
  const toggleMute = useGame((s) => s.toggleMute);
  const rebuild = useGame((s) => s.rebuild);
  const freeCam = useGame((s) => s.freeCam);
  const toggleFreeCam = useGame((s) => s.toggleFreeCam);
  return (
    <>
      <div className="hud-system">
        <button className={freeCam ? 'active' : ''} onClick={toggleFreeCam}>
          🎥 視点モード{freeCam ? ' 中' : ''}
        </button>
        <button onClick={() => resetView()}>⌖ 視点リセット</button>
        <button onClick={toggleMute}>{muted ? '🔇 音OFF' : '🔊 音ON'}</button>
        <button onClick={rebuild}>↺ 最初から</button>
      </div>
      {freeCam && (
        <div className="hud-viewhint">
          視点モード: 左ドラッグ=移動 / 右ドラッグ=回転 / ホイール=ズーム。もう一度押すとユニット追従へ戻る
        </div>
      )}
    </>
  );
}

function UnitPanel() {
  const selectedId = useGame((s) => s.selectedId);
  const hoverId = useGame((s) => s.hoverId);
  const units = useGame((s) => s.units);
  const u: Unit | undefined =
    units.find((x) => x.id === (hoverId ?? -1) && x.alive) ??
    units.find((x) => x.id === (selectedId ?? -1));
  if (!u) return null;
  const cls = CLASSES[u.cls];
  const ratio = u.hp / cls.hp;
  const hpColor = ratio > 0.5 ? '#22c55e' : ratio > 0.25 ? '#f59e0b' : '#ef4444';
  return (
    <div className="hud-unit">
      <h3>
        <span className={u.side === 'player' ? 'side-player' : 'side-enemy'}>
          {u.name}
          {isLeader(u) && <span className="tag">👑リーダー</span>}
        </span>
        <span>
          {u.hp}/{cls.hp}
        </span>
      </h3>
      <div className="hud-hpbar">
        <div style={{ width: `${ratio * 100}%`, background: hpColor }} />
      </div>
      <div className="hud-stats">
        <span>攻<b>{cls.atk}</b></span>
        <span>防<b>{cls.def}</b></span>
        <span>移動<b>{cls.move}</b></span>
        <span>命中<b>{cls.hit}</b></span>
        <span>回避<b>{cls.evade}</b></span>
        <span>射程<b>{cls.maxRange <= 1.5 ? '近接' : `~${cls.maxRange}`}</b></span>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: '#a5b4fc' }}>
        {CLASSES[u.cls].fly ? '✈ 飛行（足場不要）' : isFlying(u) ? `⬆ 浮遊中（残${u.levitate}）` : '👣 歩行（要足場）'}
        {u.acted && ' ・行動済み'}
      </div>
    </div>
  );
}

function ActionMenu() {
  const uiMode = useGame((s) => s.uiMode);
  const phase = useGame((s) => s.phase);
  const selectedId = useGame((s) => s.selectedId);
  const units = useGame((s) => s.units);
  const board = useGame((s) => s.board);
  const pendingAction = useGame((s) => s.pendingAction);
  const chooseAction = useGame((s) => s.chooseAction);

  if (phase !== 'player' || selectedId === null) return null;
  const u = units.find((x) => x.id === selectedId);
  if (!u) return null;

  if (uiMode === 'actionMenu') {
    const acts = availableActions(u, units, board);
    return (
      <div className="hud-actions">
        {acts.map((a) => (
          <button key={a} onClick={() => chooseAction(a)}>
            {ACTION_LABEL[a]}
          </button>
        ))}
        <button onClick={() => chooseAction('wait')}>… 待機</button>
        <button onClick={() => chooseAction('cancel')}>↩ 戻す</button>
      </div>
    );
  }
  if (uiMode === 'targetSelect') {
    return (
      <div className="hud-actions">
        <span className="hint">
          {pendingAction === 'attack' ? '攻撃する相手を選択' : pendingAction === 'heal' ? '回復する味方を選択' : '浮遊を与える味方を選択'}
        </span>
        <button onClick={() => chooseAction('cancel')}>↩ 戻る</button>
      </div>
    );
  }
  if (uiMode === 'moveSelect') {
    return (
      <div className="hud-actions">
        <span className="hint">移動先（水色）を選択。現在地クリックでその場で行動</span>
        <button onClick={() => chooseAction('cancel')}>選択解除</button>
      </div>
    );
  }
  return null;
}

function ForecastPanel() {
  const s = useGame();
  if (s.uiMode !== 'targetSelect' || s.hoverId === null) return null;
  if (!s.targetIds.includes(s.hoverId)) return null;
  const target = s.units.find((u) => u.id === s.hoverId);
  if (!target) return null;

  if (s.pendingAction === 'attack') {
    const ex = previewExchange(s, s.hoverId);
    if (!ex) return null;
    const f = ex.attack;
    return (
      <div className="hud-forecast">
        <h4>戦闘予測 → {target.name}</h4>
        <div className="row"><span>命中</span><span>{f.hit}%</span></div>
        <div className="row"><span>ダメージ</span><span>{f.dmg}</span></div>
        {(f.height !== 0 || f.cover || f.support > 0 || f.defSupport > 0) && (
          <div className="mod">
            {f.height > 0 && '高所+ '} {f.height < 0 && '低所− '}
            {f.cover && '遮蔽− '}
            {f.support > 0 && `支援×${f.support} `}
            {f.defSupport > 0 && `敵支援×${f.defSupport}`}
          </div>
        )}
        {ex.counter ? (
          <>
            <h4 style={{ marginTop: 8 }}>反撃 ← {target.name}</h4>
            <div className="row"><span>命中</span><span>{ex.counter.hit}%</span></div>
            <div className="row"><span>ダメージ</span><span>{ex.counter.dmg}</span></div>
          </>
        ) : (
          <div className="mod" style={{ marginTop: 6 }}>反撃なし</div>
        )}
      </div>
    );
  }
  return (
    <div className="hud-forecast">
      <h4>{s.pendingAction === 'heal' ? `ヒール → ${target.name}` : `浮遊 → ${target.name}`}</h4>
      <div className="row">
        {s.pendingAction === 'heal' ? <span>HP +6</span> : <span>次の自軍ターン終了まで飛行</span>}
      </div>
    </div>
  );
}

function Log() {
  const log = useGame((s) => s.log);
  if (log.length === 0) return null;
  return (
    <div className="hud-log">
      {log.slice(-5).map((l, i) => (
        <div key={`${i}-${l}`}>{l}</div>
      ))}
    </div>
  );
}

function OverOverlay() {
  const phase = useGame((s) => s.phase);
  const rebuild = useGame((s) => s.rebuild);
  if (phase !== 'victory' && phase !== 'defeat') return null;
  const win = phase === 'victory';
  return (
    <div className="hud-over">
      <h1 className={win ? 'win' : 'lose'}>{win ? '勝利' : '敗北'}</h1>
      <div>{win ? `${SIDE_NAME.enemy}のリーダーを討ち取った!` : 'リーダーが倒れ、軍は撤退した…'}</div>
      <button className="primary" onClick={rebuild}>もう一度戦う</button>
    </div>
  );
}

export function GameHud() {
  return (
    <div className="hud">
      <Banner />
      <SystemButtons />
      <UnitPanel />
      <ActionMenu />
      <ForecastPanel />
      <Log />
      <OverOverlay />
    </div>
  );
}
