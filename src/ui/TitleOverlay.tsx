import { useState } from 'react';
import { useRogue, parseSeed, dailySeed, GAME_VERSION } from '../state/rogue';
import { hasSave, clearSave } from '../state/persist';
import { readHistory } from '../state/history';
import { isScoreboardEnabled, readPlayerNameRaw, writePlayerName } from '../state/scoreboard';
import { unlock } from '../audio/sfx';
import { startBgm } from '../audio/bgm';
import { CodexModal } from './modals/CodexModal';
import { ScoreboardModal } from './modals/ScoreboardModal';

/** タイトル画面: 「これまでの冒険」— ローカル履歴(rogue-20)から深度・討伐上位5件。
    行クリックでそのシードをシード入力欄へ流し込む(同じ迷宮に再挑戦できる)。 */
function HistoryPanel({ onPick }: { onPick: (seed: number) => void }) {
  const [list] = useState(() => readHistory()); // タイトル表示中は変わらないので初回だけ読む
  if (list.length === 0) return null;
  const top5 = [...list].sort((a, b) => b.maxDepth - a.maxDepth || b.kills - a.kills).slice(0, 5);
  return (
    <div className="hud-title-history">
      <div className="hud-title-history-head">これまでの冒険</div>
      <table>
        <tbody>
          {top5.map((r, i) => {
            const old = r.v !== GAME_VERSION;
            return (
              <tr
                key={i}
                className={old ? 'old-version' : undefined}
                title={old ? '旧バージョンの記録(現在のバランスと異なる)' : undefined}
                onClick={() => onPick(r.seed)}
              >
                <td className="depth">深度{r.maxDepth}</td>
                <td>討伐{r.kills}</td>
                <td>{r.turns}T</td>
                <td className="cause">
                  {r.escaped ? '🏆 ' : ''}
                  {r.deathCause}
                </td>
                <td>{r.date.slice(5).replace('-', '/')}</td>
                <td className="daily-mark">{r.daily ? '📅' : ''}</td>
                <td className="seed">#{r.seed}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 初回だけのタイトル画面。開始クリックが音の自動再生制限の解除も兼ねる。 */
export function TitleOverlay() {
  const [entered, setEntered] = useState(false);
  const [seedInput, setSeedInput] = useState('');
  const [saved, setSaved] = useState(() => hasSave());
  const [codexOpen, setCodexOpen] = useState(false);
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  // 共有スコアボード(rogue-26)の名前入力。未設定は空欄(プレースホルダで案内)。
  const [nameInput, setNameInput] = useState(() => readPlayerNameRaw());
  if (entered) return null;

  // 新しく潜る: シード入力があればその迷宮、無ければ起動時のランダム迷宮。
  // どちらも前の保存は破棄される(restart が消す。起動時の仮ゲームは keepSave で温存済み)。
  const enter = () => {
    unlock();
    startBgm();
    const seed = parseSeed(seedInput);
    if (seed !== undefined) useRogue.getState().restart(seed);
    else if (saved) useRogue.getState().restart();
    setEntered(true);
  };
  const resume = () => {
    unlock();
    startBgm();
    if (useRogue.getState().resume()) setEntered(true);
    else setSaved(false); // 壊れた保存などで再開できなければボタンを引っ込める
  };
  // 本日の迷宮: 「新しく潜る」と同じ扱い(restart が前の保存を破棄する)。
  const enterDaily = () => {
    unlock();
    startBgm();
    useRogue.getState().restart(dailySeed(new Date()));
    setEntered(true);
  };
  return (
    <div className="hud-title">
      <div className="hud-title-inner">
        <div className="hud-title-sub">FCC ROGUE</div>
        <h1>蟻巣迷宮</h1>
        <p>
          面心立方の巣を、たいまつひとつで潜る。
          <br />
          明かりを広げれば癒えるが、目立つ。どこまで深く行けるか。
        </p>
        <div className="hud-title-seed">
          <input
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && enter()}
            placeholder="シード(任意。同じシード=同じ迷宮)"
            spellCheck={false}
          />
        </div>
        {isScoreboardEnabled() && (
          <div className="hud-title-name">
            <input
              value={nameInput}
              onChange={(e) => {
                const v = e.target.value.slice(0, 24);
                setNameInput(v);
                writePlayerName(v);
              }}
              placeholder="名前(みんなの記録用・任意)"
              maxLength={24}
              spellCheck={false}
            />
          </div>
        )}
        <div className="hud-title-buttons">
          {saved && (
            <button className="primary" onClick={resume}>
              続きから
            </button>
          )}
          <button className={saved ? 'secondary' : 'primary'} onClick={enter}>
            {saved ? '新しく潜る' : '潜る'}
          </button>
        </div>
        <div className="hud-title-buttons">
          <button
            className="secondary daily"
            onClick={enterDaily}
            title="今日一日だけの共通シード。同じ迷宮でみんなが競える(「新しく潜る」と同じく前の保存は破棄される)"
          >
            📅 本日の迷宮
          </button>
          <button
            className="secondary daily"
            onClick={() => setCodexOpen(true)}
            title="これまでの討伐・収集・実績(rogue-25)"
          >
            📖 図鑑
          </button>
          {isScoreboardEnabled() && (
            <button
              className="secondary daily"
              onClick={() => setScoreboardOpen(true)}
              title="全プレイヤー共有のハイスコア(rogue-26。バージョン別)"
            >
              🏆 みんなの記録
            </button>
          )}
        </div>
        {codexOpen && <CodexModal onClose={() => setCodexOpen(false)} />}
        {scoreboardOpen && <ScoreboardModal onClose={() => setScoreboardOpen(false)} />}
        {saved && (
          <button
            className="discard"
            title="自動保存された冒険のデータを消す"
            onClick={() => {
              clearSave();
              setSaved(false);
            }}
          >
            保存データを破棄
          </button>
        )}
        <HistoryPanel onPick={(seed) => setSeedInput(String(seed))} />
        <div className="hud-title-hint">ドラッグ=視点 / 青マーカー=移動 / M=マップ / TAB=敵に視線</div>
      </div>
    </div>
  );
}
