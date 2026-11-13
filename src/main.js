// 起動と画面切り替え

import { createModel } from './model/model.js';
import { createMind } from './ui/mind.js';
import { createTalk } from './ui/talk.js';

// 演出の速度。値は 1 手順あたりの待ち時間（ミリ秒）。0 は再生しない
const SPEEDS = [
  { id: 'slow', name: 'ゆっくり', step: 1000 },
  { id: 'normal', name: 'ふつう', step: 400 },
  { id: 'skip', name: '飛ばす', step: 0 },
];
let speed = SPEEDS[1];

const app = document.getElementById('app');

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
    for (const other of speedBox.children) other.setAttribute('aria-pressed', String(other === b));
  });
  speedBox.append(b);
}
top.append(title, speedBox);

const mindRoot = document.createElement('section');
const talkRoot = document.createElement('section');
app.replaceChildren(top, mindRoot, talkRoot);

const model = createModel();
const mind = createMind(mindRoot);
createTalk(talkRoot, { model, mind, getStep: () => speed.step });

// コンソールから確認できるように公開する
window.kara = model;
