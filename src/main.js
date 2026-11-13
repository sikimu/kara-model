// 起動と画面切り替え

import { createModel } from './model/model.js';
import { createStage } from './ui/stage.js';
import { createTalk } from './ui/talk.js';
import { createListen } from './ui/listen.js';
import { createSleep } from './ui/sleep.js';
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

const PARTS = [
  { id: 'talk', name: '会話', create: createTalk },
  { id: 'listen', name: '盗み聞き', create: createListen },
  { id: 'sleep', name: '睡眠', create: createSleep },
];

const app = document.getElementById('app');

function pressOnly(box, button) {
  for (const b of box.children) b.setAttribute('aria-pressed', String(b === button));
}

// 上: タイトルと速度
const top = document.createElement('header');
top.className = 'top';
const title = document.createElement('h1');
title.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 34V17" stroke="#587e4a" stroke-width="3" stroke-linecap="round"/><path d="M20 23C5 24 5 9 7 8c12 0 16 7 13 15Z" fill="#9bbd6a"/><path d="M20 18C19 7 29 3 35 5c0 10-6 16-15 13Z" fill="#638e50"/></svg><span>空モデル<small>育成ゲーム</small></span>';
const speedBox = document.createElement('div');
speedBox.className = 'speed';
const speedLabel = document.createElement('label');
speedLabel.className = 'speed-label';
speedLabel.innerHTML = '<span>ゆっくり <output></output> はやい</span>';
const slider = document.createElement('input');
slider.type = 'range';
slider.min = '0';
slider.max = '9';
slider.step = '1';
slider.value = String(speedIndex);
slider.setAttribute('aria-label', '演出の速度');
speedLabel.append(slider);
const skipButton = document.createElement('button');
skipButton.type = 'button';
skipButton.className = 'skip-button';
skipButton.textContent = '演出を飛ばす';
const pauseButton = document.createElement('button');
pauseButton.type = 'button';
pauseButton.className = 'pause-button';
pauseButton.disabled = true;
const stepButton = document.createElement('button');
stepButton.type = 'button';
stepButton.className = 'step-button';
stepButton.textContent = 'コマ送り';
function updatePlayback() {
  speedLabel.querySelector('output').textContent = `速さ ${speedIndex + 1} / 10`;
  slider.setAttribute('aria-valuetext', `${speedIndex + 1} / 10、1 手順 ${SPEEDS[speedIndex]} ミリ秒`);
  slider.style.setProperty('--progress', `${speedIndex / 9 * 100}%`);
  skipButton.setAttribute('aria-pressed', String(skip));
  pauseButton.textContent = paused ? '再開' : '一時停止';
  pauseButton.setAttribute('aria-pressed', String(paused));
  stepButton.disabled = !paused;
  stepButton.title = paused ? '1 手順だけ進める' : '一時停止すると使えます';
}
slider.addEventListener('input', () => { speedIndex = Number(slider.value); updatePlayback(); saveUI(); });
skipButton.addEventListener('click', () => { skip = !skip; updatePlayback(); saveUI(); });
pauseButton.addEventListener('click', () => { paused = !paused; mind.setPaused(paused); updatePlayback(); });
stepButton.addEventListener('click', () => { if (paused) mind.stepOnce(); });
updatePlayback();
speedBox.append(speedLabel, skipButton, pauseButton, stepButton);

// 設定（システム設定）。音と「最初からやり直す」
const settingsButton = document.createElement('button');
settingsButton.type = 'button';
settingsButton.className = 'settings-button';
settingsButton.textContent = '設定';
const settings = document.createElement('dialog');
settings.className = 'settings';
const settingsTitle = document.createElement('h2');
settingsTitle.textContent = '暮らしの設定';
settingsTitle.id = 'settings-title';
settings.setAttribute('aria-labelledby', settingsTitle.id);
// 音の設定
function soundToggle(text, key) {
  const label = document.createElement('label');
  label.className = 'settings-row';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = sound.settings[key];
  box.addEventListener('change', () => sound.set({ [key]: box.checked }));
  label.append(box, text);
  return label;
}
const volumeRow = document.createElement('label');
volumeRow.className = 'settings-row';
const volume = document.createElement('input');
volume.type = 'range';
volume.min = '0';
volume.max = '1';
volume.step = '0.05';
volume.value = String(sound.settings.volume);
volume.addEventListener('input', () => sound.set({ volume: Number(volume.value) }));
volumeRow.append('音量', volume);
const soundBox = document.createElement('div');
soundBox.className = 'settings-group';
soundBox.append(soundToggle('音楽', 'bgm'), soundToggle('効果音', 'sfx'), volumeRow);

