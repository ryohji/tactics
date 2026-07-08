// 洞窟の壁描画(rogue-1)。世界モデルは「無限の土の塊から発見済みの空洞だけが
// くり抜かれている」。描くのは**空洞の内表面**(発見済みセルと、そうでない隣の間の
// 境界面)だけで、法線は空洞側(=土の外)を向く。未発見の空洞は面を張らない=
// 土の中に埋まったまま。発見と同時に開く(discoveredRev で全再構築。差分は先送り)。
//
// 当初は「発見済みセルに接する岩セル」をブロック描画していたが、以下の経緯で今の形に:
//   - 第2回: 隣接ブロック共有面の表裏が同一平面で Z ファイト → 露出面マージの単一メッシュ化。
//     あわせて rd.ts の RD_FACES の巻き不揃い(12面中6面が逆)を世界空間の法線照合で統一。
//   - 第6回: 殻(厚さ1セル)の外側の黒い面や背景が断面の隙間から覗いて不自然
//     → 殻の外側の面を全廃し「内表面のみ+無限の土」モデルへ。土の中身はステンシル
//     キャップが塗るので、面はくり抜きの境界にだけあればよい。
//
// カットアウェイ: 毎フレーム「視線に直交し、注視点より CUT_OFFSET 視点寄り」の平面を
// 更新し clippingPlanes に渡す。オフセットは隣接セルの壁面(中心から ~0.71 格子 =
// √2S/2 ≈ 1.41)より内側の 0.5S にする。これより大きいと、壁際に立つプレイヤーを
// 壁越しに見たとき背後の壁が切れずに視界を塞ぐ。
//
// 断面はステンシルキャップで塞ぐ(three.js 公式 clipping_stencil の手法)。
// 計数対象の立体 = 空洞内表面 + 全体を包む巨大球(土の外周)。この2つで
// 「無限の土 ∖ 発見済み空洞」という閉じた立体の境界になる。切断立体の裏面で
// stencil +1・表面で -1 すると「平面の横断点が土の中にあるピクセル」だけ ≠0 になり、
// そこへ平面上の大板を描けば、断面は**空洞の断面だけ穴の開いた塗り潰しの土**になる。
// 未発見の空洞は計数に現れない=土として塗られる(未知は土)。

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OFFSETS, keyToCell, layer, worldPos, type Cell, type CellKey } from '../model/fcc';
import { useRogue, clearedChambers, ROGUE_S } from '../state/rogue';
import { RD_FACES, RD_VERTICES } from './rd';
import { currentFocusGrid } from './rogueFocus';
import { makeRockMaterial } from './rockMaterial';

const ROCK_SHALLOW = new THREE.Color('#7a6a55');
const ROCK_DEEP = new THREE.Color('#3a3452');
/** 訪問済みの広間の壁の色味(青紫寄りに寄せて「来たことがある」を示す)。 */
const VISITED_TINT = new THREE.Color('#7d88c9');
/** 掃討済み(敵全滅)の広間の壁の色味(明るい土色に寄せて「安全」を示す)。 */
const CLEARED_TINT = new THREE.Color('#cdbb96');
/** マップモードで「いま居る広間」を示す色味。 */
const CURRENT_TINT = new THREE.Color('#39c6e0');
/** マップの TAB 巡回でフォーカス中の広間を示す色味(現在地より優先)。 */
const FOCUS_TINT = new THREE.Color('#e8c35a');
/** 切断面(岩の内部)の土色。 */
const CUT_COLOR = '#5c422e';
/** 背景(未発見の土の中)の色。RogueScene の背景・霧と揃える。 */
const EARTH_BG = '#2a1e14';
/** カット平面の注視点からのオフセット(視点寄り)。隣接セルの壁面(√2S/2)より内側に。 */
const CUT_OFFSET = 0.5 * ROGUE_S;
/** 俯瞰時の水平カットの高さ(プレイヤー中心から上)。同層セルの上端(≈0.87S)より上に。 */
const H_CUT = 1.3 * ROGUE_S;
/** キャップ板の一辺(視錐台と平面の交差を覆う大きさ)。 */
const CAP_SIZE = 200 * ROGUE_S;
/** キャップの放射フェード: 視軸からこの距離までは明るい断面色。 */
const CAP_R0 = 5 * ROGUE_S;
/** キャップの放射フェード: この距離で背景色に溶け切る。 */
const CAP_R1 = 13 * ROGUE_S;
/** ステンシル計数用の「土の外周」球の半径。注視点に追従(カメラ far=1000 未満に収める)。 */
const EARTH_R = 300 * ROGUE_S;

