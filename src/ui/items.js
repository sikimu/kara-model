// 部屋の小物から開く、観察ノート・ことばのメモ・チップの木箱。
import { ICONS, iconButton } from './icons.js';

const pages = [
  { title: 'はじめての声', icons: ['talk', 'empty'], note: 'まだ、ことばを知らないみたい。' },
  { title: 'まちで集めたもの', icons: ['walk', 'talk', 'basket'], note: '聞いたことばは、かごにひとまず。' },
  { title: 'ねむった夜', icons: ['basket', 'sleep', 'link'], note: '眠るあいだに、ことばがつながった。' },
  { title: '朝のおしゃべり', icons: ['link', 'talk'], note: '覚えたことばで、おしゃべり。' },
];
const reflectionPage = { 'first-talk': 0, heard: 1, slept: 2, replied: 3, quiet: 3 };

function header(root, title, close) {
  const h = document.createElement('h2');
  h.textContent = title;
  const dismiss = iconButton('close', '閉じる', 'item-close');
  dismiss.addEventListener('click', close);
  root.append(h, dismiss);
}

export function createJournal(root, { model, close, acknowledge }) {
  root.classList.add('item-view', 'journal-book');
  header(root, 'コトの観察ノート', close);
  const tabs = document.createElement('nav');
  tabs.className = 'journal-tabs';
  tabs.setAttribute('aria-label', '見つけたこと');
  const paper = document.createElement('div');
  paper.className = 'journal-paper';
  const finish = document.createElement('button');
  finish.type = 'button';
  finish.className = 'journal-finish';
  finish.addEventListener('click', () => { acknowledge(); close(); });
  root.append(tabs, paper, finish);
  function render(index) {
    const unlocked = Math.min(4, model.tutorial.step);
    tabs.replaceChildren();
    for (let i = 0; i < 4; i++) {
      const b = iconButton(i < unlocked ? pages[i].icons[0] : 'book', i < unlocked ? pages[i].title : 'まだ白紙のページ');
      b.disabled = i >= unlocked;
      b.setAttribute('aria-pressed', String(i === index));
      b.addEventListener('click', () => render(i));
      tabs.append(b);
    }
    paper.replaceChildren();
    const heading = document.createElement('h3');
    const drawing = document.createElement('div');
    drawing.className = 'journal-drawing';
    const note = document.createElement('p');
    note.className = 'journal-note';
    if (unlocked === 0) {
      heading.textContent = 'まっしろなノート';
      drawing.innerHTML = `<span class="journal-stamp blank">${ICONS.book}</span>`;
      note.textContent = 'コトと過ごしたことを、ここに。';
    } else {
      const page = pages[index];
      heading.textContent = page.title;
      page.icons.forEach((icon, i) => {
        if (i) drawing.insertAdjacentHTML('beforeend', '<span class="journal-arrow" aria-hidden="true">→</span>');
        drawing.insertAdjacentHTML('beforeend', `<span class="journal-stamp">${ICONS[icon]}</span>`);
      });
      note.textContent = index === 3 && model.tutorial.reflection === 'quiet' ? 'きょうの返事は、まだひみつ。' : page.note;
    }
    paper.append(heading, drawing, note);
    finish.textContent = model.tutorial.reflection ? 'しおりをはさむ' : 'ノートを閉じる';
  }
  root.addEventListener('open', () => render(reflectionPage[model.tutorial.reflection] ?? Math.max(0, Math.min(3, model.tutorial.step - 1))));
}

export function createMemory(root, { model, close }) {
  root.classList.add('item-view', 'memory-basket');
  header(root, 'ことばのかご', close);
  const stack = document.createElement('div');
  stack.className = 'memory-stack';
  root.append(stack);
  root.addEventListener('open', () => {
    stack.replaceChildren();
    if (!model.shortMemory.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-basket';
      empty.innerHTML = `${ICONS.basket}<span>いまは、からっぽ。</span>`;
      stack.append(empty);
    }
    model.shortMemory.forEach((text, i) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'word-slip';
      card.style.setProperty('--tilt', `${i % 2 ? 2 : -2}deg`);
      card.textContent = text;
      card.setAttribute('aria-label', `${i + 1}枚目のことば: ${text}`);
      card.setAttribute('aria-pressed', 'false');
      card.addEventListener('click', () => {
        const selected = card.getAttribute('aria-pressed') === 'true';
        card.setAttribute('aria-pressed', String(!selected));
      });
      stack.append(card);
    });
  });
}

export function createChips(root, { model, close, changed }) {
  root.classList.add('item-view', 'chip-tray');
  header(root, 'ことばのチップ箱', close);
  const socket = document.createElement('div');
  socket.className = 'chip-socket';
  const choices = document.createElement('div');
  choices.className = 'chip-choices';
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', '選び方チップ');
  const names = ['いつものサイコロ', 'あたたかいサイコロ'];
  const icons = ['chip', 'temperature'];
  const buttons = model.samplers.map((chip, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chip-piece chip-piece-${i}`;
    button.dataset.chip = chip.id;
    button.innerHTML = `${ICONS[icons[i]]}<span>${names[i]}</span>`;
    button.addEventListener('click', () => { model.setSampler(chip.id); sync(); changed(); });
    choices.append(button);
    return button;
  });
  const heat = document.createElement('label');
  heat.className = 'chip-heat';
  const temperature = document.createElement('input');
  temperature.type = 'range';
  temperature.min = '0.25'; temperature.max = '2'; temperature.step = '0.25';
  temperature.setAttribute('aria-label', '温度');
  const cool = document.createElement('span'); cool.textContent = 'いつもの';
  const warm = document.createElement('span'); warm.textContent = 'いろいろ';
  heat.append(cool, temperature, warm);
  temperature.addEventListener('input', () => { model.setSampler(model.chips.sampler.id, Number(temperature.value)); sync(); changed(); });
  root.append(socket, choices, heat);
  function sync() {
    const index = model.samplers.indexOf(model.chips.sampler);
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
    socket.innerHTML = `<span>${ICONS[icons[index]]}</span><small>いま、ついているチップ</small>`;
    heat.hidden = index === 0;
    temperature.value = String(model.options.temperature);
    temperature.setAttribute('aria-valuetext', `温度 ${model.options.temperature}`);
  }
  root.addEventListener('open', sync);
  sync();
}
