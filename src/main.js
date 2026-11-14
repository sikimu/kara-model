// 起動と画面切り替え
// 画面は 3D の家だけ。部屋のもの（キャラクター・ドア・ベッド・黒板）を押すと、
// その操作の入力が下に出る。設定は右上の歯車にまとめる。

import { createModel } from './model/model.js';
import { createStage } from './ui/stage.js';
import { createTalk } from './ui/talk.js';
import { createListen } from './ui/listen.js';
import { createJournal, createMemory, createChips } from './ui/items.js';
import { createSleep } from './ui/sleep.js';
import { ICONS, iconButton } from './ui/icons.js';
import { save, load, clear } from './save.js';
import { sound } from './ui/sound.js';

// 演出の速度。値は 1 手順あたりの待ち時間（ミリ秒）。0 は再生しない
const SPEEDS = Array.from({ length: 10 }, (_, i) => Math.round(1600 * (80 / 1600) ** (i / 9)));
let speedIndex = 5;
let skip = false;
let paused = false;
let skipOnce = false;
try {
  const stored = JSON.parse(localStorage.getItem('kara-model-ui'));
  if (Number.isInteger(stored?.speedIndex) && stored.speedIndex >= 0 && stored.speedIndex < 10) speedIndex = stored.speedIndex;
  if (typeof stored?.skip === 'boolean') skip = stored.skip;
} catch { /* 保存を使えなくても遊べる */ }
const getStep = () => skip || skipOnce ? 0 : SPEEDS[speedIndex];
function saveUI() {
  try { localStorage.setItem('kara-model-ui', JSON.stringify({ speedIndex, skip })); } catch { /* 保存は任意 */ }
}

// 部屋のものを押すと開く入力。explore（黒板）は入力を持たず、頭の中の画面を開く
const PARTS = [
  { id: 'talk', create: createTalk },
  { id: 'listen', create: createListen },
  { id: 'sleep', create: createSleep },
  { id: 'journal', create: createJournal },
  { id: 'memory', create: createMemory },
  { id: 'chips', create: createChips },
];

const app = document.getElementById('app');

// 左上: 小さなロゴ
const logo = document.createElement('h1');
logo.className = 'logo';
logo.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 34V17" stroke="#587e4a" stroke-width="3" stroke-linecap="round"/><path d="M20 23C5 24 5 9 7 8c12 0 16 7 13 15Z" fill="#9bbd6a"/><path d="M20 18C19 7 29 3 35 5c0 10-6 16-15 13Z" fill="#638e50"/></svg><span>からっぽのコト<small>聞いて、眠って、ことばが育つ。</small></span>';

// 右上: 再生中だけ出る一時停止とコマ送り、頭の中から家にもどる、設定
const hud = document.createElement('div');
hud.className = 'hud';
const homeButton = iconButton('home', '家にもどる', 'home-button');
const pauseButton = iconButton('pause', '一時停止', 'pause-button');
const stepButton = iconButton('step', 'コマ送り（1 手順だけ進める）', 'step-button');
const skipButton = iconButton('skip', 'ここから飛ばす', 'skip-button');
skipButton.hidden = true;
skipButton.addEventListener('click', () => {
  skipOnce = true;
  paused = false;
  mind.setPaused(false);
  mind.setFastForward(true);
  updatePlayback();
  skipButton.disabled = true;
});
const settingsButton = iconButton('gear', '設定', 'settings-button');
homeButton.hidden = true;
pauseButton.hidden = true;
stepButton.hidden = true;
hud.append(homeButton, pauseButton, stepButton, skipButton, settingsButton);

function updatePlayback() {
  pauseButton.innerHTML = ICONS[paused ? 'play' : 'pause'];
  pauseButton.setAttribute('aria-label', paused ? '再開' : '一時停止');
  pauseButton.title = paused ? '再開' : '一時停止';
  pauseButton.setAttribute('aria-pressed', String(paused));
  stepButton.disabled = !paused;
}
pauseButton.addEventListener('click', () => { paused = !paused; mind.setPaused(paused); updatePlayback(); });
stepButton.addEventListener('click', () => { if (paused) mind.stepOnce(); });
updatePlayback();

