// 保存コーデック(rogue.ts 分割A1)。SaveData の組み立て(encode)と、SaveData から
// 状態片への復元(decode)を純関数として持つ。localStorage への読み書き自体は
// persist.ts、呼び出しは rogue.ts の autoSave/resume が担う。
//
// 挙動の原則: フィールドの順序・内容・バージョン判定(v===7)は rogue.ts に
// 直書きされていた頃と1ビットも変えない(rogue-30でクールダウン一般化(trapCooldown →
// cooldowns.wanaAmi/cooldowns.rengeki)を追加し v10 へ改訂)。

import type { CellKey } from '../../model/fcc';
import { slotKeyOfCell, lcg, type Dungeon } from '../../model/dungeon';
import type {
  LightLevel,
  Beast,
  GroundItem,
  PlacedTrap,
  Turret,
  Decoy,
  PlayerState,
  SaveData,
  SkillDraft,
  ActionLogEntry,
} from '../../model/rogue/types';
import type { NodeId } from '../../model/rogue/mastery';
import type { EquippedSkill } from '../../model/rogue/mastery';

/** encodeSave の入力: ストアの状態片+モジュール値(rng・seqs・actionLog)。 */
export interface EncodeSaveInput {
  seed: number;
  /** 戦闘乱数の内部状態(rng.ts の getRngState())。 */
  rng: number;
  seqs: { beast: number; item: number; device: number };
  dungeon: Dungeon;
  discovered: Set<CellKey>;
  cellChamber: Map<CellKey, number>;
  visitedChambers: Set<number>;
  player: PlayerState;
  lightLevel: LightLevel;
  beasts: Beast[];
  items: GroundItem[];
  traps: PlacedTrap[];
  turrets: Turret[];
  decoys: Decoy[];
  turn: number;
  kills: number;
  maxDepth: number;
  stratum: number;
  skillSlots: number;
  skillEquipped: EquippedSkill[];
  skillDraft: SkillDraft;
  skillFreePick: boolean;
  cooldowns: Partial<Record<NodeId, number>>;
  actionLog: ActionLogEntry[];
  /** ストアの log 全体(末尾8件への切り詰めは encode 側で行う)。 */
  log: string[];
  // relics は player.relics に含まれているため、ここで重複記載しない
}

/** decodeSave の出力: ストアへ set する断片と、モジュール変数へ書き戻す値。 */
export interface DecodedSave {
  seed: number;
  /** 戦闘乱数の内部状態(rng.ts の setRngState() へ)。 */
  rng: number;
  seqs: { beast: number; item: number; device: number };
  /** slots(slotKeyOfCell で再構築)と rng 関数を再付与した実体。 */
  dungeon: Dungeon;
  discovered: Set<CellKey>;
  cellChamber: Map<CellKey, number>;
  visitedChambers: Set<number>;
  player: PlayerState;
  lightLevel: LightLevel;
  beasts: Beast[];
  items: GroundItem[];
  traps: PlacedTrap[];
  turrets: Turret[];
  decoys: Decoy[];
  turn: number;
  kills: number;
  maxDepth: number;
  stratum: number;
  skillSlots: number;
  skillEquipped: EquippedSkill[];
  skillDraft: SkillDraft;
  skillFreePick: boolean;
  cooldowns: Partial<Record<NodeId, number>>;
  actionLog: ActionLogEntry[];
  log: string[];
}

/** ストアの状態片+モジュール値から SaveData スナップショットを組み立てる。 */
export function encodeSave(s: EncodeSaveInput): SaveData {
  return {
    v: 10,
    seed: s.seed,
    rng: s.rng,
    seqs: s.seqs,
    dungeon: {
      open: [...s.dungeon.open],
      chambers: s.dungeon.chambers,
      stubs: s.dungeon.stubs,
      rev: s.dungeon.rev,
      cutLayer: s.dungeon.cutLayer,
    },
    discovered: [...s.discovered],
    cellChamber: [...s.cellChamber],
    visitedChambers: [...s.visitedChambers],
    player: s.player,
    lightLevel: s.lightLevel,
    beasts: s.beasts,
    items: s.items,
    traps: s.traps,
    turrets: s.turrets,
    decoys: s.decoys,
    turn: s.turn,
    kills: s.kills,
    maxDepth: s.maxDepth,
    stratum: s.stratum,
    skillSlots: s.skillSlots,
    skillEquipped: s.skillEquipped.map((e) => [e.id, e.rank]),
    skillDraft: s.skillDraft,
    skillFreePick: s.skillFreePick,
    cooldowns: s.cooldowns,
    actionLog: s.actionLog,
    log: s.log.slice(-8),
  };
}

/**
 * SaveData から状態片を復元する。バージョン不一致(v!==10)は null。
 * Set/Map の再構築・dungeon の slots 再構築(slotKeyOfCell)・rng 関数の
 * 再付与(生成はすべて座標導出 rng なのでこの値は使われない)を担う。
 * v9 からの移行: trapCooldown → cooldowns.wanaAmi。
 */
export function decodeSave(d: SaveData): DecodedSave | null {
  if (d.v !== 10) return null;
  const dungeon: Dungeon = {
    open: new Set(d.dungeon.open),
    chambers: d.dungeon.chambers,
    stubs: d.dungeon.stubs,
    slots: new Map(d.dungeon.chambers.map((c) => [slotKeyOfCell(c.center), c.id])),
    seed: d.seed,
    rng: lcg(d.seed), // 生成はすべて座標導出 rng なのでこの値は使われない
    rev: d.dungeon.rev,
    cutLayer: d.dungeon.cutLayer,
  };
  return {
    seed: d.seed,
    rng: d.rng,
    seqs: d.seqs,
    dungeon,
    discovered: new Set(d.discovered),
    cellChamber: new Map(d.cellChamber),
    visitedChambers: new Set(d.visitedChambers),
    player: d.player,
    lightLevel: d.lightLevel,
    beasts: d.beasts,
    items: d.items,
    traps: d.traps,
    turrets: d.turrets,
    decoys: d.decoys,
    turn: d.turn,
    kills: d.kills,
    maxDepth: d.maxDepth,
    stratum: d.stratum,
    skillSlots: d.skillSlots,
    skillEquipped: d.skillEquipped.map(([id, rank]) => ({ id, rank })),
    skillDraft: d.skillDraft,
    skillFreePick: d.skillFreePick,
    cooldowns: d.cooldowns,
    actionLog: d.actionLog,
    log: d.log,
  };
}
