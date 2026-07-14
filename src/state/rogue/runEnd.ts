// ラン終了系オーケストレーション(rogue.ts 分割A5)。checkDead(死亡判定)・
// recordRun(ローカルスコアボードへの記録)・escape アクション(脱出=生還)をまとめて
// 切り出す。A2〜A4 と同じく zustand ストアは1つのまま(state/rogue.ts の useRogue)。
// 関数本文は rogue.ts に直書きされていた頃と1文字も変えていない — 参照だけ
// deps/戻り値経由に置き換えてある。
//
// checkDead は state/rogue/combatActions.ts(戦闘ダメージの直後)と
// state/rogue/stratum.ts(endTurn の毒 DoT)の両方から呼ばれるため、ここの戻り値
// (checkDead 本体)を deps 経由で渡す。recordRun も同じく stratum.ts の endTurn
// (死亡直後に1度だけ)から呼ばれるため deps 経由で公開する。
// stratum.ts → runEnd.ts への一方向の依存になる(runEnd.ts は stratum 側の関数を
// 呼ばない)ので、rogue.ts では runEnd を先に作ってから stratum へ渡す。

import type { StoreApi } from 'zustand';
import type { RogueState } from '../rogue';
import * as persist from '../persist';
import * as history from '../history';
import * as codexStore from '../codexStore';
import * as scoreboard from '../scoreboard';
import * as bgm from '../../audio/bgm';
import type { SfxName } from '../../audio/sfx';
import { GAME_VERSION, STRATUM_DEPTH } from '../../model/rogue/types';
import { depthOf, isoDate, dailySeed } from '../../model/rogue/rules';

export interface RunEndDeps {
  set: StoreApi<RogueState>['setState'];
  get: StoreApi<RogueState>['getState'];
  pushLog(msg: string): void;
  /** 状態を変えるアクションの入口で呼ぶ(将来の再生器 rogue-26 向けの記録のみ)。 */
  logAction(code: string, ...args: (number | string)[]): void;
  sfx: { play(name: SfxName): void };
}

export function createRunEnd(deps: RunEndDeps) {
  const { set, get, pushLog, logAction, sfx } = deps;

  /**
   * ローカルスコアボード(rogue-20)へ今回のランを記録する。自己ベスト更新ならログを出す。
   * 死亡時は endTurn の末尾(ターン数が確定した後)から呼ぶ
   * — checkDead は beastsTurn の途中(endTurn の turn++ より前)で走るため、
   * ここで直接呼ぶと死亡画面に表示される turn 数と1つずれる。
   * escaped=true(rogue-25): 脱出(生還)での終了。deathCause の代わりに '生還' を記録する。
   */
  function recordRun(escaped: boolean): void {
    const s = get();
    const prevBest = history.readHistory().reduce((max, r) => Math.max(max, r.maxDepth), 0);
    history.appendRun({
      v: GAME_VERSION,
      seed: s.seed,
      date: isoDate(new Date()),
      turns: s.turn,
      kills: s.kills,
      maxDepth: s.maxDepth,
      stratum: s.stratum,
      deathCause: escaped ? '生還' : (s.deathCause ?? '不明'),
      daily: s.seed === dailySeed(new Date()),
      skills: s.skillEquipped,
      escaped,
    });
    if (s.maxDepth > prevBest) pushLog('自己ベスト更新!');
    // 共有スコアボード(rogue-26): 死亡/生還の確定送信。fire-and-forget(await しない)。
    // URL 未設定(VITE_SCOREBOARD_URL 空)なら submitRun 内で即 return する no-op。
    void scoreboard.submitRun(
      scoreboard.buildRunPayload(
        {
          seed: s.seed,
          turn: s.turn,
          kills: s.kills,
          maxDepth: s.maxDepth,
          stratum: s.stratum,
          deathCause: s.deathCause,
          skillEquipped: s.skillEquipped,
        },
        {
          runId: scoreboard.getRunId(),
          name: scoreboard.readPlayerName(),
          escaped,
          dead: !escaped,
        },
      ),
    );
  }

  function checkDead(): boolean {
    const { player } = get();
    if (player.hp > 0) return false;
    set({ phase: 'dead', busy: false, reach: { cells: [], parent: new Map() } });
    persist.clearSave(); // ローグライクの掟: 死んだ冒険は再開できない
    bgm.setBgmScene('dead');
    sfx.play('defeat');
    pushLog('力尽きた…');
    return true;
  }

  const actions = {
    escape: () => {
      logAction('ESC');
      const s = get();
      if (s.phase !== 'play' || s.busy) return;
      const depth = depthOf(s.player.pos);
      const warnAt = STRATUM_DEPTH * (s.stratum + 1);
      if (depth < warnAt || depth >= warnAt + 2) return; // 警告帯限定(HUD のボタンも同条件)
      const amberCount = s.player.pack.filter((it) => it.item === 'amber').length;
      codexStore.recordEscape(amberCount, s.stratum + 1); // 展示棚: 琥珀加算・最深生還層更新
      set({ phase: 'escaped', busy: false, reach: { cells: [], parent: new Map() } });
      persist.clearSave(); // dead と同じく、ローグライクの掟: 終えた冒険は再開できない
      bgm.setBgmScene('dead');
      sfx.play('heal');
      pushLog(`地表へ生還した。琥珀${amberCount}個が展示棚に加わった。`);
      recordRun(true);
    },
  };

  return { checkDead, recordRun, actions };
}
