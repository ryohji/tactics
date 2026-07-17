// 保存コーデック(分割A1)の単体テスト。encode→decode の往復等価・v 不一致で
// null・dungeon.slots の再構築を見る。既存の resume 系テスト(rogue.test.ts)は
// ストア経由の統合検証で、こちらは純関数の仕様を直接押さえる。

import { describe, it, expect } from 'vitest';
import { createDungeon, slotKeyOfCell } from '../../model/dungeon';
import { cellKey } from '../../model/fcc';
import type { SaveData } from '../../model/rogue/types';
import { encodeSave, decodeSave, type EncodeSaveInput } from './saveCodec';

/** 実物のダンジョンを使った encode 入力のひな型(値はテスト用の適当な断面)。 */
function sampleInput(): EncodeSaveInput {
  const dungeon = createDungeon(42);
  const entrance = dungeon.chambers[0];
  const cells = [...entrance.cells];
  return {
    seed: 42,
    rng: 0xdeadbeef,
    seqs: { beast: 5, item: 7, device: 3 },
    dungeon,
    discovered: new Set(cells.slice(0, 4)),
    cellChamber: new Map(cells.map((k) => [k, entrance.id])),
    visitedChambers: new Set([entrance.id]),
    player: {
      pos: [0, 0, 0],
      hp: 20,
      maxHp: 24,
      weapon: { item: 'dagger', q: 1 },
      armor: null,
      shield: null,
      barrier: 2,
      status: { kind: 'poison', turns: 3 },
      immune: 0,
      pack: [{ item: 'potion', q: 0 }, { item: 'knife', q: 2 }],
    },
    lightLevel: 2,
    beasts: [
      {
        id: 1,
        kind: 'rat',
        pos: [2, 0, 0],
        hp: 6,
        home: [2, 0, 0],
        homeChamber: 0,
        layerFloor: 0,
        layerCeil: -8,
        awake: true,
        alive: true,
        status: { kind: 'burn', turns: 1 },
        carry: { item: 'potion', q: 1 },
      },
    ],
    items: [{ id: 2, stack: { item: 'amber', q: 0 }, pos: [1, 1, 0] }],
    traps: [{ id: 1, pos: [0, 1, 1], power: 10 }],
    turrets: [{ id: 2, q: 1, pos: [1, 0, 1], turns: 4 }],
    decoys: [{ id: 3, q: 0, pos: [2, 1, 1], hp: 3, maxHp: 5 }],
    turn: 123,
    kills: 9,
    maxDepth: 11,
    stratum: 1,
    skillSlots: 3,
    skillEquipped: [{ id: 'kouka', rank: 2 }],
    skillDraft: null,
    skillFreePick: false,
    trapCooldown: 0,
    actionLog: [[1, 'C', 0, 0, 0], [2, 'W']],
    log: ['a', 'b', 'c'],
  };
}

