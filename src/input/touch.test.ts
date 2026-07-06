// タッチ2段階タップの判定ロジック(rogue-10)。

import { describe, it, expect, afterEach } from 'vitest';
import { tapAction, setTouchInputForTest } from './touch';
import { useRogue } from '../state/rogue';

afterEach(() => setTouchInputForTest(false));

describe('tapAction(2段階タップ)', () => {
  it('マウス操作は常に即実行', () => {
    setTouchInputForTest(false);
    expect(tapAction(null, 'cell:0,0,0')).toBe('execute');
    expect(tapAction('cell:1,1,0', 'cell:0,0,0')).toBe('execute');
  });

  it('タッチは 未選択→選択、同一対象の再タップ→実行、別対象→選択し直し', () => {
    setTouchInputForTest(true);
    expect(tapAction(null, 'beast:1')).toBe('arm');
    expect(tapAction('beast:1', 'beast:1')).toBe('execute');
    expect(tapAction('beast:1', 'beast:2')).toBe('arm');
    expect(tapAction('cell:0,0,0', 'bubble:i1')).toBe('arm');
  });
});

describe('armedKey(選択状態)の解除', () => {
  it('ターン進行(refreshReach)とマップ切替で選択が解ける', () => {
    useRogue.getState().restart(7);
    useRogue.getState().setArmed('cell:0,0,0');
    expect(useRogue.getState().armedKey).toBe('cell:0,0,0');
    useRogue.getState().wait(); // 1ターン → refreshReach
    expect(useRogue.getState().armedKey).toBeNull();
    useRogue.getState().setArmed('beast:1');
    useRogue.getState().toggleMap();
    expect(useRogue.getState().armedKey).toBeNull();
    useRogue.getState().toggleMap();
  });
});
