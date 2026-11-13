// 睡眠パート。短期記憶を再生して集計表を更新する。学習が起きるのはここだけ。

export function createSleep(root, { model, mind, show, run }) {
  root.classList.add('sleep');

  const hint = document.createElement('p');
  hint.className = 'part-hint';
  hint.textContent = '眠ると、夢の中で短期記憶の文を 1 つずつ思い出して、集計表の数字を増やす。短期記憶は空になる';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sleep-button';
  button.textContent = '眠らせる';

  root.replaceChildren(hint, button);

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
