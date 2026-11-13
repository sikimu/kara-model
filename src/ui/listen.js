// 盗み聞きパート。広場で話す人数とそれぞれの言葉を決めて、キャラクターに聞きに行かせる。
// 聞いた文は短期記憶にたまるだけで、集計表は変わらない。

import { MEMORY_CAPACITY } from '../model/model.js';

const MAX_PEOPLE = 4;
const SAMPLES = ['おはよう\nいいてんきだね', 'おはよう\nそうだね', 'やあ\nまたね', 'こんにちは'];

export function createListen(root, { model, mind, show, run, getStep }) {
  root.classList.add('listen');

  const head = document.createElement('div');
  head.className = 'listen-head';
  const label = document.createElement('span');
  label.textContent = '話す人数';
  const counts = document.createElement('div');
  counts.className = 'listen-counts';
  const hint = document.createElement('span');
  hint.className = 'part-hint';
  hint.textContent = `1 行ずつ順番にお話。記憶は ${MEMORY_CAPACITY} 文まで`;
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'listen-go';
  go.textContent = '聞きに行く';
  const sample = document.createElement('button');
  sample.type = 'button';
  sample.className = 'listen-sample';
  sample.textContent = 'お手本を入れる';
  head.append(label, counts, hint, sample, go);

  const people = document.createElement('div');
  people.className = 'listen-people';
  const areas = [];
  for (let i = 0; i < MAX_PEOPLE; i++) {
    const box = document.createElement('label');
    box.className = 'listen-person';
    box.style.setProperty('--person-color', mind.npcColors[i]);
    const name = document.createElement('span');
    name.textContent = `${i + 1} 人目`;
    name.style.borderColor = mind.npcColors[i];
    const area = document.createElement('textarea');
    area.placeholder = SAMPLES[i];
    box.append(name, area);
    people.append(box);
    areas.push({ box, area });
  }

  let count = 2;
  function setCount(n) {
    count = n;
    areas.forEach(({ box }, i) => { box.hidden = i >= n; });
    [...counts.children].forEach((b, i) => b.setAttribute('aria-pressed', String(i + 1 === n)));
  }
  for (let n = 1; n <= MAX_PEOPLE; n++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${n} 人`;
    b.addEventListener('click', () => setCount(n));
    counts.append(b);
  }
  setCount(count);
  const samples = [
    SAMPLES,
    ['こんにちは\nおはなだね', 'こんにちは\nきれいだね', 'いいにおい\nそうだね', 'またみにこよう\nまたね'],
    ['こんばんは\nおやすみ', 'おつきさまだ\nおやすみ', 'ほしもあるね\nまたあした', 'きらきらだね\nまたあした'],
  ];
  let sampleIndex = 0;
  sample.addEventListener('click', () => {
    areas.slice(0, count).forEach(({ area }, i) => { area.value = samples[sampleIndex][i]; });
    sampleIndex = (sampleIndex + 1) % samples.length;
  });

  root.replaceChildren(head, people);

  go.addEventListener('click', () => {
    // 1 人目の 1 文目、2 人目の 1 文目、…、1 人目の 2 文目、… の順に話す
    const lines = areas.slice(0, count)
      .map(({ area }) => area.value.split('\n').map((s) => s.trim()).filter(Boolean));
    const script = [];
    for (let k = 0; lines.some((l) => k < l.length); k++) {
      lines.forEach((l, speaker) => {
        if (k < l.length) script.push({ speaker, text: l[k] });
      });
    }
    if (script.length === 0) {
      mind.say('話す言葉を入れてください');
      return;
    }

    run(async () => {
      if (getStep() === 0) {
        // 飛ばす: 聞いた結果だけ反映する
        for (const { text } of script) model.hear(text);
        mind.showIdle();
        await show([]);
        return;
      }
      await mind.goListen(count, getStep);
      for (const { speaker, text } of script) {
        await mind.speak(speaker, text, model.hear(text).trace, getStep);
      }
      await mind.comeBack(getStep);
      mind.syncMemory(model.shortMemory);
    });
  });
}
