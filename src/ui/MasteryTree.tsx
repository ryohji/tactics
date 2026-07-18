import {
  ROAD_NAME,
  DEED_LABEL,
  SKILL_NODES,
  NODE_IDS,
  unlockedRank,
  rankOf,
  knotActive,
  KNOTS,
  type Road,
  type MasteryCounters,
  type NodeId,
  type EquippedSkill,
} from '../state/rogue';

const ROADS: Road[] = ['bu', 'mamori', 'kage', 'waza'];

/** road に属するノードを NODE_IDS の宣言順で返す。 */
function nodesFor(road: Road): NodeId[] {
  return NODE_IDS.filter((id) => SKILL_NODES[id].road === road);
}

/**
 * マスタリー四道(rogue-35)を4列で一覧表示する読み取り専用ツリー(タイトルの図鑑・
 * ラン中の支度画面から共用)。系統Lvの層は廃止 — 各ノードは自分の deed(1つのカウンタ+
 * ランクごとの閾値)で個別に解禁される。未解禁ノードも名前・効果まで全部見せ、
 * 「???」で隠さずに先を予測させる(deed 進捗「行いの説明 n/at」を各カードに表示)。
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
  const equipped = skillEquipped ?? [];

  return (
    <div className="mastery-tree mastery-roads">
      {ROADS.map((road) => {
        const ids = nodesFor(road).filter((id) => {
          if (!onlyLocked) return true;
          const node = SKILL_NODES[id];
          return unlockedRank(id, counters) < node.deed.at.length; // まだ解禁しきっていない
        });
        if (onlyLocked && ids.length === 0) return null;
        return (
          <div className="mastery-system" key={road}>
            <div className="mastery-head">
              <span className="mastery-sys-name">{ROAD_NAME[road]}</span>
            </div>
            <div className="mastery-tier">
              {ids.map((id) => {
                const node = SKILL_NODES[id];
                const maxR = node.deed.at.length;
                const cur = rankOf(equipped, id);
                const unlocked = unlockedRank(id, counters);
                const counterVal = counters[node.deed.counter];
                const deedLabel = DEED_LABEL[node.deed.counter];
                const isLine = maxR === 3;
                return (
                  <div
                    key={id}
                    className={`skill-card${isLine ? ' line-card' : ''}${unlocked > 0 ? '' : ' locked'}`}
                    title={deedLabel}
                  >
                    <div className="skill-card-head">
                      <span className="skill-name">{node.name}</span>
                      <span className="skill-cost">コスト{node.costs.join('/')}</span>
                    </div>
                    {isLine ? (
                      <div className="line-ranks">
                        {node.descs.map((desc, i) => {
                          const rank = i + 1;
                          const isUnlocked = unlocked >= rank;
                          return (
                            <div
                              key={rank}
                              className={`rank-row${cur >= rank ? ' active' : ''}`}
                              title={`${deedLabel}: ${counterVal}/${node.deed.at[i]}`}
                            >
                              <span className="rank-pip">{cur >= rank ? '●' : '○'}</span>
                              <span className="rank-desc">{desc}</span>
                              {!isUnlocked && (
                                <span className="rank-req">
                                  {counterVal}/{node.deed.at[i]}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <>
                        <p className="skill-desc">{node.descs[0]}</p>
                        {unlocked < 1 && (
                          <span className="mastery-req">
                            {deedLabel} {counterVal}/{node.deed.at[0]}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {/* 結び: 常時表示(タイトルの図鑑でも先が見える)。発動中(両親装着)/
          装着で発動可(両親が deed で解禁済み)/未解禁 の3状態。 */}
      <div className="knots-section">
        <h3>結び</h3>
        <div className="knots-grid">
          {Object.values(KNOTS).map((knot) => {
            const [[parentA, minA], [parentB, minB]] = knot.parents;
            const aName = SKILL_NODES[parentA].name;
            const bName = SKILL_NODES[parentB].name;
            // 「装着で発動可」は装着状態でなく deed の解禁で判定する
            // (タイトルの図鑑=装着なしの文脈でも未来が見えるように)。
            const aUnlocked = unlockedRank(parentA, counters) >= minA;
            const bUnlocked = unlockedRank(parentB, counters) >= minB;
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
