import { useState } from 'react';
import {
  useRogue,
  SKILL_NODES,
  ROAD_NAME,
  equippedCost,
  takeable,
  readMastery,
  knotActive,
  KNOTS,
  type NodeId,
  type EquippedSkill,
  type DraftEntry,
} from '../../state/rogue';
import { MasteryTree } from '../MasteryTree';

/** ランクの表示(Ⅰは装着済みチップにも付けない=無印。Ⅱ/Ⅲのみバッジ相当を出す)。 */
const RANK_LABEL: Record<number, string> = { 2: 'Ⅱ', 3: 'Ⅲ' };

/** レーン名表示 */
const LANE_LABEL: Record<string, string> = { en: '縁', shinka: '深化', nagare: '流れ' };

/** コスト差分(新規装着=costs[rank-1] そのもの、ランクアップ=差分だけ)。 */
function costDeltaFor(id: NodeId, rank: number): number {
  const node = SKILL_NODES[id];
  return node.costs[rank - 1] - (rank > 1 ? node.costs[rank - 2] : 0);
}

/** スキルノード1枚のカード(名前・系統・コスト・そのランクの効果1行・選択可否)。 */
function SkillCard({
  id,
  rank,
  equipped,
  disabled,
  actionLabel,
  onToggle,
  lane,
}: {
  id: NodeId;
  /** 表示するランク(装着中はその現在ランク、候補はその目標ランク)。 */
  rank: number;
  equipped: boolean;
  disabled: boolean;
  actionLabel: string;
  onToggle: () => void;
  lane?: string;
}) {
  const node = SKILL_NODES[id];
  return (
    <div className={`skill-card${equipped ? ' equipped' : ''}`}>
      <div className="skill-card-head">
        <span className="skill-name">
          {node.name}
          {RANK_LABEL[rank] ?? ''}
        </span>
        {lane && <span className={`lane-badge lane-${lane}`}>{LANE_LABEL[lane]}</span>}
        <span className="skill-sys">{ROAD_NAME[node.road]}</span>
        <span className="skill-cost">コスト{node.costs[rank - 1]}</span>
      </div>
      <p className="skill-desc">{node.descs[rank - 1]}</p>
      <button className={equipped ? 'active' : ''} disabled={disabled} onClick={onToggle}>
        {actionLabel}
      </button>
    </div>
  );
}

/**
 * スキルのモーダル(rogue-23。rogue-27でランク・天秤ドラフト・見送り権へ改訂)。
 * 「支度」(ラン開始直後・解禁済み全ノードから自由装着)・「関門ドラフト」(3枠+既存装着の
 * 組み替え)・「見送り権('free')」(次の関門で takeable 全体から自由に選ぶ)を1コンポーネントで
 * 扱う。表示中は store 側で busy 相当のブロックがかかっている(clickCell 等は素通りしない)。
 */
export function SkillModal() {
  const outfitting = useRogue((s) => s.skillOutfitting);
  const draft = useRogue((s) => s.skillDraft);
  const skillSlots = useRogue((s) => s.skillSlots);
  const skillEquipped = useRogue((s) => s.skillEquipped);
  const equipSkill = useRogue((s) => s.equipSkill);
  const unequipSkill = useRogue((s) => s.unequipSkill);
  const finishOutfitting = useRogue((s) => s.finishOutfitting);
  const skipDraft = useRogue((s) => s.skipDraft);
  const [peekTree, setPeekTree] = useState(false);
  const isFree = draft === 'free';
  const draftArray = Array.isArray(draft) ? (draft as DraftEntry[]) : null;
  if (!outfitting && !isFree && !draftArray) return null;

  const used = equippedCost(skillEquipped);
  const mastery = outfitting || isFree ? readMastery() : null;
  // 支度・見送り権中は takeable(次に装着できる候補)、ドラフト中は提示された配列。
  const candidates: EquippedSkill[] = mastery ? takeable(skillEquipped, mastery) : (draftArray ?? []);

  // 発動中の結び一覧
  const activeKnots = Object.values(KNOTS).filter((knot) => knotActive(skillEquipped, knot.id));

  return (
    <div className="hud-help">
      {/* 支度/ドラフトは意思決定が確定要素なので、ヘルプと違い背景クリックでは閉じない
          (誤操作でドラフトを見送ってしまうのを防ぐ)。閉じるのは常に明示ボタンのみ。 */}
      <div className="hud-help-panel skill-panel">
        <h2>
          {outfitting ? '支度' : isFree ? '見送りの権利 — 解禁済みから自由に選ぶ' : '関門を越えた — 新たな心得'}
        </h2>
        <div className="skill-slots">
          スロット使用量 {used}/{skillSlots}
        </div>
        <h3>{draftArray ? '候補から1つ' : '装着できる心得'}</h3>
        <div className="skill-grid">
          {candidates.map((c) => (
            <SkillCard
              key={c.id}
              id={c.id}
              rank={c.rank}
              equipped={false}
              disabled={used + costDeltaFor(c.id, c.rank) > skillSlots}
              actionLabel={draftArray ? '選ぶ' : '装着'}
              onToggle={() => equipSkill(c.id)}
              lane={draftArray ? (c as DraftEntry).lane : undefined}
            />
          ))}
        </div>
        {skillEquipped.length > 0 && (
          <>
            <h3>装着中{draftArray ? '(外して組み替え可)' : ''}</h3>
            <div className="skill-grid">
              {skillEquipped.map((e) => (
                <SkillCard
                  key={e.id}
                  id={e.id}
                  rank={e.rank}
                  equipped
                  disabled={false}
                  actionLabel="外す"
                  onToggle={() => unequipSkill(e.id)}
                />
              ))}
            </div>
          </>
        )}
        {activeKnots.length > 0 && (
          <>
            <h3>発動中の結び</h3>
            <div className="knots-list">
              {activeKnots.map((knot) => (
                <div key={knot.id} className="knot-item">
                  <span className="knot-name">{knot.name}</span>
                  <span className="knot-desc">{knot.desc}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {outfitting && (
          <>
            <button className="mastery-peek-toggle" onClick={() => setPeekTree((v) => !v)}>
              🌳 {peekTree ? 'この先の心得を閉じる' : 'この先の心得を覗く'}
            </button>
            {peekTree && <MasteryTree counters={mastery!} onlyLocked skillEquipped={skillEquipped} />}
            <button className="primary" onClick={finishOutfitting}>
              そのまま潜る
            </button>
          </>
        )}
        {!outfitting && <button onClick={skipDraft}>見送る(次の関門で自由に選ぶ)</button>}
      </div>
    </div>
  );
}
