import {
  MASTERY_NAME,
  MASTERY_DEED,
  MASTERY_THRESHOLDS,
  SKILL_NODES,
  NODE_IDS,
  masteryLevels,
  counterFor,
  rankOf,
  unlockedRank,
  knotActive,
  KNOTS,
  type MasterySystem,
  type MasteryCounters,
  type NodeId,
  type EquippedSkill,
} from '../state/rogue';

const SYSTEMS = Object.keys(MASTERY_NAME) as MasterySystem[];

// rogue-27: ノードはランク付きライン(unlockLevels/costs/descsが長さ3)と単発(長さ1)に
// 分かれた。ここでは「初回解禁ティア」= max(1, unlockLevels[0]) でグルーピングする
// (wanaAmi はランクIが Lv0=最初から解禁なので、表示上はティア1へ寄せる)。ランクごとの
// 詳細表示(ピップ・バッジ)は S3 の仕上げ範囲 — ここはコンパイルが通る最小表示に留める。
function nodesFor(system: MasterySystem, tier: number): NodeId[] {
  return NODE_IDS.filter(
    (id) => SKILL_NODES[id].system === system && Math.max(1, SKILL_NODES[id].unlockLevels[0]) === tier,
  );
}

/**
 * マスタリー7系統×ティア1〜3を一覧表示する読み取り専用ツリー(タイトルの図鑑・
 * ラン中の支度画面から共用)。ノード間に前提関係(DAG)は無く、系統ごとの
 * マスタリーレベルで解禁ティアが決まるフラットな構造(DECISIONS 2026-07-11)。
 * 未解禁ノードも名前・効果まで全部見せ、「???」で隠さずに先を予測させる。
 */
export function MasteryTree({
  counters,
  onlyLocked = false,
  skillEquipped,
}: {
  counters: MasteryCounters;
  onlyLocked?: boolean;
  skillEquipped?: EquippedSkill[];
}) {
  const levels = masteryLevels(counters);
  const equipped = skillEquipped ?? [];

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
            {/* 習得条件はツールチップで(rogue-34続き): 育て方+Lv閾値。 */}
            <div className="mastery-head" title={`${MASTERY_DEED[system]}(Lv1:${th[0]} / Lv2:${th[1]} / Lv3:${th[2]})`}>
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
                    // ライン(unlockLevels.length===3)かどうかで異なる表示
                    const isLine = node.unlockLevels.length === 3;
                    if (isLine) {
                      // ランク3行表示
                      return (
                        <div className={`skill-card line-card${unlocked ? '' : ' locked'}`} key={id}>
                          <div className="skill-card-head">
                            <span className="skill-name">{node.name}</span>
                            <span className="skill-cost">コスト{node.costs.join('/')}</span>
                          </div>
                          <div className="line-ranks">
                            {node.descs.map((desc, rankIdx) => {
                              const rank = rankIdx + 1;
                              const current = rankOf(equipped, id);
                              return (
                                <div
                                  key={rank}
                                  className={`rank-row${current >= rank ? ' active' : ''}`}
                                >
                                  <span className="rank-pip">{'●○○'.slice(0, 3).split('')[rankIdx]}</span>
                                  <span className="rank-desc">{desc}</span>
                                  {!unlocked && <span className="rank-req">Lv.{tier}</span>}
                                </div>
                              );
                            })}
                          </div>
                          {!unlocked && (
                            <span className="mastery-req">
                              解禁: {MASTERY_NAME[system]}Lv.{tier}
                            </span>
                          )}
                        </div>
                      );
                    } else {
                      // 単発は従来カード
                      return (
                        <div className={`skill-card${unlocked ? '' : ' locked'}`} key={id}>
                          <div className="skill-card-head">
                            <span className="skill-name">{node.name}</span>
                            <span className="skill-cost">コスト{node.costs[0]}</span>
                          </div>
                          <p className="skill-desc">{node.descs[0]}</p>
                          {!unlocked && (
                            <span className="mastery-req">
                              解禁: {MASTERY_NAME[system]}Lv.{tier}
                            </span>
                          )}
                        </div>
                      );
                    }
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
      {/* 結び: 常時表示(タイトルの図鑑でも先が見える)。発動中(両親装着)/
          装着で発動可(両親が心得レベルで解禁済み)/未解禁 の3状態。 */}
      <div className="knots-section">
          <h3>結び</h3>
          <div className="knots-grid">
            {Object.values(KNOTS).map((knot) => {
              const [[parentA, minA], [parentB, minB]] = knot.parents;
              const aName = SKILL_NODES[parentA].name;
              const bName = SKILL_NODES[parentB].name;
              // 「装着で発動可」は装着状態でなく心得レベルの解禁で判定する
              // (タイトルの図鑑=装着なしの文脈でも未来が見えるように)。
              const aUnlocked = unlockedRank(parentA, levels) >= minA;
              const bUnlocked = unlockedRank(parentB, levels) >= minB;
              const isActive = knotActive(equipped, knot.id);
              return (
                <div
                  key={knot.id}
                  className={`knot-card${isActive ? ' active' : bUnlocked && aUnlocked ? ' unlocked' : ' locked'}`}
                >
                  <div className="knot-name">{knot.name}</div>
                  <div className="knot-parents">
                    {aName} × {bName}
                  </div>
                  <div className="knot-desc">{knot.desc}</div>
                </div>
              );
            })}
          </div>
      </div>
    </div>
  );
}
