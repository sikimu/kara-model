// お出掛け。ドアを押すと出る。広場で話す人数とそれぞれの言葉を決めて、キャラクターに聞きに行かせる。
// 聞いた文は短期記憶にたまるだけで、集計表は変わらない。

import { ICONS, iconButton } from './icons.js';

const MAX_PEOPLE = 4;
const SAMPLES = [
  ['おはよう\nいいてんきだね', 'おはよう\nそうだね', 'やあ\nまたね', 'こんにちは'],
  ['こんにちは\nおはなだね', 'こんにちは\nきれいだね', 'いいにおい\nそうだね', 'またみにこよう\nまたね'],
  ['こんばんは\nおやすみ', 'おつきさまだ\nおやすみ', 'ほしもあるね\nまたあした', 'きらきらだね\nまたあした'],
];

export function createListen(root, { model, mind, show, run, complete, getStep, close }) {
  const invitation = document.createElement('div');
  invitation.className = 'listen-invitation';
  invitation.innerHTML = '<span class="listen-sign">お出掛けのしおり</span><h2>まちの ひろば</h2><p>お店の前で、だれかがおしゃべり。<br>まちの声に耳をすませてみよう。</p>';
  const help = document.createElement('p');
  help.className = 'listen-help';
  help.textContent = '人数と言葉を決めよう。1 行がひとこと。本のボタンでお手本も入るよ。';
  // 上の段: 話す人（押した人数まで話す）、お手本、聞きに行く
  const head = document.createElement('div');
  head.className = 'listen-head';
  const counts = document.createElement('div');
  counts.className = 'listen-counts';
  counts.setAttribute('role', 'group');
  counts.setAttribute('aria-label', '話す人数');
  const sample = iconButton('book', 'お手本を入れる', 'listen-sample');
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'listen-go';
  go.innerHTML = `${ICONS.walk}<span>お出掛けする</span>`;
  head.append(counts, sample, go);

  // 下の段: それぞれの言葉（1 行が 1 文）
  const people = document.createElement('div');
  people.className = 'listen-people';
  const areas = [];
  for (let i = 0; i < MAX_PEOPLE; i++) {
    const box = document.createElement('label');
    box.className = 'listen-person';
    box.style.setProperty('--person-color', mind.npcColors[i]);
    const face = document.createElement('span');
    face.className = 'person-icon';
    face.innerHTML = ICONS.person;
    const area = document.createElement('textarea');
    area.placeholder = SAMPLES[0][i];
    area.rows = 2;
    area.setAttribute('aria-label', `${i + 1} 人目の言葉（1 行ずつ順番に話す）`);
    const name = document.createElement('span');
    name.className = 'person-name';
    name.textContent = ['パン屋さん', '花屋さん', '散歩中の人', '旅の人'][i];
    const portrait = document.createElement('span');
    portrait.className = 'person-portrait';
    portrait.append(face, name);
    box.append(portrait, area);
    people.append(box);
    areas.push({ box, area });

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'person-icon';
    b.style.setProperty('--person-color', mind.npcColors[i]);
    b.innerHTML = ICONS.person;
    b.setAttribute('aria-label', `${i + 1} 人で話す`);
    b.title = `${i + 1} 人で話す`;
    b.addEventListener('click', () => setCount(i + 1));
    counts.append(b);
  }

  let count = 2;
  function setCount(n) {
    count = n;
    areas.forEach(({ box }, i) => { box.hidden = i >= n; });
    people.dataset.count = String(n);
    [...counts.children].forEach((b, i) => {
      b.classList.toggle('off', i >= n);
      b.setAttribute('aria-pressed', String(i + 1 === n));
    });
  }
  setCount(count);

  let sampleIndex = 0;
  sample.addEventListener('click', () => {
    areas.slice(0, count).forEach(({ area }, i) => { area.value = SAMPLES[sampleIndex][i]; });
    sampleIndex = (sampleIndex + 1) % SAMPLES.length;
  });

  root.replaceChildren(invitation, help, head, people);

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
      mind.say('今日は、どんなおしゃべり？');
      return;
    }

    close();
    run(async () => {
      if (getStep() === 0) {
        // 飛ばす: 聞いた結果だけ反映する
        model.hearDialogue(script);
        mind.showIdle();
        await show([]);
        complete('listen');
        return;
      }
      await mind.goListen(count, getStep);
      for (const { speaker, text } of script) {
        await mind.speak(speaker, text, [], getStep);
      }
      await show(model.hearDialogue(script).trace);
      await mind.comeBack(getStep);
      mind.syncMemory(model.shortMemory);
      complete('listen');
    });
  });
}
