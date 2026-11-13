// 起動と画面切り替え
// 画面は 3D の家だけ。部屋のもの（キャラクター・ドア・ベッド・黒板）を押すと、
// その操作の入力が下に出る。設定は右上の歯車にまとめる。

import { createModel } from './model/model.js';
import { createStage } from './ui/stage.js';
import { createTalk } from './ui/talk.js';
import { createListen } from './ui/listen.js';
import { createSleep } from './ui/sleep.js';
import { ICONS, iconButton } from './ui/icons.js';
import { save, load, clear } from './save.js';
import { sound } from './ui/sound.js';

// 演出の速度。値は 1 手順あたりの待ち時間（ミリ秒）。0 は再生しない
const SPEEDS = Array.from({ length: 10 }, (_, i) => Math.round(1600 * (80 / 1600) ** (i / 9)));
let speedIndex = 5;
let skip = false;
let paused = false;
try {
  const stored = JSON.parse(localStorage.getItem('kara-model-ui'));
  if (Number.isInteger(stored?.speedIndex) && stored.speedIndex >= 0 && stored.speedIndex < 10) speedIndex = stored.speedIndex;
  if (typeof stored?.skip === 'boolean') skip = stored.skip;
} catch { /* 保存を使えなくても遊べる */ }
const getStep = () => skip ? 0 : SPEEDS[speedIndex];
function saveUI() {
  try { localStorage.setItem('kara-model-ui', JSON.stringify({ speedIndex, skip })); } catch { /* 保存は任意 */ }
}

// 部屋のものを押すと開く入力。explore（黒板）は入力を持たず、頭の中の画面を開く
const PARTS = [
  { id: 'talk', create: createTalk },
  { id: 'listen', create: createListen },
  { id: 'sleep', create: createSleep },
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
const settingsButton = iconButton('gear', '設定', 'settings-button');
homeButton.hidden = true;
pauseButton.hidden = true;
stepButton.hidden = true;
hud.append(homeButton, pauseButton, stepButton, settingsButton);

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

let mind;
try {
  mind = await createStage(stageRoot, model);
} catch (e) {
  stageRoot.textContent = '3D の部屋を読み込めませんでした。通信を確認して、読み込み直してください。';
  throw e;
}
mind.syncMemory(model.shortMemory);

// ---- 操作の状態 ----
let busy = false;      // 演出中、または頭の中をのぞいている
let exploring = false;
let openPart = null;   // 開いている入力（'talk' | 'listen' | 'sleep' | null）
const partRoots = {};
const lessons = [
  ['talk', 'はじめての会話', '「おはよう」と話しかけよう。まだ言葉を知らないので、返事は「……」。', '話しかける'],
  ['listen', 'まちで言葉を聞こう', 'お手本を入れて聞きに行こう。聞いた言葉は、まだ一時的な記憶だよ。', '聞きに行く準備'],
  ['sleep', '眠ると、おぼえる', 'ベッドでおやすみ。夢の中で聞いた言葉を思い出して、初めて学習するよ。', 'ベッドへ'],
  ['talk', 'おはよう、もう一度', '初めての朝。もう一度話しかけて、眠る前と返事を比べてみよう。', 'もう一度話す'],
];
const guide = document.createElement('aside');
guide.className = 'tutorial';
guide.setAttribute('aria-live', 'polite');
const guideTitle = document.createElement('strong');
const guideText = document.createElement('p');
const guideButton = document.createElement('button');
guideButton.type = 'button';
guideButton.addEventListener('click', () => setPart(lessons[model.tutorial.step][0]));
guide.append(guideTitle, guideText, guideButton);
app.append(guide);
function complete(action) {
  if (lessons[model.tutorial.step]?.[0] === action) {
    model.tutorial.step++;
    openPart = null;
  }
  if (action === 'sleep' && model.tutorial.step < 3) model.tutorial.step = 3;
}
const chipGroup = document.createElement('div');
chipGroup.className = 'settings-group chip-settings';
const chipTitle = document.createElement('h3');
chipTitle.textContent = '選び方チップ';
const chipSelect = document.createElement('select');
chipSelect.setAttribute('aria-label', '選び方チップ');
for (const chip of model.samplers) chipSelect.add(new Option(chip.name, chip.id));
chipSelect.value = model.chips.sampler.id;
const chipHint = document.createElement('p');
const temperature = range(0.25, 2, 0.25, model.options.temperature, updateChip);
temperature.setAttribute('aria-label', '温度');
const temperatureLabel = document.createElement('label');
const temperatureValue = document.createElement('span');
temperatureLabel.append(temperatureValue, temperature);
function updateChip() {
  if (busy) return;
  model.setSampler(chipSelect.value, Number(temperature.value));
  syncChip();
  save(model);
}
function syncChip() {
  chipHint.textContent = model.chips.sampler.description;
  temperatureLabel.hidden = model.chips.sampler.id !== 'sampler-temperature';
  temperatureValue.textContent = `温度 ${model.options.temperature.toFixed(2)}（低い ← → 高い）`;
}
chipSelect.addEventListener('change', updateChip);
chipGroup.append(chipTitle, chipSelect, chipHint, temperatureLabel);
settings.insertBefore(chipGroup, resetButton);
syncChip();

function refresh() {
  const lesson = lessons[model.tutorial.step];
  guide.hidden = busy || !lesson || openPart !== null;
  if (lesson) {
    guideTitle.textContent = `はじめの一日 · ${model.tutorial.step + 1} / 4　${lesson[1]}`;
    guideText.textContent = lesson[2];
    guideButton.textContent = lesson[3];
  }
  chipSelect.disabled = busy;
  temperature.disabled = busy;
  app.dataset.busy = String(busy);
  mind.setInteractive(!busy);
  dock.hidden = busy || openPart === null;
  for (const [id, root] of Object.entries(partRoots)) root.hidden = id !== openPart;
  homeButton.hidden = !exploring;
  pauseButton.hidden = !busy || exploring;
  stepButton.hidden = !busy || exploring;
}

function setPart(id) {
  openPart = id;
  refresh();
  if (id) partRoots[id].dispatchEvent(new Event('open'));
}

async function run(fn) {
  if (busy) return;
  busy = true;
  refresh();
  try {
    await fn();
  } finally {
    save(model);
    busy = false;
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

const ctx = { model, mind, show, run, getStep, complete, close: () => setPart(null) };
for (const part of PARTS) {
  const root = document.createElement('section');
  root.className = `part ${part.id}`;
  root.hidden = true;
  part.create(root, ctx);
  partRoots[part.id] = root;
  dock.append(root);
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
  if (ev.key !== 'Escape' || settings.open) return;
  if (exploring) void toggleExplore();
  else if (!busy) setPart(null);
});

refresh();

// コンソールから確認できるように公開する
window.kara = model;
window.karaPoint = mind.hotPoint;
