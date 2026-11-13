// 睡眠パート。短期記憶を再生して集計表を更新する。学習が起きるのはここだけ。

export function createSleep(root, { model, mind, show, run }) {
  root.classList.add('sleep');

  const hint = document.createElement('p');
  hint.className = 'part-hint';
  hint.textContent = '眠ると、夢の中で短期記憶の文を 1 つずつ思い出して、集計表の数字を増やす。短期記憶は空になる';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sleep-button';
  button.textContent = 'おやすみ';

  const card = document.createElement('div');
  card.className = 'sleep-card';
  const moon = document.createElement('span');
  moon.className = 'sleep-moon';
  moon.setAttribute('aria-hidden', 'true');
  moon.innerHTML = '<svg viewBox="0 0 100 80"><path d="M60 9A30 30 0 1 0 78 57 29 29 0 0 1 60 9Z" fill="#f8d990"/><path d="m80 12 2 6 6 2-6 2-2 6-2-6-6-2 6-2ZM24 8l2 4 4 2-4 2-2 4-2-4-4-2 4-2Z" fill="#fff4d0"/></svg>';
  const copy = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = '夢の中で、すこしずつ育つ。';
  copy.append(title, hint);
  card.append(moon, copy, button);
  root.replaceChildren(card);

  button.addEventListener('click', () => {
    run(async () => {
      const count = model.shortMemory.length;
      if (count === 0) {
        mind.say('短期記憶がからっぽ。眠っても何も変わらない');
        return;
      }
      const { trace } = model.sleep();
      await show(trace);
      mind.say(`ぐっすり眠った。${count} 文ぶん、おぼえた`);
    });
  });
}
