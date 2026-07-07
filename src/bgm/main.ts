// BGM 試聴室(rogue-16)。bgm.html のエントリ。
// ゲーム本編とは独立したページで、スタイル(洞窟+地域風の試作)と深度を
// 選んで生成 BGM を聴ける。React は使わず素の DOM で組む(依存を軽く)。
// スタイル切替はエンジンを作り直す(dispose → create)。深度・シーンは
// 走っているエンジンへそのまま流す。

import { createBgmEngine, type BgmEngine, type BgmScene } from '../audio/bgmEngine';
import { BGM_STYLES } from '../audio/bgmStyles';

let engine: BgmEngine | null = null;
let styleId = BGM_STYLES[0].id;
let depth = 8; // リズムも旋律もひととおり聴こえる深さを初期値に
let scene: BgmScene = 'game';
let playing = false;

const app = document.getElementById('app')!;
app.innerHTML = `
  <h1>蟻巣迷宮 — BGM 試聴室</h1>
  <p class="sub">WebAudio 生成 BGM を深度・シーン別に試聴する。
    <a href="${import.meta.env.BASE_URL}">← ゲームへ戻る</a></p>
  <div class="styles" id="styles"></div>
  <div class="panel">
    <div class="row play-row">
      <button id="play">▶ 鳴らす</button>
      <div class="scene-btns" id="scenes"></div>
    </div>
    <div class="row">
      <label class="head" for="depth">深度</label>
      <input type="range" id="depth" min="0" max="24" step="1" />
      <div class="depth-val" id="depth-val"></div>
    </div>
    <div class="row">
      <label class="head">層</label>
      <ul class="layers" id="layers"></ul>
    </div>
  </div>
  <p class="note">洞窟がゲーム本編の BGM。ほかは「ヨーロッパから外れた雰囲気」の試作
    (ケルト/アラブ/エジプト/インド)。楽器はすべて WebAudio 合成 —
    アラブのマカームは四分音(半音のさらに半分)を含む。深度を動かすと
    層がなめらかに追従する(ゲーム中はターンごとに現在深度が通知される)。</p>
`;

const stylesEl = document.getElementById('styles')!;
const scenesEl = document.getElementById('scenes')!;
const layersEl = document.getElementById('layers')!;
const playBtn = document.getElementById('play') as HTMLButtonElement;
const depthEl = document.getElementById('depth') as HTMLInputElement;
const depthVal = document.getElementById('depth-val')!;

const SCENES: { id: BgmScene; label: string }[] = [
  { id: 'game', label: '探索' },
  { id: 'map', label: 'マップ' },
  { id: 'dead', label: '死亡' },
];

function currentStyle() {
  return BGM_STYLES.find((s) => s.id === styleId) ?? BGM_STYLES[0];
}

function render(): void {
  stylesEl.innerHTML = '';
  for (const s of BGM_STYLES) {
    const btn = document.createElement('button');
    btn.className = 'style-card' + (s.id === styleId ? ' on' : '');
    btn.innerHTML = `<b>${s.label}</b><span>${s.desc}</span>`;
    btn.onclick = () => {
      if (s.id === styleId) return;
      styleId = s.id;
      if (playing) {
        engine?.dispose();
        engine = createBgmEngine(s, { depth, scene });
      }
      render();
    };
    stylesEl.appendChild(btn);
  }
  scenesEl.innerHTML = '';
  for (const sc of SCENES) {
    const btn = document.createElement('button');
    btn.className = sc.id === scene ? 'on' : '';
    btn.textContent = sc.label;
    btn.onclick = () => {
      scene = sc.id;
      engine?.setScene(scene);
      render();
    };
    scenesEl.appendChild(btn);
  }
  playBtn.textContent = playing ? '■ 止める' : '▶ 鳴らす';
  playBtn.className = playing ? 'on' : '';
  depthEl.value = String(depth);
  depthVal.textContent = String(depth);
  layersEl.innerHTML = '';
  for (const l of currentStyle().layers) {
    const li = document.createElement('li');
    li.className = depth >= l.from ? 'on' : '';
    li.innerHTML = `<b>深度${l.from}〜</b> ${l.label}`;
    layersEl.appendChild(li);
  }
}

playBtn.onclick = () => {
  if (playing) {
    engine?.dispose();
    engine = null;
    playing = false;
  } else {
    engine = createBgmEngine(currentStyle(), { depth, scene });
    playing = engine !== null;
  }
  render();
};

depthEl.oninput = () => {
  depth = Number(depthEl.value);
  engine?.setDepth(depth);
  render();
};

render();