const resetNote = document.createElement('p');
resetNote.textContent = '育てた中身（集計表と短期記憶）をすべて消して、空の状態に戻します。';
const resetButton = document.createElement('button');
resetButton.type = 'button';
resetButton.className = 'reset-button';
resetButton.textContent = '最初からやり直す';
resetButton.addEventListener('click', reset);
const closeButton = document.createElement('button');
closeButton.type = 'button';
closeButton.textContent = '閉じる';
closeButton.addEventListener('click', () => settings.close());
settings.append(settingsTitle, soundBox, resetNote, resetButton, closeButton);
settingsButton.addEventListener('click', () => settings.showModal());

// 頭の中をのぞく（集計表の全体をいつでも見られる）
const exploreButton = document.createElement('button');
exploreButton.type = 'button';
exploreButton.className = 'settings-button';
exploreButton.textContent = '頭の中を見る';
exploreButton.disabled = true;
exploreButton.addEventListener('click', async () => {
  if (exploreButton.dataset.open !== 'true' && busy) return;
  exploreButton.disabled = true;
  const open = await mind.toggleExplore();
  exploreButton.dataset.open = String(open);
  exploreButton.textContent = open ? '家にもどる' : '頭の中を見る';
  busy = open;
  bottom.disabled = open;
  exploreButton.disabled = false;
});

const topRight = document.createElement('div');
topRight.className = 'top-right';
topRight.append(exploreButton, speedBox, settingsButton);
top.append(title, topRight);

// 中: 3D の部屋
const stageRoot = document.createElement('section');

// 下: パートとタブ。演出中は fieldset ごと操作できなくする
const bottom = document.createElement('fieldset');
bottom.className = 'bottom';
bottom.setAttribute('aria-label', '空モデルのお世話');
const tabs = document.createElement('nav');
tabs.className = 'tabs';

app.replaceChildren(top, stageRoot, bottom, settings);

const model = createModel();
const saved = load();
if (saved) model.restore(saved);

bottom.disabled = true;
let mind;
try {
  mind = await createStage(stageRoot, model);
} catch (e) {
  stageRoot.textContent = '3D の部屋を読み込めませんでした。通信を確認して、読み込み直してください。';
  throw e;
}
mind.syncMemory(model.shortMemory);
pauseButton.disabled = false;
bottom.disabled = false;
exploreButton.disabled = false;

let busy = false;
async function run(fn) {
  if (busy) return;
  busy = true;
  bottom.disabled = true;
  exploreButton.disabled = true;
  try {
    await fn();
  } finally {
    save(model);
    bottom.disabled = false;
    exploreButton.disabled = false;
    busy = false;
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

const ctx = { model, mind, show, run, getStep };
const partRoots = PARTS.map((part) => {
  const root = document.createElement('section');
  root.classList.add('part');
  part.create(root, ctx);
  const tab = document.createElement('button');
  tab.type = 'button';
  const icon = document.createElement('span');
  icon.className = 'tab-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = { talk: '💬', listen: '👂', sleep: '☾' }[part.id];
  tab.append(icon, part.name);
  tab.addEventListener('click', () => {
    for (const r of partRoots) r.hidden = r !== root;
    pressOnly(tabs, tab);
    save(model); // パートを切り替えるたびに保存する
  });
  tabs.append(tab);
  return root;
});
bottom.append(...partRoots, tabs);
tabs.firstElementChild.click();

// コンソールから確認できるように公開する
window.kara = model;
