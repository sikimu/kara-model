// 会話。キャラクターを押すと出る、吹き出しの入力と、直前のやり取り。

import { EMPTY_REPLY } from '../model/model.js';
import { iconButton } from './icons.js';

const LOG_LINES = 4; // 見せておくやり取りの数（会話ログは保存しない）

export function createTalk(root, { model, mind, show, run }) {
  const log = document.createElement('div');
  log.className = 'log';
  log.setAttribute('role', 'log');
  log.setAttribute('aria-label', '空モデルとの会話');

  const form = document.createElement('form');
  form.className = 'talk-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'ねえ、きょうはどんな気分？';
  input.setAttribute('aria-label', '空モデルに話しかける言葉');
  input.maxLength = 40;
  input.autocomplete = 'off';
  input.enterKeyHint = 'send';
  const button = iconButton('send', '話す', 'send-button');
  button.type = 'submit';
  const bubble = document.createElement('div');
  bubble.className = 'input-bubble';
  bubble.append(input);
  form.append(bubble, button);

  root.replaceChildren(log, form);

  function addLine(who, text) {
    const line = document.createElement('div');
    line.className = `log-line ${who}`;
    line.setAttribute('aria-label', `${who === 'kara' ? '空モデル' : 'あなた'}: ${text}`);
    if (who === 'kara') {
      const face = document.createElement('span');
      face.className = 'kara-face';
      face.setAttribute('aria-hidden', 'true');
      face.textContent = '•ᴗ•';
      line.append(face);
    }
    const message = document.createElement('span');
    message.textContent = text;
    line.append(message);
    log.append(line);
    while (log.children.length > LOG_LINES) log.firstElementChild.remove();
  }

  // 開いたら、すぐ打てるようにする（スマホではキーボードが画面を隠すので、押すまで出さない）
  const focus = () => { if (matchMedia('(pointer: fine)').matches) input.focus(); };
  root.addEventListener('open', focus);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    run(async () => {
      input.value = '';
      input.blur();
      addLine('you', text);

      const result = model.infer(text);
      await show(result.trace, () => mind.showIdle());
      addLine('kara', result.text);

      // やり取りは短期記憶に入る（無言の「……」は入れない）
      const heard = [...model.hear(text).trace];
      if (result.text !== EMPTY_REPLY) heard.push(...model.hear(result.text).trace);
      await show(heard);
    }).then(focus);
  });
}