// ---- 設定。速さ、演出を飛ばす、音、最初からやり直す ----
const settings = document.createElement('dialog');
settings.className = 'settings';
const settingsTitle = document.createElement('h2');
settingsTitle.textContent = '設定';
settingsTitle.id = 'settings-title';
settings.setAttribute('aria-labelledby', settingsTitle.id);

function row(icon, text, control) {
  const label = document.createElement('label');
  label.className = 'settings-row';
  const pic = document.createElement('span');
  pic.className = 'settings-icon';
  pic.innerHTML = ICONS[icon];
  const name = document.createElement('span');
  name.className = 'settings-name';
  name.textContent = text;
  label.append(pic, name, control);
  return label;
}
function toggle(checked, onChange) {
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.addEventListener('change', () => onChange(box.checked));
  return box;
}
function range(min, max, step, value, onInput) {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => onInput(Number(input.value)));
  return input;
}

// 速さ（かめ ←→ うさぎ）
const slider = range(0, 9, 1, speedIndex, (value) => { speedIndex = value; updateSpeed(); saveUI(); });
slider.className = 'speed-slider';
slider.setAttribute('aria-label', '演出の速さ');
const speedRow = document.createElement('div');
speedRow.className = 'settings-row speed-row';
const slow = document.createElement('span');
slow.className = 'settings-icon';
slow.innerHTML = ICONS.turtle;
slow.title = 'ゆっくり';
const fast = document.createElement('span');
fast.className = 'settings-icon';
fast.innerHTML = ICONS.rabbit;
fast.title = 'はやい';
speedRow.append(slow, slider, fast);
function updateSpeed() {
  slider.setAttribute('aria-valuetext', `${speedIndex + 1} / 10、1 手順 ${SPEEDS[speedIndex]} ミリ秒`);
}
updateSpeed();
const skipBox = toggle(skip, (value) => { skip = value; saveUI(); });
skipBox.className = 'skip-box';

const playBox = document.createElement('div');
playBox.className = 'settings-group';
playBox.append(speedRow, row('skip', '演出を飛ばす', skipBox));

const soundBox = document.createElement('div');
soundBox.className = 'settings-group';
soundBox.append(
  row('music', '音楽', toggle(sound.settings.bgm, (value) => sound.set({ bgm: value }))),
  row('sfx', '効果音', toggle(sound.settings.sfx, (value) => sound.set({ sfx: value }))),
  row('sfx', '音量', range(0, 1, 0.05, sound.settings.volume, (value) => sound.set({ volume: value }))),
);

const resetButton = document.createElement('button');
resetButton.type = 'button';
resetButton.className = 'reset-button';
resetButton.textContent = '最初からやり直す';
resetButton.title = '育てた中身（集計表と短期記憶）をすべて消して、空の状態に戻します';
resetButton.addEventListener('click', reset);
const closeButton = iconButton('close', '閉じる', 'settings-close');
closeButton.addEventListener('click', () => settings.close());
settings.append(closeButton, settingsTitle, playBox, soundBox, resetButton);
settingsButton.addEventListener('click', () => settings.showModal());
// 外側（背景）を押しても閉じる
settings.addEventListener('click', (ev) => {
  const r = settings.getBoundingClientRect();
  if (ev.target === settings && (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom)) settings.close();
});

// 中: 3D の家（画面全体）
const stageRoot = document.createElement('section');

// 下: 部屋のものを押すと出る入力。演出中は隠す
const dock = document.createElement('div');
dock.className = 'dock';
dock.hidden = true;

app.replaceChildren(stageRoot, logo, hud, dock, settings);

// スマホでキーボードが出たとき、見えている範囲に画面を収める
if (window.visualViewport && matchMedia('(pointer: coarse)').matches) {
  const fit = () => {
    app.style.height = `${window.visualViewport.height}px`;
    window.scrollTo(0, 0);
  };
  window.visualViewport.addEventListener('resize', fit);
  window.visualViewport.addEventListener('scroll', fit);
}

