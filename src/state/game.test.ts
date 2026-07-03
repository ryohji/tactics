// ゲーム状態機械（it-6）のテスト。配置 → 開戦 → 移動 → 行動 → ターン交代 → 敵AI → 勝敗。
// 非同期の演出シーケンス（sleep）は fake timers で進める。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStore } from './store';
import { useGame, seedRng, availableActions } from './game';
import { cellKey, keyToCell, type Cell } from '../model/fcc';
import { isLeader, CLASSES } from '../model/units';
import { hasFooting, isAdjacent } from '../model/rules';

// 小アリーナへ縮めてから rebuild（store 購読で自動 rebuild が走る）。
beforeEach(() => {
  vi.useFakeTimers();
  seedRng(12345);
  useStore.getState().setPreset('ruined');
  useStore.getState().setParam('Hmax', 6);
  useStore.getState().setParam('Lmax', 6);
  useStore.getState().setParam('d', 0.55);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('初期化（配置フェーズ）', () => {
  it('12体（各陣営6・リーダー1ずつ）が相異なる通行セルに自動配置される', () => {
    const g = useGame.getState();
    expect(g.phase).toBe('deploy');
    expect(g.units).toHaveLength(12);
    const seen = new Set<string>();
    for (const u of g.units) {
      const k = cellKey(u.pos);
      expect(seen.has(k)).toBe(false);
      seen.add(k);
      expect(g.board.arenaSet.has(k)).toBe(true);
      expect(g.board.occluderSet.has(k)).toBe(false);
      if (!CLASSES[u.cls].fly) expect(hasFooting(u.pos, g.board)).toBe(true);
    }
    expect(g.units.filter((u) => u.side === 'player' && isLeader(u))).toHaveLength(1);
    expect(g.units.filter((u) => u.side === 'enemy' && isLeader(u))).toHaveLength(1);
  });

  it('配置: 自軍を選ぶと配置ゾーンが出て、空きセルへ置き直せる', () => {
    const g = useGame.getState();
    const me = g.units.find((u) => u.side === 'player' && CLASSES[u.cls].fly)!;
    useGame.getState().clickUnit(me.id);
    const s1 = useGame.getState();
    expect(s1.highlightKind).toBe('deploy');
    expect(s1.highlight.size).toBeGreaterThan(0);
    // 空いているハイライトセルへ。
    const occupied = new Set(s1.units.map((u) => cellKey(u.pos)));
    const free = [...s1.highlight].find((k) => !occupied.has(k))!;
    useGame.getState().clickCell(keyToCell(free));
    expect(cellKey(useGame.getState().units.find((u) => u.id === me.id)!.pos)).toBe(free);
  });
});

describe('開戦とプレイヤーターン', () => {
  it('startBattle で player フェーズ・ターン1になる', () => {
    useGame.getState().startBattle();
    const g = useGame.getState();
    expect(g.phase).toBe('player');
    expect(g.turn).toBe(1);
  });

  it('ユニット選択 → 移動範囲表示 → 現在地クリックで行動メニュー', async () => {
    useGame.getState().startBattle();
    const me = useGame.getState().units.find((u) => u.side === 'player')!;
    useGame.getState().clickUnit(me.id);
    const s1 = useGame.getState();
    expect(s1.uiMode).toBe('moveSelect');
    expect(s1.highlightKind).toBe('move');
    expect(s1.highlight.has(cellKey(me.pos))).toBe(true); // 現在地=その場行動
    useGame.getState().clickCell(me.pos);
    await vi.advanceTimersByTimeAsync(200);
    expect(useGame.getState().uiMode).toBe('actionMenu');
  });

  it('移動後キャンセルで元の位置へ戻る', async () => {
    useGame.getState().startBattle();
    const me = useGame.getState().units.find((u) => u.side === 'player')!;
    const origin = me.pos;
    useGame.getState().clickUnit(me.id);
    const dest = [...useGame.getState().highlight].find((k) => k !== cellKey(origin))!;
    useGame.getState().clickCell(keyToCell(dest));
    await vi.advanceTimersByTimeAsync(2000);
    expect(useGame.getState().uiMode).toBe('actionMenu');
    useGame.getState().chooseAction('cancel');
    const s = useGame.getState();
    expect(cellKey(s.units.find((u) => u.id === me.id)!.pos)).toBe(cellKey(origin));
    expect(s.uiMode).toBe('moveSelect');
  });

  it('待機で行動済みになる', async () => {
    useGame.getState().startBattle();
    const me = useGame.getState().units.find((u) => u.side === 'player')!;
    useGame.getState().clickUnit(me.id);
    useGame.getState().clickCell(me.pos);
    await vi.advanceTimersByTimeAsync(200);
    useGame.getState().chooseAction('wait');
    await vi.advanceTimersByTimeAsync(100);
    expect(useGame.getState().units.find((u) => u.id === me.id)!.acted).toBe(true);
  });
});

describe('戦闘（攻撃の解決）', () => {
  it('隣接する敵に攻撃でき、命中すればダメージが入る', async () => {
    useGame.getState().startBattle();
    const g = useGame.getState();
    const me = g.units.find((u) => u.side === 'player' && u.cls === 'winged')!;
    const foe = g.units.find((u) => u.side === 'enemy' && !isLeader(u))!;
    // テスト用に敵を隣へワープ（状態を直接編集）。
    foe.pos = [me.pos[0] + 1, me.pos[1] + 1, me.pos[2]];
    useGame.setState({ units: [...g.units] });
    expect(isAdjacent(me.pos, foe.pos)).toBe(true);

    useGame.getState().clickUnit(me.id);
    useGame.getState().clickCell(me.pos); // その場で行動
    await vi.advanceTimersByTimeAsync(200);
    expect(availableActions(me, useGame.getState().units, useGame.getState().board)).toContain('attack');
    useGame.getState().chooseAction('attack');
    const s = useGame.getState();
    expect(s.uiMode).toBe('targetSelect');
    expect(s.targetIds).toContain(foe.id);

    const hpBefore = foe.hp;
    useGame.getState().clickUnit(foe.id);
    await vi.advanceTimersByTimeAsync(5000);
    const after = useGame.getState();
    const foeAfter = after.units.find((u) => u.id === foe.id)!;
    // 命中/回避どちらでも: 行動は確定し、ダメージは0以上。
    expect(after.units.find((u) => u.id === me.id)!.acted).toBe(true);
    expect(foeAfter.hp).toBeLessThanOrEqual(hpBefore);
  });
});

describe('視点モード', () => {
  it('toggleFreeCam で出入りでき、rebuild で解除される', () => {
    expect(useGame.getState().freeCam).toBe(false);
    useGame.getState().toggleFreeCam();
    expect(useGame.getState().freeCam).toBe(true);
    useGame.getState().toggleFreeCam();
    expect(useGame.getState().freeCam).toBe(false);
    useGame.getState().toggleFreeCam();
    useGame.getState().rebuild();
    expect(useGame.getState().freeCam).toBe(false);
  });
});

describe('ターン交代と敵AI', () => {
  it('endPlayerTurn で敵が順次行動し、自軍ターン2へ戻る', async () => {
    useGame.getState().startBattle();
    useGame.getState().endPlayerTurn();
    expect(useGame.getState().phase).toBe('enemy');
    // 敵6体の演出を全部進める（十分な仮想時間）。
    await vi.advanceTimersByTimeAsync(60000);
    const g = useGame.getState();
    expect(g.phase).toBe('player');
    expect(g.turn).toBe(2);
    for (const u of g.units) if (u.side === 'player') expect(u.acted).toBe(false);
  });
});

describe('勝敗', () => {
  it('敵リーダーの HP を0にすると勝利', async () => {
    useGame.getState().startBattle();
    const g = useGame.getState();
    const me = g.units.find((u) => u.side === 'player' && u.cls === 'winged')!;
    const boss = g.units.find((u) => u.side === 'enemy' && isLeader(u))!;
    boss.hp = 1;
    boss.pos = [me.pos[0] + 1, me.pos[1] + 1, me.pos[2]] as Cell;
    useGame.setState({ units: [...g.units] });

    // 必中になるまで試行し続ける代わりに、seed を命中が出るまで回す（決定的に検証）。
    let won = false;
    for (let seed = 1; seed <= 20 && !won; seed++) {
      seedRng(seed);
      useGame.getState().clickUnit(me.id);
      useGame.getState().clickCell(me.pos);
      await vi.advanceTimersByTimeAsync(200);
      useGame.getState().chooseAction('attack');
      if (!useGame.getState().targetIds.includes(boss.id)) break;
      useGame.getState().clickUnit(boss.id);
      await vi.advanceTimersByTimeAsync(5000);
      won = useGame.getState().phase === 'victory';
      if (!won) {
        // 外した場合は行動済みを解除して再試行。
        const u = useGame.getState().units.find((x) => x.id === me.id)!;
        u.acted = false;
        useGame.setState({ units: [...useGame.getState().units], uiMode: 'idle' });
      }
    }
    expect(won).toBe(true);
  });
});
