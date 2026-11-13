// 会話パート。入力欄と会話ログ。

import { EMPTY_REPLY } from '../model/model.js';

export function createTalk(root, { model, mind, show, run }) {
  root.classList.add('talk');

  const log = document.createElement('div');
  log.className = 'log';

  const form = document.createElement('form');
  form.className = 'talk-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '話しかける';
  input.maxLength = 40;
  input.autocomplete = 'off';
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = '話す';
  form.append(input, button);

  root.replaceChildren(log, form);

  function addLine(who, text) {
    const line = document.createElement('div');
    line.className = `log-line ${who}`;
    line.textContent = text;
    log.append(line);
    log.scrollTop = log.scrollHeight;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    run(async () => {
      input.value = '';
      addLine('you', text);

      const result = model.infer(text);
      await show(result.trace, () => mind.showIdle());
      addLine('kara', result.text);

      // やり取りは短期記憶に入る（無言の「……」は入れない）
      const heard = [...model.hear(text).trace];
      if (result.text !== EMPTY_REPLY) heard.push(...model.hear(result.text).trace);
      await show(heard);
    }).then(() => input.focus());
  });
}
