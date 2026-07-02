// 大聖堂ブループリント層（it-5）。
// 「身廊の長さ/幅/高さ・側廊・クリアストーリー・ベイ数・後陣」という意味のあるパラメータと、
// 「崩落破断・瓦礫の山・倒れ柱・折れ柱・屋根の抜けたベイ」という部品リストから、
// terrain.ts の SDF プリミティブを組み合わせて廃墟大聖堂の距離場を構築する。
//
// 不変条件（DESIGN / DECISIONS）: 出力は Terrain（sdf + mesh）。分類(classify)も描画(Terrain.tsx)も
// この同一 sdf を唯一のソースにするため、見た目と移動可否は原理的に一致する。
//
// 設計思想: バシリカ断面（高く細い身廊 + 低い側廊 + 間のクリアストーリー）で垂直性を出し、
// 壁を列柱アーケード（連続するアーチ開口）で抜いて「見通せる」聖堂にする。その上で
// 大きな崩落破断・屋根の抜け・瓦礫を最優先で効かせ、「外から侵入できる廃墟」にする。
// 飛行前提なので室内外の空気はすべて通行可能、地形は実体 occluder としてのみ効く。
//
// 座標は (a,u,b) フレーム（a=身廊長手 / u=鉛直 / b=身廊幅, S=1 正規直交）。床上面 u=1。

import {
  type Terrain,
  type TerrainMesh,
  type Vec3,
  type FrameBounds,
  toFrame,
  sdSphere,
  sdBox,
  sdCappedCylinder,
  sdBoxOriented,
  smoothUnion,
  subtract,
  rotateAxisAngle,
  tiltedBasis,
  marchingCubes,
  UP,
  A_AXIS,
  DEG,
} from './terrain';

type Fr = readonly [number, number, number];
const B_AXIS: Vec3 = [0, 0, 1]; // 水平 b 軸（身廊の幅方向）

/** 崩落破断の1つ。中心領域を不規則な塊群でくり抜き、ギザギザの大欠損を作る。 */
export interface Breach {
  /** 欠損の中心 [a,u,b]。 */
  c: Vec3;
  /** 欠損の半径(半長) [a,u,b]。この箱を埋める不規則な塊群で subtract する。 */
  he: Vec3;
  /** 不規則塊の個数（多いほどギザギザ）。 */
  chunks: number;
  /** 乱数シード（再現可能）。 */
  seed: number;
}

/** 瓦礫の山。床に積もる塊群を smoothUnion でなじませる。飛行ユニットが留まれる足場。 */
export interface RubblePile {
  /** 山の中心 [a,u,b]。 */
  c: Vec3;
  /** 山の広がり半径（水平）。 */
  spread: number;
  /** 山の高さ。 */
  height: number;
  /** 塊数。 */
  rocks: number;
  seed: number;
}

/** 倒れ柱（床に寝た円柱）。 */
export interface FallenColumn {
  c: Vec3;
  /** 寝かせる方向の単位軸。 */
  axis: Vec3;
  half: number;
  r: number;
}

/** 大聖堂ブループリント（意味のあるパラメータ + 廃墟部品）。 */
export interface CathedralSpec {
  // --- 平面・断面（バシリカの寸法）---
  naveHalfLen: number; // a: 身廊の半長（柱列が並ぶ範囲）
  naveHalfWidth: number; // b: 身廊の半幅（アーケード柱の位置）
  aisleHalfWidth: number; // b: 側廊外壁の位置（> naveHalfWidth）
  floorTop: number; // u: 床上面
  aisleWallTop: number; // u: 側廊外壁の高さ
  arcadeSpring: number; // u: アーケードのアーチ起拱
  clerestoryTop: number; // u: クリアストーリー壁頂（= ヴォールト起拱）
  vaultCrownExtra: number; // ヴォールト頂の追加高（crown = clerestoryTop + naveHalfWidth*この係数）
  wallThick: number; // 壁の半厚
  pillarR: number; // 柱半径
  bays: number; // アーケードの柱間数（柱は bays+1 本/側）
  aisles: boolean; // 側廊を持つ（バシリカ断面）。false なら単一大空間（システィーナ型）
  apse: boolean; // 東端の後陣（半円アプス）
  westFacade: boolean; // 西端の正面壁（大扉つき）

