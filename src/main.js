// 起動と画面切り替え

import { createModel } from './model/model.js';
import { createStage } from './ui/stage.js';
import { createTalk } from './ui/talk.js';
import { createListen } from './ui/listen.js';
import { createSleep } from './ui/sleep.js';
import { save, load, clear } from './save.js';
import { sound } from './ui/sound.js';

// 演出の速度。値は 1 手順あたりの待ち時間（ミリ秒）。0 は再生しない
const SPEEDS = [
  { id: 'slow', name: 'ゆっくり', step: 800 },
  { id: 'normal', name: 'ふつう', step: 300 },
  { id: 'skip', name: '飛ばす', step: 0 },
];
let speed = SPEEDS[1];

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
title.textContent = '空モデル育成ゲーム（仮）';
const speedBox = document.createElement('div');
speedBox.className = 'speed';
for (const s of SPEEDS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = s.name;
  b.setAttribute('aria-pressed', String(s === speed));
  b.addEventListener('click', () => {
    speed = s;
    pressOnly(speedBox, b);
  });
  speedBox.append(b);
}

// 設定（システム設定）。音と「最初からやり直す」
const settingsButton = document.createElement('button');
settingsButton.type = 'button';
settingsButton.className = 'settings-button';
settingsButton.textContent = '設定';
const settings = document.createElement('dialog');
settings.className = 'settings';
const settingsTitle = document.createElement('h2');
settingsTitle.textContent = '設定';
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

const topRight = document.createElement('div');
topRight.className = 'top-right';
topRight.append(speedBox, settingsButton);
top.append(title, topRight);

// 中: 3D の部屋
const stageRoot = document.createElement('section');

// 下: パートとタブ。演出中は fieldset ごと操作できなくする
const bottom = document.createElement('fieldset');
bottom.className = 'bottom';
const tabs = document.createElement('nav');
tabs.className = 'tabs';

app.replaceChildren(top, stageRoot, bottom, settings);

const model = createModel();
const saved = load();
if (saved) model.restore(saved);

bottom.disabled = true;
let mind;
try {
  mind = await createStage(stageRoot);
} catch (e) {
  stageRoot.textContent = '3D の部屋を読み込めませんでした。通信を確認して、読み込み直してください。';
  throw e;
}
mind.syncMemory(model.shortMemory);
bottom.disabled = false;

let busy = false;
async function run(fn) {
  if (busy) return;
  busy = true;
  bottom.disabled = true;
  try {
    await fn();
  } finally {
    save(model);
    bottom.disabled = false;
    busy = false;
  }
}

// トレースを再生する。「飛ばす」のときは再生せず、結果だけ画面に合わせる
async function show(trace, onSkip) {
  if (speed.step > 0) {
    await mind.play(trace, () => speed.step);
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

const ctx = { model, mind, show, run, getStep: () => speed.step };
const partRoots = PARTS.map((part) => {
  const root = document.createElement('section');
  root.classList.add('part');
  part.create(root, ctx);
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.textContent = part.name;
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
