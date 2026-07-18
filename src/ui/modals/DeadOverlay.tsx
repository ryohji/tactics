import { useState } from 'react';
import { useRogue, parseSeed } from '../../state/rogue';
import { shareUrl } from '../../state/share';
import { itemLabel, statLabel, type ItemStack } from '../../model/loot';

export function DeadOverlay() {
  const phase = useRogue((s) => s.phase);
  const maxDepth = useRogue((s) => s.maxDepth);
  const kills = useRogue((s) => s.kills);
  const turn = useRogue((s) => s.turn);
  const deathCause = useRogue((s) => s.deathCause);
  const player = useRogue((s) => s.player);
  const seed = useRogue((s) => s.seed);
  const restart = useRogue((s) => s.restart);
  const [seedInput, setSeedInput] = useState('');
  if (phase !== 'dead' && phase !== 'escaped') return null;
  const escaped = phase === 'escaped';
  // 遺物(rogue-25・rogue-34で3種化)は pack ではなく relics に入る(既存バグ修正)。
  const relicCount = player.relics.length;
  const result = {
    maxDepth,
    kills,
    turn,
    deathCause,
    weapon: player.weapon,
    armor: player.armor,
    seed,
    escaped,
  };
  const equip = (s: ItemStack | null) => (s ? `${itemLabel(s)}(${statLabel(s)})` : 'なし');
  return (
    <div className="hud-over">
      <h1 className={escaped ? 'win' : 'lose'}>{escaped ? '生還した!' : '力尽きた…'}</h1>
      <div className="hud-score">
        最深到達 深度{maxDepth} ／ 討伐 {kills} ／ {turn}ターン
      </div>
      {escaped ? (
        <div className="hud-score-sub">遺物 {relicCount} 個を持ち帰った</div>
      ) : (
        <div className="hud-score-sub">
          死因: {deathCause ?? '不明'} ／ 武器: {equip(player.weapon)} ／ 防具: {equip(player.armor)}
        </div>
      )}
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