  // --- 廃墟部品（開放性の主役）---
  breaches: Breach[];
  rubble: RubblePile[];
  fallen: FallenColumn[];
  /** 折れて低くなった柱の (side, index)。side: +1=+b 列, -1=-b 列。index は 0..bays。 */
  brokenPillars: ReadonlyArray<{ side: 1 | -1; index: number; keep: number }>;
  /** 屋根（ヴォールト）が抜けた a 区間 [aMin,aMax] のリスト。空が覗く。 */
  roofGaps: ReadonlyArray<readonly [number, number]>;
  /** 瓦礫を床へなじませる smoothUnion の k。 */
  smoothK: number;
}

/** 決定的な小さな乱数（LCG）。同じ seed なら同じ崩落形状＝再現可能。 */
function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** 丸天井アーチ型の開口カッター（矩形 + 半円の頭）。壁から subtract して列柱アーチや窓を抜く。 */
function archOpening(fr: Fr, a: number, b: number, halfW: number, sill: number, spring: number, depthHalf: number): number {
  const box = sdBox(fr, [a, (sill + spring) / 2, b], [halfW, (spring - sill) / 2, depthHalf]);
  const head = sdCappedCylinder(fr, [a, spring, b], B_AXIS, depthHalf, halfW);
  return Math.min(box, head); // 矩形 ∪ 半円頭 = 丸アーチ開口
}

// breach / rubble は seed つき乱数＋三角関数でチャンク位置を決める。これを毎 sdf 評価で
// 走らせると壮大スケール（数万セル）の occluder 判定が秒オーダで重くなる。チャンクは seed で
// 決定的なので、spec ごとに **1度だけ前計算**してフラットなプリミティブ配列にし、field は
// 前計算済みの球/箱への距離だけを評価する（ホットループから rng と trig を排除）。

interface SpherePrim { c: Vec3; r: number; }
interface OBoxPrim { c: Vec3; he: Vec3; basis: [Vec3, Vec3, Vec3]; }
interface BreachPrecomp { spheres: SpherePrim[]; boxes: OBoxPrim[]; coreC: Vec3; coreHe: Vec3; }

/** breach の不規則チャンク群を前計算（rng/trig はここで1度だけ）。 */
function precomputeBreach(br: Breach): BreachPrecomp {
  const r = rng(br.seed);
  const spheres: SpherePrim[] = [];
  const boxes: OBoxPrim[] = [];
  for (let i = 0; i < br.chunks; i++) {
    const c: Vec3 = [
      br.c[0] + (r() * 2 - 1) * br.he[0],
      br.c[1] + (r() * 2 - 1) * br.he[1],
      br.c[2] + (r() * 2 - 1) * br.he[2],
    ];
    const rad = 0.5 + r() * 0.9; // 塊サイズのばらつき
    if (r() < 0.5) spheres.push({ c, r: rad });
    else boxes.push({ c, he: [rad, rad * (0.6 + r()), rad], basis: tiltedBasis(UP, r() * Math.PI) });
  }
  // 中心コアは確実に抜く（破断が小さくなりすぎない保険）。
  return { spheres, boxes, coreC: br.c, coreHe: [br.he[0] * 0.55, br.he[1] * 0.7, br.he[2] * 0.55] };
}

/** 前計算済み breach の不規則カッター（union）。 */
function breachCut(fr: Fr, p: BreachPrecomp): number {
  let cut = sdBox(fr, p.coreC, p.coreHe);
  for (const s of p.spheres) { const v = sdSphere(fr, s.c, s.r); if (v < cut) cut = v; }
  for (const b of p.boxes) { const v = sdBoxOriented(fr, b.c, b.he, b.basis); if (v < cut) cut = v; }
  return cut;
}

