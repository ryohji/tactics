// rogue の DOM オーバーレイ HUD。
//   左上: HP バー(数字重ね)
//   右上: システム(明かり/視点リセット/演出/音/最初から/ヘルプ)
//   右中: 所持品(開閉式。最上段に装備枠 — 攻/防はここに表示)
//   左下: ホバー中の敵情報
//   下中央: よく使う操作(マップ・フォーカス巡回・待機)+ 深度/討伐/ターン
//   右下: ログ / 死亡: スコアオーバーレイ

import { useState } from 'react';
import {
  useRogue,
  playerAtk,
  playerDef,
  playerEvade,
  depthOf,
  parseSeed,
  LIGHT,
  SKILL_NODES,
  MASTERY_NAME,
  unlockedNodes,
  masteryLevels,
  equippedCost,
  readMastery,
  type NodeId,
} from '../state/rogue';
import { stepDist } from '../model/dungeon';
import { BEASTS } from '../model/beasts';
import { ITEMS, itemLabel, statLabel, type ItemStack } from '../model/loot';
import { resetView } from '../state/view';
import { shareUrl } from '../state/share';
import './hud.css';

/** 左上: HP バー(数字重ね)+障壁セグメント+状態異常アイコン(rogue-21)。 */
function HpPanel() {
  const player = useRogue((s) => s.player);
  const hpPct = (player.hp / player.maxHp) * 100;
  const hpColor = hpPct > 50 ? '#4ade80' : hpPct > 25 ? '#facc15' : '#ef4444';
  const barrierPct = (Math.min(player.barrier, 24) / 24) * 100;
  return (
    <div className="hud-hp">
      <div className="hud-hpbar big">
        <div style={{ width: `${hpPct}%`, background: hpColor }} />
        {player.barrier > 0 && (
          <div className="barrier" style={{ width: `${barrierPct}%` }} title={`障壁 ${player.barrier}`} />
        )}
        <span className="num">
          {player.hp}/{player.maxHp}
          {player.barrier > 0 && <b className="barrier-num">+{player.barrier}</b>}
        </span>
      </div>
      {(player.status || player.immune > 0) && (
        <div className="hud-status">
          {player.status?.kind === 'poison' && <span title="毒: 毎ターンHP−1(障壁を素通り)">🟣毒{player.status.turns}</span>}
          {player.status?.kind === 'confuse' && <span title="混乱: 移動先がずれることがある">💫混乱{player.status.turns}</span>}
          {player.immune > 0 && <span title="予防: 毒・混乱を受けない">🛡{player.immune}</span>}
        </div>
      )}
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
        <button onClick={onHelp} title="操作説明">
          ❓
        </button>
      </div>
      {mapMode && (
        <div className="hud-viewhint">
          ドラッグ=回転 / Space+ドラッグ=移動 / TAB=部屋巡回(Shift で逆順・バブルで移動) / M・ESC=戻る
        </div>
      )}
    </>
  );
}

const SLOT_NAME = { weapon: '武器', armor: '防具', shield: '盾' } as const;