const model = createModel();
const saved = load();
if (saved) model.restore(saved);

// 読み込み中からタイトルを表示し、部屋の操作は開始ボタンを押したあとに有効にする。
let started = false;
const titleScreen = document.createElement('section');
titleScreen.className = 'title-screen';
titleScreen.setAttribute('aria-labelledby', 'game-title');
const release = document.querySelector('meta[name="app-version"]')?.content ?? 'dev';
titleScreen.innerHTML = `<img class="title-art" src="./assets/journey-home.png?v=${release}" alt="青いマフラーのコトが、聞いたことばをかごに入れて家に帰る夕暮れの庭">
  <div class="title-motes" aria-hidden="true">${Array.from({ length: 12 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
  <div class="title-copy"><h1 id="game-title"><img class="title-logo" src="./assets/title-logo.png?v=${release}" alt="からっぽのコト"></h1></div>
  <div class="title-entry"><button class="title-start" type="button" disabled>おうちを準備しています…</button>
  <p class="title-status" role="status">まもなく、コトに会えます。</p></div>`;
app.append(titleScreen);
const startButton = titleScreen.querySelector('.title-start');
const titleStatus = titleScreen.querySelector('.title-status');
stageRoot.inert = true;
hud.inert = true;
logo.hidden = true;

let mind;
try {
  mind = await createStage(stageRoot, model);
} catch (e) {
  titleStatus.textContent = 'おうちを読み込めませんでした。通信を確認して、もう一度お試しください。';
  startButton.textContent = 'もう一度読み込む';
  startButton.disabled = false;
  startButton.addEventListener('click', () => location.reload());
  stageRoot.textContent = '3D の部屋を読み込めませんでした。通信を確認して、読み込み直してください。';
  throw e;
}
mind.syncMemory(model.shortMemory);

// ---- 操作の状態 ----
let busy = false;      // 演出中、または頭の中をのぞいている
let exploring = false;
let openPart = null;   // 開いている入力（'talk' | 'listen' | 'sleep' | null）
const partRoots = {};
const lessons = [['talk', 'コトと話す', 'talk'], ['listen', 'まちへ出かける', 'walk'], ['sleep', 'ひと休みする', 'sleep'], ['talk', 'もう一度話す', 'talk']];
const guideTarget = iconButton('talk', 'コト', 'tutorial-target');
app.append(guideTarget);
guideTarget.addEventListener('click', () => mind.triggerAction(model.tutorial.reflection ? 'journal' : lessons[model.tutorial.step]?.[0]));
function placeGuideTarget() {
  const lesson = model.tutorial.reflection ? ['journal', '観察ノートを読む', 'book'] : lessons[model.tutorial.step];
  guideTarget.hidden = !started || busy || openPart !== null || !lesson;
  if (guideTarget.hidden) return;
  const point = mind.hotPoint(lesson[0]);
  guideTarget.style.left = `${Math.max(90, Math.min(innerWidth - 90, point.x))}px`;
  guideTarget.style.top = `${Math.max(135, point.y - 86)}px`;
  if (guideTarget.getAttribute('aria-label') !== lesson[1]) {
    guideTarget.innerHTML = `${ICONS[lesson[2]]}<span>${lesson[1]}</span>`;
    guideTarget.setAttribute('aria-label', lesson[1]);
    guideTarget.title = lesson[1];
  }
}
window.addEventListener('resize', () => requestAnimationFrame(placeGuideTarget));
setInterval(placeGuideTarget, 100); // 散歩するコトにも操作目印がついていく。
function complete(action, reply) {
  if (lessons[model.tutorial.step]?.[0] === action) {
    const step = model.tutorial.step;
    model.tutorial.reflection = step === 0 ? (reply === '……' ? 'first-talk' : null)
      : step === 1 ? 'heard' : step === 2 ? 'slept' : (reply === '……' ? 'quiet' : 'replied');
    model.tutorial.step++;
    openPart = null;
  }
  if (action === 'sleep' && model.tutorial.step < 3) {
    model.tutorial.step = 3;
    model.tutorial.reflection = 'slept';
    openPart = null;
  }
}
function refresh() {
  placeGuideTarget();
  app.dataset.busy = String(busy);
  mind.setInteractive(started && !busy && openPart !== 'chips');
  dock.hidden = busy || openPart === null || openPart === 'chips';
  for (const [id, root] of Object.entries(partRoots)) root.hidden = id !== openPart;
  homeButton.hidden = !exploring;
  pauseButton.hidden = !busy || exploring;
  stepButton.hidden = !busy || exploring;
  skipButton.hidden = !busy || exploring;
  skipButton.disabled = skipOnce;
  stageRoot.inert = !started || openPart === 'chips';
  hud.hidden = openPart === 'chips';
  logo.hidden = !started || openPart === 'chips';
}

