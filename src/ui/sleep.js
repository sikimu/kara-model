// 睡眠。ベッドを押すと出る。短期記憶を再生して集計表を更新する。学習が起きるのはここだけ。

export function createSleep(root, { model, mind, show, run, complete, close, getStep }) {
  const moon = document.createElement('span');
  moon.className = 'sleep-moon';
  moon.setAttribute('aria-hidden', 'true');
  moon.innerHTML = '<svg viewBox="0 0 100 80"><path d="M60 9A30 30 0 1 0 78 57 29 29 0 0 1 60 9Z" fill="#f8d990"/><path d="m80 12 2 6 6 2-6 2-2 6-2-6-6-2 6-2ZM24 8l2 4 4 2-4 2-2 4-2-4-4-2 4-2Z" fill="#fff4d0"/></svg>';

  const hint = document.createElement('p');
  hint.className = 'part-hint';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sleep-button';
  button.textContent = 'おやすみ';

  root.replaceChildren(moon, hint, button);

  root.addEventListener('open', () => {
    const count = model.shortMemory.length;
    hint.textContent = count === 0
      ? 'まずはコトに話しかけるか、外へ聞きに行ってみよう'
      : '今日はここで、ひとやすみしようか。';
    button.disabled = count === 0;
  });

  button.addEventListener('click', () => {
    close();
    run(async () => {
      await mind.prepareSleep(getStep);
      try {
        const { trace } = await model.sleepAsync();
        await show(trace);
      } finally {
        await mind.finishSleep(getStep);
      }
      complete('sleep');
      mind.say('おはよう、コト。');
    });
  });
}