/** 瓦礫の山の塊（球）群を前計算（rng/trig はここで1度だけ）。 */
function precomputeRubble(pile: RubblePile): SpherePrim[] {
  const r = rng(pile.seed);
  const out: SpherePrim[] = [];
  for (let i = 0; i < pile.rocks; i++) {
    const ang = r() * Math.PI * 2;
    const dist = r() * pile.spread;
    const t = 1 - dist / (pile.spread + 1e-3); // 中心ほど高く、外周ほど低い山
    out.push({
      c: [pile.c[0] + Math.cos(ang) * dist, pile.c[1] + t * pile.height * (0.4 + 0.6 * r()), pile.c[2] + Math.sin(ang) * dist * 0.7],
      r: 0.45 + r() * 0.7,
    });
  }
  return out;
}

/** ブループリントから距離場関数とサンプリング範囲を組む。 */
function buildField(spec: CathedralSpec): { field: (a: number, u: number, b: number) => number; bounds: FrameBounds } {
  const {
    naveHalfLen: L, naveHalfWidth: NW, aisleHalfWidth: AW, floorTop: F,
    aisleWallTop: AWT, arcadeSpring: AS, clerestoryTop: CT, wallThick: WT, pillarR: PR, bays,
  } = spec;
  const vaultCrown = CT + NW * spec.vaultCrownExtra;
  const hasAisles = spec.aisles;
  const outerB = hasAisles ? AW : NW; // 主外壁の b 位置（側廊なしなら身廊壁が外壁）

  // 列柱の a 位置（bays+1 本）。
  const pillarA: number[] = [];
  for (let i = 0; i <= bays; i++) pillarA.push(-L + (2 * L * i) / bays);
  const bayCenter: number[] = [];
  for (let i = 0; i < bays; i++) bayCenter.push((pillarA[i] + pillarA[i + 1]) / 2);
  const bayHalf = L / bays; // ベイ中心からアーチ縁まで（柱半径を差し引いて開口幅にする）

  const brokenMap = new Map<string, number>();
  for (const bp of spec.brokenPillars) brokenMap.set(`${bp.side}:${bp.index}`, bp.keep);

  // 前計算（rng/trig をホットループから排除）。
  const breachPre = spec.breaches.map(precomputeBreach);
  const rubblePre = spec.rubble.map(precomputeRubble);
  const roofBasisPlus = tiltedBasis(A_AXIS, -18 * DEG); // 側廊屋根スタブ +b 側
  const roofBasisMinus = tiltedBasis(A_AXIS, 18 * DEG); // -b 側

  // サンプリング範囲（実体を覆う。apse は +a へ、ヴォールトは上へ膨らむ）。早期棄却にも使う。
  const bounds: FrameBounds = {
    aMin: -L - (spec.westFacade ? WT * 2 : 0.5) - 0.5,
    aMax: L + (spec.apse ? NW + WT + 0.5 : 0.5) + 0.5,
    uMin: -0.4,
    uMax: vaultCrown + 0.8,
    bMin: -outerB - WT - 0.8,
    bMax: outerB + WT + 0.8,
  };

  const field = (a: number, u: number, b: number): number => {
    // 遠方セルの早期棄却：bounds 外の AABB 距離が大きければ真の sdf もそれ以上。
    // アリーナは大聖堂より遥かに広い円柱なので大半のセルが外気＝ここで即 return できる。
    // occluder 判定(sdf≤d, d≲1)にも MC(等値面 sdf=0)にも、遠方で正確な値は不要。
    const ox = Math.max(bounds.aMin - a, a - bounds.aMax, 0);
    const oy = Math.max(bounds.uMin - u, u - bounds.uMax, 0);
    const oz = Math.max(bounds.bMin - b, b - bounds.bMax, 0);
    const outside = Math.hypot(ox, oy, oz);
    if (outside > 1.5) return outside; // bounds から 1.5 以上外なら確実に空気

    const fr: Fr = [a, u, b];

    // === 実体（occluder）の union ===========================================
    // 床スラブ（外壁端まで張る）。
    let s = sdBox(fr, [0, F / 2, 0], [L + 0.6, F / 2, outerB + WT]);

    if (hasAisles) {
      // --- バシリカ（側廊あり）---
      // 側廊外壁 ±AW（低いアーチ窓で採光）。u:F..AWT。
      for (const side of [1, -1] as const) {
        let wall = sdBox(fr, [0, (F + AWT) / 2, side * AW], [L + WT, (AWT - F) / 2, WT]);
        for (let i = 0; i < bays; i++) {
          wall = subtract(wall, archOpening(fr, bayCenter[i], side * AW, bayHalf * 0.45, F + 0.6, F + 0.6 + (AWT - F) * 0.5, WT * 2));
        }
        s = Math.min(s, wall);
      }
      // アーケード壁 ±NW（身廊と側廊を分ける穴あき壁）。大アーチ＋クリアストーリー窓。
      for (const side of [1, -1] as const) {
        let arc = sdBox(fr, [0, (F + CT) / 2, side * NW], [L, (CT - F) / 2, WT]);
        for (let i = 0; i < bays; i++) {
          arc = subtract(arc, archOpening(fr, bayCenter[i], side * NW, bayHalf - PR - 0.3, F + 0.4, AS, WT * 2)); // 大アーチ→ピアが残る
          arc = subtract(arc, archOpening(fr, bayCenter[i], side * NW, bayHalf * 0.35, AWT + 0.7, AWT + 0.7 + (CT - AWT) * 0.6, WT * 2)); // クリアストーリー窓
        }
        s = Math.min(s, arc);
      }
      // 側廊の片流れ屋根は廃墟として撤去（側廊は上方へ開放＝飛行で入り込める谷）。東端に崩れ残りのスタブ。
      for (const side of [1, -1] as const) {
        const mid: Vec3 = [L - bayHalf, AWT + 0.7, side * (NW + AW) / 2];
        s = Math.min(s, sdBoxOriented(fr, mid, [bayHalf * 0.9, 0.22, (AW - NW) / 2 + 0.3], side > 0 ? roofBasisPlus : roofBasisMinus));
      }
    } else {
      // --- 単一大空間（側廊なし、システィーナ型）---
      // 身廊外壁 ±NW を F..CT に立て、ベイごとに背の高い窓を抜く（下段の大窓＋上段クリアストーリー）。
      for (const side of [1, -1] as const) {
        let wall = sdBox(fr, [0, (F + CT) / 2, side * NW], [L + WT, (CT - F) / 2, WT]);
        for (let i = 0; i < bays; i++) {
          wall = subtract(wall, archOpening(fr, bayCenter[i], side * NW, bayHalf * 0.5, F + 1.0, AS, WT * 2)); // 背の高い窓
          wall = subtract(wall, archOpening(fr, bayCenter[i], side * NW, bayHalf * 0.32, AS + 1.0, AS + 1.0 + (CT - AS) * 0.6, WT * 2)); // クリアストーリー
        }
        s = Math.min(s, wall);
      }
    }

    // 壁付き柱（バットレス／ピアの存在感）。±NW。折れ柱対応。
    for (const side of [1, -1] as const) {
      for (let i = 0; i <= bays; i++) {
        const keep = brokenMap.get(`${side}:${i}`);
        const top = keep === undefined ? AS : F + keep;
        if (top <= F) continue;
        s = Math.min(s, sdCappedCylinder(fr, [pillarA[i], (F + top) / 2, side * NW], UP, (top - F) / 2, PR));
      }
    }

    // 身廊ヴォールト（a 軸の樽天井。起拱 CT、頂 vaultCrown）。円筒殻の上半分。
    {
      const vr = NW + WT; // 外半径＝身廊幅 + 厚
      const vrin = NW; // 内半径
      let vault = subtract(
        sdCappedCylinder(fr, [0, CT, 0], A_AXIS, L, vr),
        sdCappedCylinder(fr, [0, CT, 0], A_AXIS, L + 0.1, vrin),
      );
      vault = Math.max(vault, CT - u); // 起拱より上だけ
      vault = Math.max(vault, u - vaultCrown - 0.5); // 頂より上は無し（保険）
      s = Math.min(s, vault);
    }

    // 西の正面壁（大扉つき）。
    if (spec.westFacade) {
      let west = sdBox(fr, [-L - WT, (F + CT) / 2, 0], [WT, (CT - F) / 2, outerB + WT]);
      west = subtract(west, archOpening(fr, -L - WT, 0, NW * 0.8, F + 0.3, F + 0.3 + NW * 1.4, WT * 3)); // 大扉
      s = Math.min(s, west);
    }

    // 東の後陣（半円アプス）。鉛直円筒殻を東半周だけ残す。
    if (spec.apse) {
      const apR = NW + 0.6;
      let apse = subtract(
        sdCappedCylinder(fr, [L, (F + CT) / 2, 0], UP, (CT - F) / 2, apR + WT),
        sdCappedCylinder(fr, [L, (F + CT) / 2 + 0.1, 0], UP, (CT - F) / 2, apR),
      );
      apse = Math.max(apse, L - a); // a≥L の東半分だけ
      s = Math.min(s, apse);
    }

    // 倒れ柱。
    for (const fc of spec.fallen) {
      s = Math.min(s, sdCappedCylinder(fr, fc.c, fc.axis, fc.half, fc.r));
    }

    // 瓦礫の山（前計算済みの塊を床へなじませる）。
    for (const rocks of rubblePre) {
      for (const rk of rocks) s = smoothUnion(s, sdSphere(fr, rk.c, rk.r), spec.smoothK);
    }

    // === 崩落（subtract）===================================================
    // 屋根の抜けたベイ（ヴォールトを a 区間でくり抜く＝空が覗く）。
    for (const [g0, g1] of spec.roofGaps) {
      s = subtract(s, sdBox(fr, [(g0 + g1) / 2, vaultCrown, 0], [(g1 - g0) / 2, NW + WT + 1.0, NW + WT * 2]));
    }
    // 折れピア：アーケードの柱とその上の壁を keep より上で欠く（崩れた柱間＝開放）。
    for (const bp of spec.brokenPillars) {
      const top = F + bp.keep;
      s = subtract(s, sdBox(fr, [pillarA[bp.index], (top + CT) / 2 + 0.5, bp.side * NW], [PR * 1.8, (CT - top) / 2 + 1.0, WT * 2.5]));
    }
    // 大崩落破断（前計算済みの不規則カッターで壁・屋根をえぐる）。開放性の主役。
    for (const bp of breachPre) {
      s = subtract(s, breachCut(fr, bp));
    }

    return s;
  };

  return { field, bounds };
}

