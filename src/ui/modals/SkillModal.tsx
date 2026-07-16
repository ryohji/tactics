import { useState } from 'react';
import { useRogue, SKILL_NODES, MASTERY_NAME, equippedCost, unlockedNodes, masteryLevels, readMastery, type NodeId } from '../../state/rogue';
import { MasteryTree } from '../MasteryTree';

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
  if (!outfitting && !draft) return null;
  const used = equippedCost(skillEquipped);
  const mastery = outfitting ? readMastery() : null;
  const unlocked = mastery ? unlockedNodes(masteryLevels(mastery)) : [];

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
            <button className="mastery-peek-toggle" onClick={() => setPeekTree((v) => !v)}>
              🌳 {peekTree ? 'この先の心得を閉じる' : 'この先の心得を覗く'}
            </button>
            {peekTree && <MasteryTree counters={mastery!} onlyLocked />}
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
