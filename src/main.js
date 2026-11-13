// 起動と画面切り替え

import { createModel } from './model/model.js';
import { createMind } from './ui/mind.js';
import { createTalk } from './ui/talk.js';
import { createListen } from './ui/listen.js';
import { createSleep } from './ui/sleep.js';

// 演出の速度。値は 1 手順あたりの待ち時間（ミリ秒）。0 は再生しない
const SPEEDS = [
  { id: 'slow', name: 'ゆっくり', step: 1000 },
  { id: 'normal', name: 'ふつう', step: 400 },
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
top.append(title, speedBox);

// 中: 頭の中
const mindRoot = document.createElement('section');

// 下: パートとタブ。演出中は fieldset ごと操作できなくする
const bottom = document.createElement('fieldset');
bottom.className = 'bottom';
const tabs = document.createElement('nav');
tabs.className = 'tabs';

app.replaceChildren(top, mindRoot, bottom);

const model = createModel();
const mind = createMind(mindRoot);

let busy = false;
async function run(fn) {
  if (busy) return;
  busy = true;
  bottom.disabled = true;
  try {
    await fn();
  } finally {
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

const ctx = { model, mind, show, run };
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
  });
  tabs.append(tab);
  return root;
});
bottom.append(...partRoots, tabs);
tabs.firstElementChild.click();

// コンソールから確認できるように公開する
window.kara = model;
