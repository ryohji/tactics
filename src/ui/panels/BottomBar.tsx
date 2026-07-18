import { useRogue, depthOf, STRATUM_DEPTH, rankOf, cdOf } from '../../state/rogue';
import { ITEMS } from '../../model/loot';

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

/** 盾打ちボタン(rogue-35)。tateuchi ランクI以上・盾装備中で表示。隣接敵をホバーで有効化。 */
function TateuchiButton({ busy }: { busy: boolean }) {
  const skillEquipped = useRogue((s) => s.skillEquipped);
  const cooldowns = useRogue((s) => s.cooldowns);
  const tateuchi = useRogue((s) => s.tateuchi);
  const playerShield = useRogue((s) => s.player.shield);
  const beasts = useRogue((s) => s.beasts);
  const hoverBeastId = useRogue((s) => s.hoverBeastId);

  const rank = rankOf(skillEquipped, 'tateuchi');
  if (rank < 1) return null;
  const hasShield = playerShield !== null && ITEMS[playerShield.item].kind === 'shield';
  if (!hasShield) return null;

  const cd = cdOf(cooldowns, 'tateuchi');
  const hoverBeast = hoverBeastId !== null ? beasts.find((b) => b.id === hoverBeastId && b.alive) : null;
  const canUse = hoverBeast !== null && cd === 0 && !busy;
  const disabledReason = cd > 0 ? '装填中' : '隣接敵なし';

  return (
    <button
      disabled={!canUse}
      onClick={() => hoverBeast && tateuchi(hoverBeast.id)}
      title={`盾打ち: 隣接敵をノックバック+ダメージ(${disabledReason})`}
    >
      🛡
      {cd > 0 && <span className="cooldown">{cd}</span>}
    </button>
  );
}

/** 突進ボタン(rogue-35)。tosshin ランクI以上で表示。dash モードへの入退場を切り替える。 */
function TosshinButton({ busy }: { busy: boolean }) {
  const skillEquipped = useRogue((s) => s.skillEquipped);
  const cooldowns = useRogue((s) => s.cooldowns);
  const tosshin = useRogue((s) => s.tosshin);
  const uiMode = useRogue((s) => s.uiMode);

  const rank = rankOf(skillEquipped, 'tosshin');
  if (rank < 1) return null;

  const cd = cdOf(cooldowns, 'tosshin');
  const isActive = uiMode === 'dash';

  return (
    <button
      className={isActive ? 'active' : ''}
      disabled={busy || cd > 0}
      onClick={tosshin}
      title={`突進: 直線に最大2マス移動して終点で攻撃(${cd > 0 ? '装填中' : '対象方向を選ぶ'})`}
    >
      💨
      {cd > 0 && <span className="cooldown">{cd}</span>}
    </button>
  );
}

/** 替り身ボタン(rogue-35)。kawarimi ランクI以上で表示。隣接敵をホバーで有効化。 */
function KawarimiButton({ busy }: { busy: boolean }) {
  const skillEquipped = useRogue((s) => s.skillEquipped);
  const cooldowns = useRogue((s) => s.cooldowns);
  const kawarimi = useRogue((s) => s.kawarimi);
  const beasts = useRogue((s) => s.beasts);
  const hoverBeastId = useRogue((s) => s.hoverBeastId);

  const rank = rankOf(skillEquipped, 'kawarimi');
  if (rank < 1) return null;

  const cd = cdOf(cooldowns, 'kawarimi');
  const hoverBeast = hoverBeastId !== null ? beasts.find((b) => b.id === hoverBeastId && b.alive) : null;
  const canUse = hoverBeast !== null && cd === 0 && !busy;
  const disabledReason = cd > 0 ? '装填中' : '隣接敵なし';

  return (
    <button
      disabled={!canUse}
      onClick={() => hoverBeast && kawarimi(hoverBeast.id)}
      title={`替り身: 隣接敵と位置を入れ替える(${disabledReason})`}
    >
      👥
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
      ) : uiMode === 'sharpen' ? (
        <>
          <span className="hint">研ぐ: 装備枠か所持品の武具をクリック</span>
          <button onClick={cancelThrow}>やめる</button>
        </>
      ) : uiMode === 'dash' ? (
        <>
          <span className="hint">突進: 直線上の水色マーカーをクリック</span>
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
          <TateuchiButton busy={busy} />
          <TosshinButton busy={busy} />
          <KawarimiButton busy={busy} />
          <button onClick={toggleMap} title="マップ(M)">
            🗺
          </button>
          <EscapeButton busy={busy} onClick={onEscapeClick} />
        </>
      )}
    </div>
  );
}
