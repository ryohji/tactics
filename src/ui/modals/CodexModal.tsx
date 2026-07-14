import { useState } from 'react';
import { readCodex } from '../../state/codexStore';
import { BEASTS, type BeastKind } from '../../model/beasts';
import { ITEMS, type ItemId } from '../../model/loot';
import { FEAT_IDS, FEATS } from '../../model/rogue/feats';

/**
 * タイトル画面: 図鑑(rogue-25)。討伐図鑑・アイテム図鑑・実績を永続メタ(codexStore)
 * から表示するだけの読み取り専用モーダル(hud-help-panel の流儀)。データが空でも
 * ボタンごと出す — 全部「???」の図鑑も収集意欲になる。
 */
export function CodexModal({ onClose }: { onClose: () => void }) {
  const [codex] = useState(() => readCodex()); // 表示中は変わらないので初回だけ読む
  const beastKinds = Object.keys(BEASTS) as BeastKind[];
  const itemIds = Object.keys(ITEMS) as ItemId[];
  return (
    <div className="hud-help" onClick={onClose}>
      <div className="hud-help-panel codex-panel" onClick={(e) => e.stopPropagation()}>
        <h2>図鑑</h2>

        <h3>展示棚</h3>
        <div className="codex-shelf">
          <span className="ambers">🟡×{codex.ambers}</span>
          <span>
            最深生還層 {codex.bestStratumEscape > 0 ? `層${codex.bestStratumEscape}` : '未生還'}
          </span>
        </div>

        <h3>討伐図鑑</h3>
        <div className="codex-grid">
          {beastKinds.map((k) => {
            const rec = codex.beasts[k];
            return (
              <div className="codex-row" key={k}>
                {rec ? (
                  <>
                    <span className="codex-name">{BEASTS[k].name}</span>
                    <span className="codex-stat">
                      討伐{rec.kills} ・ 初討伐深度{rec.firstDepth}
                    </span>
                  </>
                ) : (
                  <span className="codex-name unknown">???</span>
                )}
              </div>
            );
          })}
        </div>

        <h3>アイテム図鑑</h3>
        <div className="codex-grid">
          {itemIds.map((id) => {
            const rec = codex.items[id];
            return (
              <div className="codex-row" key={id}>
                {rec ? (
                  <>
                    <span className="codex-name">{ITEMS[id].name}</span>
                    <span className="codex-stat">
                      入手{rec.found} ・ 最高品質+{rec.bestQ}
                    </span>
                  </>
                ) : (
                  <span className="codex-name unknown">???</span>
                )}
              </div>
            );
          })}
        </div>

        <h3>実績</h3>
        <div className="codex-grid">
          {FEAT_IDS.map((id) => {
            const done = codex.feats.includes(id);
            return (
              <div className={`codex-row codex-feat${done ? '' : ' locked'}`} key={id}>
                <span className="feat-name">{FEATS[id].name}</span>
                <span className="feat-desc">{FEATS[id].desc}</span>
              </div>
            );
          })}
        </div>

        <button className="primary" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}
