import { useRogue, depthOf, STRATUM_DEPTH, rankOf, cdOf } from '../../state/rogue';

/** 脱出ボタン(rogue-25・push-your-luck の自発的終点)。警告帯(深度が
 * 8*(stratum+1) 以上・崩落ライン未満)に居る間だけ表示する。確認モーダルは
 * ここでは開かない — position:fixed の子孫は hud-bottomarea の transform
 * (中間幅メディアクエリ)が containing block になり中央寄せが壊れるため、
 * トップレベル(RogueHud 直下)の EscapeConfirmModal を親から開閉させる。
 */
function EscapeButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  const stratum = useRogue((s) => s.stratum);
  const playerPos = useRogue((s) => s.player.pos);
  const depth = depthOf(playerPos);
  const warnAt = STRATUM_DEPTH * (stratum + 1);
  const canEscape = depth >= warnAt && depth < warnAt + 2;
  if (!canEscape) return null;
  return (
    <button
      className="escape-btn"
      disabled={busy}
      onClick={onClick}
      title="地表へ戻ってランを終える(持ち物の琥珀を確定して持ち帰る)"
    >
      ⛏脱出
    </button>
  );
}

/** 罠編みボタン(rogue-27)。wanaAmi ランクI以上で表示。装填中は無効化。 */
function WeaveTrapButton({ busy }: { busy: boolean }) {
  const skillEquipped = useRogue((s) => s.skillEquipped);
  const cooldowns = useRogue((s) => s.cooldowns);
  const traps = useRogue((s) => s.traps);
  const weaveTrap = useRogue((s) => s.weaveTrap);
  const uiMode = useRogue((s) => s.uiMode);
  const rank = rankOf(skillEquipped, 'wanaAmi');
  if (rank < 1) return null;

  const maxSimultaneous = rank;
  const atCapacity = traps.length >= maxSimultaneous;
  const isActive = uiMode === 'place';
  const cd = cdOf(cooldowns, 'wanaAmi');
  const isDisabled = busy || cd > 0 || atCapacity;

  return (
    <button
      className={`weave-trap-btn${isActive ? ' active' : ''}`}
      disabled={isDisabled}
      onClick={weaveTrap}
      title={`罠を編む(同時${maxSimultaneous}個)`}
    >
      🕸
      {cd > 0 && <span className="cooldown">{cd}</span>}
    </button>
  );
}

/** 連撃ボタン(rogue-30)。rengeki ランクI以上で表示。装填中・武器持ち・敵が隣接していないときは無効化。 */
function RengekiButton({ busy }: { busy: boolean }) {
  const skillEquipped = useRogue((s) => s.skillEquipped);
  const cooldowns = useRogue((s) => s.cooldowns);
  const rengeki = useRogue((s) => s.rengeki);
  const playerWeapon = useRogue((s) => s.player.weapon);
  const beasts = useRogue((s) => s.beasts);
  const hoverBeastId = useRogue((s) => s.hoverBeastId);

  const rank = rankOf(skillEquipped, 'rengeki');
  if (rank < 1) return null;

  const cd = cdOf(cooldowns, 'rengeki');
  const hasWeapon = playerWeapon !== null;

  // 隣接敵がいるかチェック
  const hoverBeast = hoverBeastId !== null ? beasts.find((b) => b.id === hoverBeastId && b.alive) : null;
  const canUse = hoverBeast !== null && !hasWeapon && cd === 0 && !busy;

  const disabledReason = hasWeapon ? '武器を装備している' : cd > 0 ? '装填中' : '隣接敵なし';

  return (
    <button
      disabled={!canUse}
      onClick={() => hoverBeast && rengeki(hoverBeast.id)}
      title={`連撃: 素手で2連撃(${disabledReason})`}
    >
      👊
      {cd > 0 && <span className="cooldown">{cd}</span>}
    </button>
  );
}

/** 下中央バー: よく使う操作(マップ・フォーカス巡回・待機)+ 深度/討伐/ターン。 */
export function BottomBar({ onEscapeClick }: { onEscapeClick: () => void }) {
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
          <WeaveTrapButton busy={busy} />
          <RengekiButton busy={busy} />
          <button onClick={toggleMap} title="マップ(M)">
            🗺
          </button>
          <EscapeButton busy={busy} onClick={onEscapeClick} />
        </>
      )}
    </div>
  );
}
