// 起動と画面切り替え

const app = document.getElementById('app');

function showTitle() {
  const h1 = document.createElement('h1');
  h1.textContent = '空モデル育成ゲーム（仮）';
  app.replaceChildren(h1);
}

showTitle();