/** ブループリントから Terrain（sdf + mesh）を構築する。 */
export function buildCathedral(spec: CathedralSpec): Terrain {
  const { field, bounds } = buildField(spec);
  return {
    sdf(p: Vec3): number {
      const [a, u, b] = toFrame(p);
      return field(a, u, b);
    },
    mesh(res: number): TerrainMesh {
      return marchingCubes(field, bounds, Math.max(1, Math.floor(res)));
    },
  };
}

/** 倒れ柱の軸（鉛直を 80°倒してほぼ水平に）。 */
const FALLEN = rotateAxisAngle(UP, B_AXIS, 80 * DEG);

/** ヴォールト頂の u（spec から導出）。 */
export function vaultCrownOf(spec: CathedralSpec): number {
  return spec.clerestoryTop + spec.naveHalfWidth * spec.vaultCrownExtra;
}

/** アリーナ設定（fcc.buildArena 引数）。 */
export interface ArenaConfig {
  Hmax: number; // 水平半径（= hypot(a,b) の上限）。身廊長手をくるむ必要がある。
  Lmin: number;
  Lmax: number;
}

/**
 * spec を内包し周囲に飛行余白を持つ推奨アリーナを導出する。
 * 水平: horizRadius=hypot(a,b)。身廊端 (a=±naveHalfLen) を覆うため Hmax≈naveHalfLen+余白。
 * 鉛直: layer L=u·√3/2。ヴォールト頂＋空の余白までを Lmax に。
 * 1セル=人型1体なので、ここで決まるセル数がそのまま「ユニットから見た空間の広さ」になる。
 */
