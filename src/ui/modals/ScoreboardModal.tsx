import { useEffect, useState } from 'react';
import { fetchTop, type ScoreEntry } from '../../state/scoreboard';
import { SKILL_NODES, GAME_VERSION, type NodeId } from '../../state/rogue';

/** ランク表示(rogue-27: "id:rank" 形式の文字列を分解する)。 */
const RANK_LABEL: Record<string, string> = { '2': 'Ⅱ', '3': 'Ⅲ' };

function skillChipLabel(entry: string): string {
  const [id, rank] = entry.split(':');
  const node = SKILL_NODES[id as NodeId];
  const label = RANK_LABEL[rank ?? ''] ?? '';
  return node ? `${node.name}${label}` : entry;
}

type LoadState = 'loading' | 'ok' | 'error';

/**
 * タイトル画面: 共有スコアボード(rogue-26)。「🏆 みんなの記録」から開く読み取り専用モーダル
 * (CodexModal/hud-help-panel の流儀)。fetchTop(GAME_VERSION) の結果をローディング/
 * 取得失敗/一覧の3状態で表示する(未設定でボタン自体を出さない判断は呼び出し側=TitleOverlay)。
 */
export function ScoreboardModal({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<LoadState>('loading');
  const [entries, setEntries] = useState<ScoreEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchTop(GAME_VERSION).then((result) => {
      if (cancelled) return;
      if (result === null) {
        setState('error');
      } else {
        setEntries(result);
        setState('ok');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="hud-help" onClick={onClose}>
      <div className="hud-help-panel scoreboard-panel" onClick={(e) => e.stopPropagation()}>
        <h2>🏆 みんなの記録</h2>
        <p className="scoreboard-sub">バージョン {GAME_VERSION} の上位100件(深度・討伐・ターン数で順位付け)</p>

        {state === 'loading' && <div className="scoreboard-status">読み込み中…</div>}
        {state === 'error' && <div className="scoreboard-status">接続できなかった</div>}
        {state === 'ok' && entries.length === 0 && (
          <div className="scoreboard-status">まだ記録がない(最初の1件になれる)</div>
        )}
        {state === 'ok' && entries.length > 0 && (
          <div className="scoreboard-list">
            {entries.map((e, i) => (
              <div className="scoreboard-row" key={e.runId}>
                <span className="scoreboard-rank">{i + 1}</span>
                <span className="scoreboard-name">{e.name || '名無しの探索者'}</span>
                <span className="scoreboard-stat">深度{e.depth}</span>
                <span className="scoreboard-stat">討伐{e.kills}</span>
                <span className="scoreboard-stat">{e.turns}T</span>
                <span className="scoreboard-cause">
                  {e.escaped ? '🏆 生還' : e.dead ? (e.cause || '不明') : '潜行中'}
                </span>
                {e.skills.length > 0 && (
                  <div className="scoreboard-skills">
                    {e.skills.map((entry, idx) => (
                      <span className="skill-chip" key={idx}>
                        {skillChipLabel(entry)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <button className="primary" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}
