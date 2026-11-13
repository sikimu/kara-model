// 会話パート。入力欄と会話ログ。

import { EMPTY_REPLY } from '../model/model.js';

export function createTalk(root, { model, mind, getStep }) {
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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || input.disabled) return;

    input.value = '';
    input.disabled = true;
    button.disabled = true;
    addLine('you', text);

    const result = model.infer(text);
    const step = getStep();
    if (step > 0) {
      await mind.play(result.trace, getStep);
    } else {
      mind.showIdle(); // 飛ばす: トレースを再生せず結果だけ使う
    }
    addLine('kara', result.text);

    // やり取りは短期記憶に入る（無言の「……」は入れない）
    model.hear(text);
    if (result.text !== EMPTY_REPLY) model.hear(result.text);

    input.disabled = false;
    button.disabled = false;
    input.focus();
  });
}