export function recommendedArena(spec: CathedralSpec, margin = 3): ArenaConfig {
  const maxA = spec.naveHalfLen + (spec.apse ? spec.naveHalfWidth + spec.wallThick : 0) + (spec.westFacade ? spec.wallThick * 2 : 0);
  const maxB = (spec.aisles ? spec.aisleHalfWidth : spec.naveHalfWidth) + spec.wallThick;
  const Hmax = Math.ceil(Math.hypot(maxA, maxB) + margin);
  const uTop = vaultCrownOf(spec) + margin + 1;
  const Lmax = Math.ceil((uTop * Math.sqrt(3)) / 2);
  return { Hmax, Lmin: 0, Lmax };
}

/**
 * 既定の廃墟大聖堂（人間スケール / 飛行前提 / 半壊・開放性を最優先）。
 * 1セル=人型1体。身廊 a:±16(長32)/ 幅 b:±4(幅8)/ 側廊外壁 b:±8(全幅16)/ ヴォールト頂 u≈20。
 * ＝ユニット身長の約20倍の大空間。南北側廊が大きく崩落し外へ開く。身廊中央の屋根が抜けて空が覗く。
 * 西正面の頭頂も欠ける。床に瓦礫の山と倒れ柱、列柱の一部が折れる。
 */