describe('saveCodec(保存コーデックの純関数)', () => {
  it('encode→decode の往復で状態片が等価に戻る', () => {
    const input = sampleInput();
    const d = decodeSave(encodeSave(input));
    expect(d).not.toBeNull();
    const dec = d!;
    // モジュール値。
    expect(dec.seed).toBe(input.seed);
    expect(dec.rng).toBe(input.rng);
    expect(dec.seqs).toEqual(input.seqs);
    expect(dec.actionLog).toEqual(input.actionLog);
    // Set/Map は配列化→再構築でも中身が等しい。
    expect(dec.discovered).toEqual(input.discovered);
    expect(dec.cellChamber).toEqual(input.cellChamber);
    expect(dec.visitedChambers).toEqual(input.visitedChambers);
    // dungeon: open(Set)・chambers・stubs・rev・cutLayer が保存/復元で保たれる。
    expect(dec.dungeon.open).toEqual(input.dungeon.open);
    expect(dec.dungeon.chambers).toEqual(input.dungeon.chambers);
    expect(dec.dungeon.stubs).toEqual(input.dungeon.stubs);
    expect(dec.dungeon.rev).toBe(input.dungeon.rev);
    expect(dec.dungeon.cutLayer).toBe(input.dungeon.cutLayer);
    expect(dec.dungeon.seed).toBe(input.seed);
    expect(typeof dec.dungeon.rng).toBe('function'); // rng 関数の再付与
    // 実体の配列・プレイヤー・スカラー値。
    expect(dec.player).toEqual(input.player);
    expect(dec.beasts).toEqual(input.beasts);
    expect(dec.items).toEqual(input.items);
    expect(dec.traps).toEqual(input.traps);
    expect(dec.turrets).toEqual(input.turrets);
    expect(dec.decoys).toEqual(input.decoys);
    expect(dec.turn).toBe(input.turn);
    expect(dec.kills).toBe(input.kills);
    expect(dec.maxDepth).toBe(input.maxDepth);
    expect(dec.stratum).toBe(input.stratum);
    expect(dec.skillSlots).toBe(input.skillSlots);
    expect(dec.skillEquipped).toEqual(input.skillEquipped);
    expect(dec.skillDraft).toEqual(input.skillDraft);
    expect(dec.skillFreePick).toBe(input.skillFreePick);
    expect(dec.trapCooldown).toBe(input.trapCooldown);
    expect(dec.log).toEqual(input.log);
  });

  it('rogue-28: アイテム個数(n)も往復する', () => {
    const input = sampleInput();
    input.player.pack = [
      { item: 'potion', q: 0, n: 3 },
      { item: 'knife', q: 0, n: 2 },
    ];
    const dec = decodeSave(encodeSave(input))!;
    expect(dec.player.pack).toEqual(input.player.pack);
  });

  it('rogue-27: ランク付きスキル(EquippedSkill)・見送り権(freeドラフト)・罠クールダウンも往復する', () => {
    const input = sampleInput();
    input.skillEquipped = [
      { id: 'kensan', rank: 3 },
      { id: 'wanaAmi', rank: 1 },
    ];
    input.skillDraft = 'free';
    input.skillFreePick = true;
    input.trapCooldown = 6;
    const dec = decodeSave(encodeSave(input))!;
    expect(dec.skillEquipped).toEqual(input.skillEquipped);
    expect(dec.skillDraft).toBe('free');
    expect(dec.skillFreePick).toBe(true);
    expect(dec.trapCooldown).toBe(6);
  });

  it('JSON 化(localStorage 相当)を挟んでも往復できる', () => {
    const input = sampleInput();
    const persisted = JSON.parse(JSON.stringify(encodeSave(input))) as SaveData;
    const dec = decodeSave(persisted);
    expect(dec).not.toBeNull();
    expect(dec!.discovered).toEqual(input.discovered);
    expect(dec!.player).toEqual(input.player);
    expect(dec!.dungeon.open).toEqual(input.dungeon.open);
  });

  it('encode は log を末尾8件に切り詰める', () => {
    const input = sampleInput();
    input.log = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    expect(encodeSave(input).log).toEqual(['3', '4', '5', '6', '7', '8', '9', '10']);
  });

  it('バージョン不一致(v!==8)は null', () => {
    const data = encodeSave(sampleInput());
    expect(decodeSave({ ...data, v: 7 as unknown as 8 })).toBeNull();
  });

  it('decode は dungeon.slots を chambers の center から再構築する', () => {
    const input = sampleInput();
    const dec = decodeSave(encodeSave(input))!;
    expect(dec.dungeon.slots.size).toBe(dec.dungeon.chambers.length);
    for (const c of dec.dungeon.chambers) {
      expect(dec.dungeon.slots.get(slotKeyOfCell(c.center))).toBe(c.id);
    }
    // 元の dungeon の slots と同内容(実体化済みスロットの取り違えがない)。
    expect(dec.dungeon.slots).toEqual(input.dungeon.slots);
  });

  it('encode の discovered/cellChamber は配列化されている(JSON 安全)', () => {
    const input = sampleInput();
    const data = encodeSave(input);
    expect(Array.isArray(data.discovered)).toBe(true);
    expect(Array.isArray(data.cellChamber)).toBe(true);
    expect(new Set(data.discovered)).toEqual(input.discovered);
    expect(new Map(data.cellChamber)).toEqual(input.cellChamber);
    // open も同様に配列。
    expect(Array.isArray(data.dungeon.open)).toBe(true);
    expect(data.dungeon.open).toContain(cellKey([0, 0, 0]));
  });
});