/** 装備枠1段(所持品パネル最上段)。総攻撃力/防御力/回避%をここに表示する。 */
function EquipSlot({
  slot,
  stack,
  stat,
  locked,
  tag,
  emptyHint,
}: {
  slot: 'weapon' | 'armor' | 'shield';
  stack: ItemStack | null;
  stat: string;
  locked: boolean;
  /** 名前の横に小さく出す短いタグ(武器の「両手」など)。 */
  tag?: string;
  /** 未装備時の代替表示(盾の「両手がふさがっている」など)。省略時は「(なし)」。 */
  emptyHint?: string;
}) {
  const unequip = useRogue((s) => s.unequip);
  return (
    <div className="equip-slot">
      <span className="slot-name">{SLOT_NAME[slot]}</span>
      <span className={`slot-item${stack ? '' : ' empty'}`} title={stack ? statLabel(stack) : ''}>
        {stack ? itemLabel(stack) : (emptyHint ?? '(なし)')}
        {tag && <span className="slot-tag">{tag}</span>}
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
  const skillEquipped = useRogue((s) => s.skillEquipped);
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
      <EquipSlot
        slot="weapon"
        stack={player.weapon}
        stat={`攻${playerAtk(player, skillEquipped)}`}
        locked={locked}
        tag={player.weapon && ITEMS[player.weapon.item].twoHanded ? '両手' : undefined}
      />
      <EquipSlot
        slot="shield"
        stack={player.shield}
        stat={`回避${playerEvade(player, skillEquipped)}%`}
        locked={locked}
        emptyHint={
          player.weapon && ITEMS[player.weapon.item].twoHanded && !skillEquipped.includes('katate')
            ? '(両手がふさがっている)'
            : undefined
        }
      />
      <EquipSlot slot="armor" stack={player.armor} stat={`防${playerDef(player)}`} locked={locked} />
      {skillEquipped.length > 0 && (
        <div className="skill-row">
          {skillEquipped.map((id) => (
            <span key={id} className="skill-chip" title={SKILL_NODES[id].desc}>
              {SKILL_NODES[id].name}·{SKILL_NODES[id].cost}
            </span>
          ))}
        </div>
      )}
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
              : def.kind === 'weapon' || def.kind === 'armor' || def.kind === 'shield'
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

/** スキルノード1枚のカード(名前・系統・コスト・効果1行・装着中/選択可否)。 */
function SkillCard({
  id,
  equipped,
  disabled,
  actionLabel,
  onToggle,
}: {
  id: NodeId;
  equipped: boolean;
  disabled: boolean;
  actionLabel: string;
  onToggle: () => void;
}) {
  const node = SKILL_NODES[id];
  return (
    <div className={`skill-card${equipped ? ' equipped' : ''}`}>
      <div className="skill-card-head">
        <span className="skill-name">{node.name}</span>
        <span className="skill-sys">{MASTERY_NAME[node.system]}</span>
        <span className="skill-cost">コスト{node.cost}</span>
      </div>
      <p className="skill-desc">{node.desc}</p>
      <button className={equipped ? 'active' : ''} disabled={disabled} onClick={onToggle}>
        {actionLabel}
      </button>
    </div>
  );
}

/**
 * スキルのモーダル(rogue-23)。「支度」(ラン開始直後・解禁済み全ノードから自由装着)と
 * 「関門ドラフト」(3択+既存装着の組み替え)を1コンポーネントで扱う。表示中は
 * store 側で busy 相当のブロックがかかっている(clickCell 等は素通りしない)。
 */
function SkillModal() {
  const outfitting = useRogue((s) => s.skillOutfitting);
  const draft = useRogue((s) => s.skillDraft);
  const skillSlots = useRogue((s) => s.skillSlots);
  const skillEquipped = useRogue((s) => s.skillEquipped);
  const equipSkill = useRogue((s) => s.equipSkill);
  const unequipSkill = useRogue((s) => s.unequipSkill);
  const finishOutfitting = useRogue((s) => s.finishOutfitting);
  const skipDraft = useRogue((s) => s.skipDraft);
  if (!outfitting && !draft) return null;
  const used = equippedCost(skillEquipped);
  const unlocked = outfitting ? unlockedNodes(masteryLevels(readMastery())) : [];

  return (
    <div className="hud-help">
      {/* 支度/ドラフトは意思決定が確定要素なので、ヘルプと違い背景クリックでは閉じない
          (誤操作でドラフトを見送ってしまうのを防ぐ)。閉じるのは常に明示ボタンのみ。 */}
      <div className="hud-help-panel skill-panel">
        <h2>{outfitting ? '支度' : '関門を越えた — 新たな心得'}</h2>
        <div className="skill-slots">スロット使用量 {used}/{skillSlots}</div>
        {outfitting ? (
          <>
            <div className="skill-grid">
              {unlocked.map((id) => {
                const eq = skillEquipped.includes(id);
                const disabled = !eq && used + SKILL_NODES[id].cost > skillSlots;
                return (
                  <SkillCard
                    key={id}
                    id={id}
                    equipped={eq}
                    disabled={disabled}
                    actionLabel={eq ? '外す' : '装着'}
                    onToggle={() => (eq ? unequipSkill(id) : equipSkill(id))}
                  />
                );
              })}
            </div>
            <button className="primary" onClick={finishOutfitting}>
              そのまま潜る
            </button>
          </>
        ) : (
          <>
            <h3>候補から1つ</h3>
            <div className="skill-grid">
              {draft!.map((id) => (
                <SkillCard
                  key={id}
                  id={id}
                  equipped={false}
                  disabled={used + SKILL_NODES[id].cost > skillSlots}
                  actionLabel="選ぶ"
                  onToggle={() => equipSkill(id)}
                />
              ))}
            </div>
            {skillEquipped.length > 0 && (
              <>
                <h3>装着中(外して組み替え可)</h3>
                <div className="skill-grid">
                  {skillEquipped.map((id) => (
                    <SkillCard
                      key={id}
                      id={id}
                      equipped
                      disabled={false}
                      actionLabel="外す"
                      onToggle={() => unequipSkill(id)}
                    />
                  ))}
                </div>
              </>
            )}
            <button onClick={skipDraft}>見送る</button>
          </>
        )}
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
            <tr><td>バブルをクリック</td><td>ファストトラベル(敵に気づかれる・画面タップ・ESC で中断)</td></tr>
            <tr><td>TAB / Shift+TAB</td><td>敵・部屋へ視線やフォーカスを巡回 / 逆順</td></tr>
            <tr><td>M</td><td>マップモード切替(ドラッグ=回転 / Space+ドラッグ=移動)</td></tr>
            <tr><td>ESC</td><td>ファストトラベルの中断 / マップを閉じる</td></tr>
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
            <tr><td>盾</td><td>回避率+。両手武器(長槍・大鎚)とは併用不可</td></tr>
            <tr><td>合成</td><td>同じアイテム・同じ品質の2つ → 品質+1(1ターン)</td></tr>
            <tr><td>罠</td><td>足元か隣接セルに設置。敵が踏むと発動</td></tr>
            <tr>
              <td>スキル</td>
              <td>
                関門を越えるとスロットが増え、3択から1つ選ぶ。マスタリー(武技=討伐・盾=回避・甲殻=吸収)を育てると候補が増える。死んでもマスタリーは残る
              </td>
            </tr>
            <tr><td>セーブ</td><td>毎ターン自動保存。死ぬと消える(再挑戦のみ)</td></tr>
          </tbody>
        </table>
        <p className="hud-help-links">
          <a href={`${import.meta.env.BASE_URL}bgm.html`} target="_blank" rel="noreferrer">
            ♪ BGM 試聴室(深度・スタイル別に聴ける)
          </a>
        </p>
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
      <SkillModal />
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
    </div>
  );
}
