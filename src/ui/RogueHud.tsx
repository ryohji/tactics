// rogue の DOM オーバーレイ HUD。
//   左上: HP バー(数字重ね)
//   右上: システム(明かり/視点リセット/演出/音/最初から/ヘルプ)
//   右中: 所持品(開閉式。最上段に装備枠 — 攻/防はここに表示)
//   左下: ホバー中の敵情報
//   下中央: よく使う操作(マップ・フォーカス巡回・待機)+ 深度/討伐/ターン
//   右下: ログ / 死亡: スコアオーバーレイ

import { useState } from 'react';
import { HpPanel } from './panels/HpPanel';
import { SystemButtons } from './panels/SystemButtons';
import { PackPanel } from './panels/PackPanel';
import { BeastPanel } from './panels/BeastPanel';
import { BottomBar } from './panels/BottomBar';
import { LogPanel } from './panels/LogPanel';
import { SkillModal } from './modals/SkillModal';
import { EscapeConfirmModal } from './modals/EscapeConfirmModal';
import { HelpOverlay } from './modals/HelpOverlay';
import { DeadOverlay } from './modals/DeadOverlay';
import './hud.css';

export function RogueHud() {
  const [help, setHelp] = useState(false);
  const [escapeConfirm, setEscapeConfirm] = useState(false);
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
        <BottomBar onEscapeClick={() => setEscapeConfirm(true)} />
      </div>
      <DeadOverlay />
      <SkillModal />
      {escapeConfirm && <EscapeConfirmModal onClose={() => setEscapeConfirm(false)} />}
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
    </div>
  );
}
