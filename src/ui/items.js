// 部屋の小物から開く、観察ノート・ことばのかご・勉強用の本。
import { ICONS, iconButton } from './icons.js';
import { speakerLabel } from '../model/corpus.js';

const pages = [
  { title: 'はじめての声', icons: ['talk', 'empty'], note: 'まだ、ことばを知らないみたい。' },
  { title: 'まちで集めたもの', icons: ['walk', 'talk', 'basket'], note: '聞いたことばは、かごにひとまず。' },
  { title: 'ねむった夜', icons: ['basket', 'sleep', 'link'], note: '眠るあいだに、原本の本を書き直した。' },
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

// ことばのかご: 眠るまでの学習待ち。会話の本（長く残す）とは別
export function createMemory(root, { model, close }) {
  root.classList.add('item-view', 'memory-basket');
  header(root, 'ことばのかご', close);
  const note = document.createElement('p'); note.className = 'part-hint';
  const stack = document.createElement('div');
  stack.className = 'memory-stack';
  root.append(note, stack);
  root.addEventListener('open', () => {
    stack.replaceChildren();
    note.textContent = `眠るときに練習に使う会話。会話の本には ${model.book.conversations.length} / ${model.limits.conversations} 件を長く残しています。`;
    if (!model.pending.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-basket';
      empty.innerHTML = `${ICONS.basket}<span>いまは、からっぽ。</span>`;
      stack.append(empty);
    }
    model.pending.forEach((entry, i) => {
      const text = entry.turns.map(t => `${speakerLabel(t.speaker)}${t.source === 'koto' ? '（自分の返事）' : ''}　${t.text}`).join('\n');
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

// 勉強用の本: ことばのまとまり探し。会話できる状態からだけ始める
export function createStudy(root, { model, mind, show, run, close, inspector, persist }) {
  root.classList.add('item-view', 'study-book');
  header(root, 'ことばの まとまり探し', close);
  const cover = document.createElement('div'); cover.className = 'study-cover';
  cover.innerHTML = `<span class="journal-stamp">${ICONS.book}</span>`;
  const hint = document.createElement('p'); hint.className = 'part-hint';
  const last = document.createElement('p'); last.className = 'study-last';
  const buttons = document.createElement('div'); buttons.className = 'study-buttons';
  const start = document.createElement('button'); start.type = 'button'; start.className = 'study-start'; start.textContent = '勉強する';
  const review = document.createElement('button'); review.type = 'button'; review.className = 'study-review'; review.textContent = '前回の結果を見る';
  buttons.append(start, review);
  root.append(cover, hint, last, buttons);
  root.addEventListener('open', () => {
    const c = model.stats(), book = model.book.conversations.length;
    hint.textContent = `本に残っている ${book} / ${model.limits.conversations} 件の会話を読み返し、よく出る札の並びをひとまとまりにします。まとまり ${c.merges} / ${model.limits.merges}。文字は別枠（${c.chars} 種類）。`;
    start.disabled = book === 0;
    const s = model.progress.lastStudy;
    last.textContent = s ? (s.added?.length ? `前回: 「${s.added.map(m => m.text).join('」「')}」を登録` : s.code === 'full' ? '前回: 登録枠がいっぱいで追加なし' : '前回: 新しいまとまりはなし') : '';
    review.hidden = !s;
  });
  review.addEventListener('click', () => { const s = model.progress.lastStudy; if (s) inspector.openStudy({ ...s, sources: s.sources ?? [], added: s.added ?? [] }); });
  start.addEventListener('click', () => {
    close();
    run(async () => {
      const { result, trace, next } = model.study();
      await show(trace, () => mind.showIdle());
      if (next) {
        // 一組（対応表＋原本）の保存に成功してから切り替える。失敗したら前回の状態のまま
        if (persist(next.snapshot())) model.adopt(next); else result.code = 'save-failed';
      } else model.recordStudy(result);
      inspector.openStudy(result);
    });
  });
}
