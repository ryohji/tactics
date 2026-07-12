// X ポスト(share.ts)のテスト。純関数なので文面と URL 構造を直接検証する。

import { describe, it, expect } from 'vitest';
import { shareText, shareUrl, PLAY_URL, HASHTAGS, type RunResult } from './share';

const result: RunResult = {
  maxDepth: 7,
  kills: 12,
  turn: 87,
  deathCause: 'グール',
  weapon: { item: 'waraxe', q: 1 },
  armor: { item: 'leather', q: 0 },
  seed: 123456789,
};

describe('shareText', () => {
  it('到達深度・死因・討伐/ターン・装備(品質つき)・シードを含む', () => {
    const t = shareText(result);
    expect(t).toContain('深度7');
    expect(t).toContain('グール に倒された');
    expect(t).toContain('討伐12');
    expect(t).toContain('87ターン');
    expect(t).toContain('+1'); // 武器の品質表記
    expect(t).toContain('防具');
    expect(t).toContain('シード 123456789');
  });

  it('ハッシュタグ込みで 120 文字程度に収まる(URL は別枠)', () => {
    // 各値が最長級のケース。
    const worst: RunResult = {
      maxDepth: 99,
      kills: 999,
      turn: 99999,
      deathCause: 'ドレイク',
      weapon: { item: 'waraxe', q: 12 },
      armor: { item: 'plate', q: 12 },
      seed: 2147483647,
    };
    const tags = HASHTAGS.map((h) => `#${h}`).join(' ');
    expect(shareText(worst).length + 1 + tags.length).toBeLessThanOrEqual(120);
  });

  it('死因が無ければ「力尽きた」', () => {
    expect(shareText({ ...result, deathCause: null })).toContain('力尽きた');
  });

  it('未装備は「なし」', () => {
    const t = shareText({ ...result, weapon: null, armor: null });
    expect(t).toContain('武器 なし');
    expect(t).toContain('防具 なし');
  });

  it('脱出(生還)時は死因に関わらず「生還した」になる(rogue-25)', () => {
    const t = shareText({ ...result, escaped: true });
    expect(t).toContain('生還した');
    expect(t).not.toContain('倒された');
  });
});

describe('shareUrl', () => {
  it('intent URL に text / プレイ URL / ハッシュタグが載る', () => {
    const u = new URL(shareUrl(result));
    expect(u.origin + u.pathname).toBe('https://twitter.com/intent/tweet');
    expect(u.searchParams.get('text')).toBe(shareText(result));
    expect(u.searchParams.get('url')).toBe(PLAY_URL);
    expect(u.searchParams.get('hashtags')).toBe('蟻巣迷宮,FCCRogue');
  });
});