function setPart(id) {
  if (openPart === 'chips' && id !== 'chips') partRoots.chips.dispatchEvent(new Event('close'));
  openPart = id;
  refresh();
  if (id) partRoots[id].dispatchEvent(new Event('open'));
}

async function run(fn) {
  if (busy) return;
  busy = true;
  skipOnce = false;
  refresh();
  try {
    await fn();
  } finally {
    save(model);
    busy = false;
    skipOnce = false;
    mind.setFastForward(false);
    refresh();
  }
}

// トレースを再生する。「飛ばす」のときは再生せず、結果だけ画面に合わせる
async function show(trace, onSkip) {
  if (getStep() > 0) {
    await mind.play(trace, getStep);
  } else {
    onSkip?.();
    mind.syncMemory(model.shortMemory);
  }
}

// 最初からやり直す。セーブを消して読み込み直す
function reset() {
  if (!confirm('育てた中身をすべて消して、最初からやり直しますか？')) return;
  clear();
  location.reload();
}

// 頭の中をのぞく（集計表の全体をいつでも見られる）。黒板を押すと開き、家のボタンで閉じる
async function toggleExplore() {
  if (exploring ? homeButton.disabled : busy) return;
  homeButton.disabled = true;
  if (!exploring) {
    busy = true;
    exploring = true;
    refresh();
    await mind.toggleExplore();
  } else {
    await mind.toggleExplore();
    exploring = false;
    busy = false;
    refresh();
  }
  homeButton.disabled = false;
}
homeButton.addEventListener('click', toggleExplore);

const ctx = { model, mind, show, run, getStep, complete, close: () => setPart(null),
  acknowledge: () => { model.tutorial.reflection = null; save(model); refresh(); },
  changed: () => { save(model); mind.syncMemory(model.shortMemory); } };
for (const part of PARTS) {
  const root = document.createElement('section');
  root.className = `part ${part.id}`;
  root.hidden = true;
  part.create(root, ctx);
  partRoots[part.id] = root;
  (part.id === 'chips' ? app : dock).append(root);
}

// 部屋のものが押された。同じものをもう一度押すか、何もないところを押すと閉じる
mind.onAction((id) => {
  mind.showIdle();
  if (id === 'explore') {
    setPart(null);
    void toggleExplore();
  } else {
    setPart(id === openPart ? null : id);
    save(model); // 操作を切り替えるたびに保存する
  }
});
document.addEventListener('keydown', (ev) => {
  if (!started || ev.key !== 'Escape' || settings.open) return;
  if (exploring) void toggleExplore();
  else if (!busy) setPart(null);
});

startButton.textContent = saved ? 'つづきから' : 'はじめる';
titleStatus.textContent = saved ? 'コトとの暮らしは、ここからつづきます。' : '小さな出会いから、はじめよう。';
startButton.disabled = false;
startButton.addEventListener('click', () => {
  started = true;
  titleScreen.hidden = true;
  stageRoot.inert = false;
  hud.inert = false;
  logo.hidden = false;
  refresh();
  if (!guideTarget.hidden) guideTarget.focus({ preventScroll: true });
  else settingsButton.focus({ preventScroll: true });
});
refresh();

// コンソールから確認できるように公開する
window.kara = model;
window.karaPoint = mind.hotPoint;