// 全シェルマテリアルで共有するクリッピング平面(毎フレーム更新)。
const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);

const Z_AXIS = new THREE.Vector3(0, 0, 1);

// キャップ用シェーダ: 無限平面は視界の脇や周囲の岩まで切って大面積の断面を作るため、
// 断面色を視軸中心からの距離でフェードさせる(近く=明るい土色 → 遠く=背景の暗い土色)。
// 幾何は正確なまま「プレイヤーの周りだけ掘削した」ように読める。
// 板は視軸上に置かれるので、板ローカルの xy 距離がそのまま視軸からの距離になる。
const CAP_VERT = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const CAP_FRAG = /* glsl */ `
  uniform vec3 uNear;
  uniform vec3 uFar;
  uniform float uR0;
  uniform float uR1;
  varying vec2 vPos;
  void main() {
    float t = smoothstep(uR0, uR1, length(vPos));
    gl_FragColor = vec4(mix(uNear, uFar, t), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** セル座標の決定的ハッシュ(0..1)。岩肌の色むらに使う。 */
function hash01(c: Cell): number {
  let h = (c[0] * 73856093) ^ (c[1] * 19349663) ^ (c[2] * 83492791);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/** 頂点変位の振幅(格子単位)。面の一辺 ≈1.2 に対し小さく、ブロック感だけ崩す。 */
const JITTER = 0.09;

/**
 * 頂点位置(格子座標×2 の整数)から決定的な微小変位ベクトル(格子単位)。
 * 隣接面が共有する頂点は同じ量だけ動くので、水密性(=ステンシル断面の前提)が保たれる。
 */
function vertexJitter(gx: number, gy: number, gz: number): [number, number, number] {
  const h = (salt: number) => {
    let x = (Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663) ^ Math.imul(gz, 83492791) ^ salt) | 0;
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    return (((x ^ (x >>> 16)) >>> 0) / 0x100000000 - 0.5) * 2 * JITTER;
  };
  return [h(0x9e37), h(0x85eb), h(0xc2b2)];
}

/**
 * オフセット方向 → 巻きを統一した RD 面(格子単位の4頂点、外向き)。
 * RD_FACES から面中心 = offset/2 で対応を取り、ワールド空間の法線が
 * offset 方向を向くよう必要なら巻きを反転する(worldPos は向きを反転する
 * 等長変換 det=-1 なので、格子空間の見た目では判定しない)。
 */
const ORIENTED_FACES: { off: Cell; verts: [Cell, Cell, Cell, Cell] }[] = OFFSETS.map((off) => {
  const face = RD_FACES.find((f) => {
    const cx = (RD_VERTICES[f[0]][0] + RD_VERTICES[f[1]][0] + RD_VERTICES[f[2]][0] + RD_VERTICES[f[3]][0]) / 4;
    const cy = (RD_VERTICES[f[0]][1] + RD_VERTICES[f[1]][1] + RD_VERTICES[f[2]][1] + RD_VERTICES[f[3]][1]) / 4;
    const cz = (RD_VERTICES[f[0]][2] + RD_VERTICES[f[1]][2] + RD_VERTICES[f[2]][2] + RD_VERTICES[f[3]][2]) / 4;
    return Math.abs(cx * 2 - off[0]) < 1e-9 && Math.abs(cy * 2 - off[1]) < 1e-9 && Math.abs(cz * 2 - off[2]) < 1e-9;
  })!;
  let verts = face.map((i) => RD_VERTICES[i]) as [Cell, Cell, Cell, Cell];
  const a = worldPos(verts[0][0], verts[0][1], verts[0][2], 1);
  const b = worldPos(verts[1][0], verts[1][1], verts[1][2], 1);
  const c = worldPos(verts[2][0], verts[2][1], verts[2][2], 1);
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const n = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  };
  const ow = worldPos(off[0], off[1], off[2], 1);
  if (n.x * ow.x + n.y * ow.y + n.z * ow.z < 0) {
    verts = [verts[0], verts[3], verts[2], verts[1]];
  }
  return { off, verts };
});

/**
 * 空洞の内表面メッシュを構築(位置+頂点色、フラット法線)。
 * 発見済みセル c と「発見済み空洞でない」隣 n の間の菱形を、法線が空洞側(c 側)を
 * 向くように張る(ORIENTED_FACES は c→n 向きなので巻きを反転)。色は岩セル n 由来に、
 * 空洞側セル c の属する広間の探索状態(訪問済み=青紫 / 掃討済み=明るい土色)を重ねる。
 * 発見済み空洞の連結領域を囲む閉曲面になる(土の外側の面は存在しない)。
 */
function buildShellGeometry(
  open: Set<CellKey>,
  discovered: Set<CellKey>,
  cellChamber: ReadonlyMap<CellKey, number>,
  visited: ReadonlySet<number>,
  cleared: ReadonlySet<number>,
  current: number | null,
  focused: number | null,
  S: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const c3 = new THREE.Color();
  for (const k of discovered) {
    const c = keyToCell(k);
    const chamber = cellChamber.get(k);
    for (const { off, verts } of ORIENTED_FACES) {
      const n: Cell = [c[0] + off[0], c[1] + off[1], c[2] + off[2]];
      const nk = `${n[0]},${n[1]},${n[2]}`;
      if (open.has(nk) && discovered.has(nk)) continue; // 両側とも空洞: 境界でない
      const t = Math.min(1, Math.max(0, -layer(n) / 26));
      c3.copy(ROCK_SHALLOW).lerp(ROCK_DEEP, t);
      c3.multiplyScalar(0.82 + 0.36 * hash01(n));
      if (chamber !== undefined && chamber === focused) {
        c3.lerp(FOCUS_TINT, 0.6); // TAB 巡回のフォーカス先(マップモード)
      } else if (chamber !== undefined && chamber === current) {
        c3.lerp(CURRENT_TINT, 0.55); // いま居る広間(マップモード)
      } else if (chamber !== undefined && cleared.has(chamber)) {
        c3.lerp(CLEARED_TINT, 0.5); // 掃討済み: 明るく安全な色へ
      } else if (chamber !== undefined && visited.has(chamber)) {
        c3.lerp(VISITED_TINT, 0.3); // 訪問済み(敵が残る): 青紫寄り
      }
      // 巻き反転 [0,3,2,1] で法線を -off(空洞側)へ。
      const q = [verts[0], verts[3], verts[2], verts[1]];
      const w = q.map((v) => {
        // 頂点変位: 位置ハッシュで格子座標を微小に揺らしてから世界座標へ
        // (RD 頂点は 0.5 刻みなので ×2 して整数キーにする)。
        const vx = c[0] + v[0];
        const vy = c[1] + v[1];
        const vz = c[2] + v[2];
        const j = vertexJitter(Math.round(vx * 2), Math.round(vy * 2), Math.round(vz * 2));
        return worldPos(vx + j[0], vy + j[1], vz + j[2], S);
      });
      for (const i of [0, 1, 2, 0, 2, 3]) {
        pos.push(w[i].x, w[i].y, w[i].z);
        col.push(c3.r, c3.g, c3.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals(); // 非インデックスなので面フラット法線になる
  return g;
}

export function DungeonShell() {
  const discoveredRev = useRogue((s) => s.discoveredRev);
  const gl = useThree((s) => s.gl);

  // マテリアル単位のクリッピングはレンダラ側の許可が要る。
  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);

  // ステンシルバッファの実在確認。無い環境ではステンシルテストが「常に合格」になり
  // キャップ板が全画面を塗り潰してしまう(WebGL 仕様)ため、キャップを無効化して
  // 裏面塗りのみに退避する。App の Canvas は gl={{ stencil: true }} を要求しているが、
  // コンテキスト属性は生成時にしか効かない(HMR で開きっぱなしのタブは古いまま)。
  const hasStencil = useMemo(() => {
    const attrs = gl.getContext().getContextAttributes?.();
    const ok = !!attrs?.stencil;
    if (!ok) {
      console.warn(
        'WebGL コンテキストに stencil バッファがありません。断面キャップを無効化します。' +
          'ページを再読み込み(ハードリロード)すると有効になります。',
      );
    }
    return ok;
  }, [gl]);

  // 断面が簡易版(裏面塗り)へ退避したことを、console を見ない人にも分かるよう HUD ログへ。
  useEffect(() => {
    if (hasStencil) return;
    const s = useRogue.getState();
    useRogue.setState({
      log: [...s.log, '⚠ 断面表示が簡易版です(stencil 無し)。ページを再読み込みしてください。'],
    });
  }, [hasStencil]);

  const exploreRev = useRogue((s) => s.exploreRev);
  const mapMode = useRogue((s) => s.mapMode);
  // マップモードでは「いま居る広間」をハイライト(部屋が変わったときだけ再構築)。
  const currentChamber = useRogue((s) =>
    s.mapMode ? s.cellChamber.get(`${s.player.pos[0]},${s.player.pos[1]},${s.player.pos[2]}`) ?? null : null,
  );
  const focusChamber = useRogue((s) => (s.mapMode ? s.mapFocusChamber : null));
  const geom = useMemo(() => {
    const s = useRogue.getState();
    const cleared = clearedChambers(s.visitedChambers, s.beasts);
    return buildShellGeometry(
      s.dungeon.open,
      s.discovered,
      s.cellChamber,
      s.visitedChambers,
      cleared,
      currentChamber,
      focusChamber,
      ROGUE_S,
    );
    // 変更検知キー: discoveredRev(掘削・発見)+ exploreRev(訪問・掃討)
    // + 現在広間 + TAB フォーカス広間。dungeon/discovered/visited は in-place 更新のため rev で追う。
  }, [discoveredRev, exploreRev, currentChamber, focusChamber]);
  useEffect(() => () => geom.dispose(), [geom]);

  // マップモードはカットしない(巣の全体像。クリップ/キャップ/計数を停止)。
  const planes = mapMode ? [] : [cutPlane];
  const showCut = hasStencil && !mapMode;

  // 岩肌マテリアル(トライプレーナー)。クリップ平面はレンダーごとに差し替える。
  const rockMat = useMemo(() => makeRockMaterial(), []);
  useEffect(() => () => rockMat.dispose(), [rockMat]);
  rockMat.clippingPlanes = planes;

  // カット平面の更新。「平面よりカメラ側」(n·p + c < 0)が描画されない。
  // 視線直交のままだと、俯瞰時に平面がほぼ水平になってプレイヤー頭上すれすれに浮き、
  // 周囲の床セルの上端を薄切りにした小さな菱形断面が散らばって「不定形の穴」に見える
  // (目視フィードバック第8回。メッシュは水密検査済みで、断面自体は正しい)。
  // そこで俯角に応じて法線を真下へブレンドする:
  //   水平視 → 視線直交・注視点の 0.5S 手前(壁抜き)
  //   俯瞰   → 水平カット・プレイヤー頭上 H_CUT(屋根を外した見え方。断面高さが揃う)
  // どちらもカメラは常に切除側に居るので、ステンシル計数の前提は崩れない。
  const capRef = useRef<THREE.Mesh>(null);
  const sphereRef = useRef<THREE.Mesh>(null);
  const tmpP = useRef(new THREE.Vector3());
  const tmpN = useRef(new THREE.Vector3());
  useFrame(({ camera }) => {
    const g = currentFocusGrid();
    const w = worldPos(g[0], g[1], g[2], ROGUE_S);
    const p = tmpP.current.set(w.x, w.y, w.z);
    if (sphereRef.current) sphereRef.current.position.copy(p); // 外周球は注視点に追従
    const n = tmpN.current.copy(p).sub(camera.position).normalize();
    const t = THREE.MathUtils.smoothstep(-n.y, 0.25, 0.7); // 俯角が深いほど 1
    n.multiplyScalar(1 - t);
    n.y -= t;
    n.normalize();
    const off = CUT_OFFSET * (1 - t) + H_CUT * t;
    p.addScaledVector(n, -off);
    cutPlane.setFromNormalAndCoplanarPoint(n, p);
    const cap = capRef.current;
    if (cap) {
      cap.position.copy(p).addScaledVector(n, -0.02 * ROGUE_S);
      cap.quaternion.setFromUnitVectors(Z_AXIS, n);
    }
  });

  return (
    <group>
      {/* 同一ジオメトリを複数パスで共有するため geometry プロップで渡す(単純な代入)。
          <primitive attach> 共有は差し替え時の付け外し帳簿が絡み、発見のたびの再構築で
          一部メッシュが空ジオメトリへ戻る(壁が消える)ことがあった(第10回)。 */}
      {/* 表面: 岩肌(トライプレーナーの色ムラ+擬似バンプ。カメラ側はクリップ) */}
      <mesh geometry={geom} material={rockMat} frustumCulled={false} />
      {/* 裏面の土色: stencil 不可環境のフォールバック。stencil 有効時はキャップが
          平面上で必ず先に遮る(内部への視線は平面を岩の中で横切る)ため描かない —
          描くと遠方の断面までキャップの放射フェードを無視して明るく見えてしまう。 */}
      {!hasStencil && !mapMode && (
        <mesh geometry={geom} frustumCulled={false}>
          <meshBasicMaterial color={CUT_COLOR} side={THREE.BackSide} clippingPlanes={planes} />
        </mesh>
      )}
      {/* ステンシル計数: 切断立体の裏面 +1 / 表面 -1(色・深度は書かない) */}
      {showCut && (
      <mesh geometry={geom} frustumCulled={false} renderOrder={1}>
        <meshBasicMaterial
          colorWrite={false}
          depthWrite={false}
          depthTest={false}
          side={THREE.BackSide}
          clippingPlanes={planes}
          stencilWrite
          stencilFunc={THREE.AlwaysStencilFunc}
          stencilFail={THREE.IncrementWrapStencilOp}
          stencilZFail={THREE.IncrementWrapStencilOp}
          stencilZPass={THREE.IncrementWrapStencilOp}
        />
      </mesh>
      )}
      {showCut && (
      <mesh geometry={geom} frustumCulled={false} renderOrder={1}>
        <meshBasicMaterial
          colorWrite={false}
          depthWrite={false}
          depthTest={false}
          side={THREE.FrontSide}
          clippingPlanes={planes}
          stencilWrite
          stencilFunc={THREE.AlwaysStencilFunc}
          stencilFail={THREE.DecrementWrapStencilOp}
          stencilZFail={THREE.DecrementWrapStencilOp}
          stencilZPass={THREE.DecrementWrapStencilOp}
        />
      </mesh>
      )}
      {/* 土の外周球: 計数立体を「無限の土 ∖ 空洞」として閉じる。空洞に入らない視線は
          この球の裏面で +1 され、平面横断点が土の中なら stencil≠0 → 土として塗られる。
          カメラは常に球の内側なので表面は描画されない(見た目には現れない)。 */}
      {showCut && (
      <mesh ref={sphereRef} frustumCulled={false} renderOrder={1}>
        <sphereGeometry args={[EARTH_R, 24, 16]} />
        <meshBasicMaterial
          colorWrite={false}
          depthWrite={false}
          depthTest={false}
          side={THREE.BackSide}
          clippingPlanes={planes}
          stencilWrite
          stencilFunc={THREE.AlwaysStencilFunc}
          stencilFail={THREE.IncrementWrapStencilOp}
          stencilZFail={THREE.IncrementWrapStencilOp}
          stencilZPass={THREE.IncrementWrapStencilOp}
        />
      </mesh>
      )}
      {/* キャップ: stencil≠0 のピクセル(=切り口)だけ板が残る。色は視軸からの
          距離で 明るい断面色→背景色 にフェード(遠くの断面は「暗い土」に沈む)。 */}
      {showCut && (
      <mesh ref={capRef} frustumCulled={false} renderOrder={2}>
        <planeGeometry args={[CAP_SIZE, CAP_SIZE]} />
        <shaderMaterial
          vertexShader={CAP_VERT}
          fragmentShader={CAP_FRAG}
          uniforms={{
            uNear: { value: new THREE.Color(CUT_COLOR) },
            uFar: { value: new THREE.Color(EARTH_BG) },
            uR0: { value: CAP_R0 },
            uR1: { value: CAP_R1 },
          }}
          side={THREE.DoubleSide}
          stencilWrite
          stencilRef={0}
          stencilFunc={THREE.NotEqualStencilFunc}
          stencilFail={THREE.ReplaceStencilOp}
          stencilZFail={THREE.ReplaceStencilOp}
          stencilZPass={THREE.ReplaceStencilOp}
        />
      </mesh>
      )}
    </group>
  );
}
