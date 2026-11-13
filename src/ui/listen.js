// 盗み聞きパート。文章を聞かせて短期記憶にためる（集計表は変えない）。

import { MEMORY_CAPACITY } from '../model/model.js';

export function createListen(root, { model, mind, show, run }) {
  root.classList.add('listen');

  const hint = document.createElement('p');
  hint.className = 'part-hint';
  hint.textContent = `1 行が 1 文。おぼえていられるのは ${MEMORY_CAPACITY} 文まで。眠るまで返事は変わらない`;

  const form = document.createElement('form');
  form.className = 'listen-form';
  const area = document.createElement('textarea');
  area.placeholder = 'おはよう\nおやすみ';
  area.rows = 4;
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = '聞かせる';
  form.append(area, button);

  root.replaceChildren(hint, form);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const lines = area.value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) return;

    run(async () => {
      area.value = '';
      mind.say('耳をすませている…');
      const trace = lines.flatMap((line) => model.hear(line).trace);
      await show(trace);
    });
  });
}
