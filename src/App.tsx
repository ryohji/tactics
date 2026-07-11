import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { RogueScene } from './render/RogueScene';
import { RogueHud } from './ui/RogueHud';
import { useRogue, parseSeed, dailySeed, GAME_VERSION } from './state/rogue';
import { hasSave, clearSave } from './state/persist';
import { readHistory } from './state/history';
import { installKeys } from './input/keys';
import { installTouchFlag } from './input/touch';
import { unlock } from './audio/sfx';
import { startBgm } from './audio/bgm';

// rogue-1 合成点。Canvas 内は <RogueScene/>(洞窟・敵・宝・マーカー・カメラ)。
// tactics(it-6)の Scene/GameHud/Controls は温存してあるが、このブランチでは配線しない。
// 効果音の unlock は毎 pointerdown で呼ぶ(once にしない)。AudioContext は
// ブラウザ都合で随時 suspended に戻りうる(タブ非表示・dev の HMR での作り直し等)ため、
// クリックのたびに resume を試みて自己回復させる。BGM も同じ操作で開始する
// (startBgm は冪等。初回はタイトルの「潜る」クリックがその操作になる)。
export function App() {
  useEffect(() => {
    // QA専用: ?qa のときだけストアを window に公開(ディザ調整のSelenium操作用。本番は無効)。
    if (new URLSearchParams(location.search).has('qa')) (window as unknown as { __rogue: typeof useRogue }).__rogue = useRogue;
    const onDown = () => {
      unlock();
      startBgm();
      // 歩行中の画面タップ/クリックはファストトラベルの中断(travelTo を起こす
      // マーカーのクリックは click で、busy 化はその後。この pointerdown が先に
      // 走る時点ではまだ非歩行なので、開始操作を誤って打ち切ることはない)。
      useRogue.getState().cancelTravel();
    };
    window.addEventListener('pointerdown', onDown);
    installTouchFlag();
    installKeys({
      onCycle: (dir) => useRogue.getState().cycleTarget(dir),
      onToggleMap: () => useRogue.getState().toggleMap(),
      onEscape: () => {
        const s = useRogue.getState();
        if (s.busy) s.cancelTravel();
        else if (s.uiMode !== 'walk') s.cancelThrow();
        else if (s.mapMode) s.toggleMap();
      },
    });
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);

  return (
    <>
      {/* stencil: カットアウェイの断面キャップ用(three r163+ は既定 off)。
          WebGL コンテキストは canvas 生成時にしか属性を変えられないため、key で
          強制的に作り直す(HMR で生き残った stencil 無しの古いコンテキスト対策。
          key を変えれば開きっぱなしのタブでも新コンテキストになる)。 */}
      <Canvas key="gl-stencil-1" gl={{ stencil: true }} camera={{ position: [24, 18, 24], fov: 46 }}>
        <RogueScene />
      </Canvas>
      <RogueHud />
      <TitleOverlay />
    </>
  );
}

/** 初回だけのタイトル画面。開始クリックが音の自動再生制限の解除も兼ねる。 */
function TitleOverlay() {
  const [entered, setEntered] = useState(false);
  const [seedInput, setSeedInput] = useState('');
  const [saved, setSaved] = useState(() => hasSave());
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
        </div>
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
                <td className="cause">{r.deathCause}</td>
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