export const RUINED_CATHEDRAL: CathedralSpec = {
  naveHalfLen: 16,
  naveHalfWidth: 4,
  aisleHalfWidth: 8,
  floorTop: 1,
  aisleWallTop: 8,
  arcadeSpring: 10.5,
  clerestoryTop: 16,
  vaultCrownExtra: 1.0,
  wallThick: 0.6,
  pillarR: 0.8,
  bays: 6,
  aisles: true,
  apse: true,
  westFacade: true,
  breaches: [
    // 南(-b)側廊の壁〜屋根を大きくえぐる大崩落（外から内部へ侵入できる主開口）。
    { c: [6, 7, -8], he: [5.5, 6, 2.2], chunks: 18, seed: 11 },
    // 北(+b)側廊の中ほどにも中規模の破断。
    { c: [-8, 7, 8], he: [3.8, 5, 1.8], chunks: 12, seed: 23 },
    // 西正面の頭頂が崩れる。
    { c: [-17, 15, 1], he: [2.4, 3.5, 4.5], chunks: 12, seed: 37 },
  ],
  rubble: [
    { c: [6, 1.0, -6], spread: 4.2, height: 4, rocks: 16, seed: 5 }, // 南崩落の足元に崩れ落ちる
    { c: [-1, 1.0, 0], spread: 3.4, height: 3, rocks: 14, seed: 8 }, // 屋根抜けの真下、身廊中央
    { c: [-14, 1.0, -2.5], spread: 2.8, height: 2.6, rocks: 10, seed: 14 }, // 西扉の内側
  ],
  fallen: [
    { c: [3, 1.7, -1.5], axis: FALLEN, half: 4.5, r: 0.8 }, // 身廊を斜めに横切る倒れ柱
    { c: [-9, 1.6, 6], axis: rotateAxisAngle(UP, A_AXIS, 82 * DEG), half: 3.5, r: 0.7 }, // 北側廊
  ],
  brokenPillars: [
    { side: -1, index: 2, keep: 4 }, // 南列の1本が折れる（a=pillarA[2]）
    { side: 1, index: 4, keep: 5 },
  ],
  roofGaps: [
    [-5.5, 5.5], // 身廊中央の屋根が抜ける（空が覗く）
  ],
  smoothK: 0.7,
};

