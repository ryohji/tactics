import {
  MASTERY_NAME,
  MASTERY_THRESHOLDS,
  SKILL_NODES,
  NODE_IDS,
  masteryLevels,
  counterFor,
  type MasterySystem,
  type MasteryCounters,
  type NodeId,
} from '../state/rogue';

const SYSTEMS = Object.keys(MASTERY_NAME) as MasterySystem[];

function nodesFor(system: MasterySystem, tier: number): NodeId[] {
  return NODE_IDS.filter((id) => SKILL_NODES[id].system === system && SKILL_NODES[id].unlockLevel === tier);
}

/**
 * マスタリー7系統×ティア1〜3を一覧表示する読み取り専用ツリー(タイトルの図鑑・
 * ラン中の支度画面から共用)。ノード間に前提関係(DAG)は無く、系統ごとの
 * マスタリーレベルで解禁ティアが決まるフラットな構造(DECISIONS 2026-07-11)。
 * 未解禁ノードも名前・効果まで全部見せ、「???」で隠さずに先を予測させる。
 */
export function MasteryTree({ counters, onlyLocked = false }: { counters: MasteryCounters; onlyLocked?: boolean }) {
  const levels = masteryLevels(counters);
  return (
    <div className="mastery-tree">
      {SYSTEMS.map((system) => {
        const level = levels[system];
        const th = MASTERY_THRESHOLDS[system];
        const count = counterFor(system, counters);
        const nextTh = level < 3 ? th[level] : null;
        const tiers = [1, 2, 3].filter((tier) => nodesFor(system, tier).length > 0);
        if (onlyLocked && tiers.every((tier) => tier <= level)) return null;
        return (
          <div className="mastery-system" key={system}>
            <div className="mastery-head">
              <span className="mastery-sys-name">{MASTERY_NAME[system]}</span>
              <span className="mastery-lv">Lv.{level}</span>
              <span className="mastery-progress">{nextTh !== null ? `${count}/${nextTh}` : '習熟済み'}</span>
            </div>
            {tiers.map((tier) => {
              const unlocked = tier <= level;
              if (onlyLocked && unlocked) return null;
              return (
                <div className={`mastery-tier${unlocked ? '' : ' locked'}`} key={tier}>
                  {nodesFor(system, tier).map((id) => {
                    const node = SKILL_NODES[id];
                    return (
                      <div className={`skill-card${unlocked ? '' : ' locked'}`} key={id}>
                        <div className="skill-card-head">
                          <span className="skill-name">{node.name}</span>
                          <span className="skill-cost">コスト{node.cost}</span>
                        </div>
                        <p className="skill-desc">{node.desc}</p>
                        {!unlocked && (
                          <span className="mastery-req">
                            解禁: {MASTERY_NAME[system]}Lv.{tier}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
