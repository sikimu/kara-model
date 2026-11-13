// 起動と画面切り替え

import { createModel } from './model/model.js';

const app = document.getElementById('app');

function showTitle() {
  const h1 = document.createElement('h1');
  h1.textContent = '空モデル育成ゲーム（仮）';
  app.replaceChildren(h1);
}

showTitle();

// コンソールから確認できるように公開する（画面ができるまでの仮）
window.kara = createModel();