/**
 * システィーナ礼拝堂型の巨大アリーナ（単一大空間・側廊なし・極めて高い樽天井）。
 * 1セル=人型1体。身廊 a:±24(長48)/ 幅 b:±6(幅12)/ ヴォールト頂 u≈34 ＝ユニット身長の約34倍。
 * 側廊を持たず、背の高い窓が並ぶ一室の大ホール。長辺・高さとも既定の倍規模。
 * 一部の壁が大きく崩れ、天井が複数箇所抜け、床に巨大な瓦礫が積もる。
 */
export const SISTINE_CATHEDRAL: CathedralSpec = {
  naveHalfLen: 24,
  naveHalfWidth: 6,
  aisleHalfWidth: 6, // aisles:false なので未使用（outerB=NW）
  floorTop: 1,
  aisleWallTop: 18,
  arcadeSpring: 22,
  clerestoryTop: 28,
  vaultCrownExtra: 1.0,
  wallThick: 0.9,
  pillarR: 1.0,
  bays: 8,
  aisles: false,
  apse: true,
  westFacade: true,
  breaches: [
    { c: [10, 12, -6], he: [7, 9, 2.4], chunks: 22, seed: 41 }, // 南壁の大崩落
    { c: [-12, 14, 6], he: [5, 8, 2.4], chunks: 16, seed: 47 }, // 北壁の崩落
    { c: [-25, 22, 1.5], he: [3, 5, 6], chunks: 14, seed: 53 }, // 西正面の頭頂
  ],
  rubble: [
    { c: [10, 1.0, -4], spread: 6, height: 6, rocks: 22, seed: 61 }, // 南崩落の足元
    { c: [0, 1.0, 0], spread: 5, height: 5, rocks: 20, seed: 67 }, // 屋根抜けの真下
    { c: [-20, 1.0, -2], spread: 4, height: 4, rocks: 14, seed: 71 }, // 西扉の内側
  ],
  fallen: [
    { c: [5, 2.0, -2], axis: FALLEN, half: 6, r: 1.0 }, // 大ホールを横切る巨大な倒れ柱
  ],
  brokenPillars: [
    { side: -1, index: 3, keep: 6 },
    { side: 1, index: 6, keep: 8 },
  ],
  roofGaps: [
    [-9, -2], // 天井が広く抜ける（西寄り）
    [6, 12], // もう一箇所（東寄り）
  ],
  smoothK: 1.0,
};

/** プリセット（spec + 推奨アリーナ + 既定 d）。store / preview / UI から参照。 */
export interface CathedralPreset {
  key: string;
  label: string;
  spec: CathedralSpec;
  arena: ArenaConfig;
  /** occluder 許容半径（壁厚に応じた既定）。 */
  d: number;
}

export const PRESETS: Record<string, CathedralPreset> = {
  ruined: { key: 'ruined', label: '廃墟大聖堂（人間スケール）', spec: RUINED_CATHEDRAL, arena: recommendedArena(RUINED_CATHEDRAL), d: 0.55 },
  sistine: { key: 'sistine', label: 'システィーナ型（巨大）', spec: SISTINE_CATHEDRAL, arena: recommendedArena(SISTINE_CATHEDRAL), d: 0.75 },
};

/** 既定プリセット（store の初期地形・アリーナ）。 */
export const DEFAULT_PRESET = PRESETS.ruined;

/** 既定地形（store / テストの入口）。廃墟大聖堂を1つ返す。 */
export function createSampleTerrain(): Terrain {
  return buildCathedral(DEFAULT_PRESET.spec);
}
