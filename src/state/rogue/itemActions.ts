// アイテム操作アクション(rogue-29: dropItem・crushRelic)。
// 他の分割ファイル(A2〜A5)と同じく zustand ストアは1つのまま(state/rogue.ts の useRogue)。
// dropItem(ターン消費なし) と crushRelic(1ターン消費) を公開する。

import type { StoreApi } from 'zustand';
import type { RogueState } from '../rogue';
import type { SfxName } from '../../audio/sfx';
import { itemLabel } from '../../model/loot';
import type { RogueFx } from '../../model/rogue/types';

export interface ItemActionsDeps {
  set: StoreApi<RogueState>['setState'];
  get: StoreApi<RogueState>['getState'];
  pushLog(msg: string): void;
  pushFx(e: Omit<RogueFx, 'id' | 'start'>): void;
  logAction(code: string, ...args: (number | string)[]): void;
  sfx: { play(name: SfxName): void };
  nextItemSeq(): number;
  combat: { beastsTurn(): boolean };
  endTurn(): void;
  settleAfterAction(): void;
}

export function createItemActions(deps: ItemActionsDeps) {
  const { set, get, pushLog, pushFx, logAction, sfx, nextItemSeq, combat, endTurn, settleAfterAction } = deps;

  const actions = {
    /**
     * 捨てる(rogue-29): pack[index] をプレイヤー足元に GroundItem として置く。
     * ターン消費なし。装備替えと同じ流儀。
     */
    dropItem: (index: number) => {
      logAction('D', index);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      const stack = s.player.pack[index];
      if (!stack) return;

      const player = s.player;
      const items = get().items;
      const label = itemLabel(stack);

      // pack から削除。
      player.pack.splice(index, 1);

      // 足元に GroundItem として置く。
      items.push({
        id: nextItemSeq(),
        stack,
        pos: player.pos,
      });

      pushFx({ kind: 'popup', at: player.pos, text: label, color: '#fbbf24', dur: 700 });
      pushLog(`${label} を足元に置いた`);
      sfx.play('cancel');

      set({ player: { ...player, pack: [...player.pack] }, items: [...items] });
    },

    /**
     * 砕く(rogue-29): relics[index] を消費して全回復+状態異常を治す。
     * 1ターン消費。
     */
    crushRelic: (index: number) => {
      logAction('CR', index);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      const stack = s.player.relics[index];
      if (!stack) return;

      const player = s.player;

      // 全回復。
      const oldHp = player.hp;
      player.hp = player.maxHp;

      // 状態異常を治す。
      if (player.status) {
        const status = player.status.kind;
        player.status = null;
        const statusName = status === 'poison' ? '毒' : '混乱';
        pushLog(`${statusName}が治まった`);
      }

      // relics から除去。
      player.relics.splice(index, 1);

      const healed = player.maxHp - oldHp;
      pushFx({ kind: 'heal', at: player.pos, dur: 700 });
      pushFx({ kind: 'popup', at: player.pos, text: `+${healed}`, color: '#86efac', dur: 900 });
      pushLog('琥珀を砕いた — 巣の記憶が傷を癒やす');
      sfx.play('heal');

      set({ player: { ...player, relics: [...player.relics] } });

      // 1ターン消費。
      combat.beastsTurn();
      endTurn();
      settleAfterAction();
    },

    /**
     * 捧げる(rogue-32): relics[index] を消費して心得を組み替え可能にする。
     * 1ターン消費してから支度パネルを開く。
     */
    dedicateRelic: (index: number) => {
      logAction('DR', index);
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      const stack = s.player.relics[index];
      if (!stack) return;

      const player = s.player;

      // relics から除去。
      player.relics.splice(index, 1);

      pushLog('琥珀を捧げた — 巣の記憶が心得を解きほぐす');
      sfx.play('heal');

      set({ player: { ...player, relics: [...player.relics] } });

      // 1ターン消費を先に済ませてからパネルを開く。
      combat.beastsTurn();
      endTurn();

      // 支度パネルを開く(装着/解除が自由になる既存機構)。
      set({ skillOutfitting: true });

      settleAfterAction();
    },
  };

  return { actions };
}
