// 頭の中パネル。モデルが返したトレースを順に再生する。
// 上段は場面（推論 / 学習）、下段は短期記憶。

import { MEMORY_CAPACITY } from '../model/model.js';

const END_TEXT = {
  eos: '■ が出たので、おしまい',
  empty: '棚がからっぽ。何も言えない',
  limit: '30 文字になったので、打ち切り',
};

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMind(root) {
  root.classList.add('mind');
  const stage = el('div', 'stage');
  const memLabel = el('div', 'mind-label');
  const memList = el('div', 'memory');
  const memBox = el('div', 'memory-box');
  memBox.append(memLabel, memList);
  root.replaceChildren(stage, memBox);

  let scene = null; // 今の場面の部品
  let memItems = []; // 短期記憶の表示 [{ text, el }]

  function updateMemLabel() {
    memLabel.textContent = `短期記憶（${memItems.length} / ${MEMORY_CAPACITY} 文）`;
  }

  function addMemItem(text) {
    const item = { text, el: el('span', 'memory-item', text) };
    memItems.push(item);
    memList.append(item.el);
    updateMemLabel();
    return item;
  }

  // 演出なしで短期記憶の表示を合わせる
  function syncMemory(list) {
    memList.replaceChildren();
    memItems = [];
    for (const text of list) addMemItem(text);
    updateMemLabel();
  }

  // 場面を消して 1 行のメッセージを出す
  function say(text) {
    scene = null;
    stage.replaceChildren(el('div', 'mind-idle', text));
  }

  function showIdle() {
    say('頭の中（話しかけると動きます）');
  }

  function startInferScene() {
    const heard = el('div', 'tokens');
    const walk = el('div', 'walk');
    const kid = el('div', 'kid');
    walk.append(kid);
    const shelf = el('div', 'shelf');
    const dice = el('div', 'dice');
    const out = el('div', 'out');
    const end = el('div', 'end');
    stage.replaceChildren(
      el('div', 'mind-label', '聞いた言葉'), heard,
      walk,
      el('div', 'mind-label', '棚（集計表）'), shelf, dice,
      el('div', 'mind-label', '口から出る言葉'), out, end,
    );
    scene = { type: 'infer', heard, kid, shelf, dice, out, end, rows: [] };
  }

  function startSleepScene() {
    const recall = el('div', 'recall');
    const walk = el('div', 'walk');
    const kid = el('div', 'kid');
    walk.append(kid);
    const shelf = el('div', 'shelf');
    stage.replaceChildren(
      el('div', 'mind-label', '思い出している文'), recall,
      walk,
      el('div', 'mind-label', '棚（集計表）'), shelf,
    );
    scene = { type: 'sleep', recall, kid, shelf };
  }

  // trace を順に再生する。getStep() は 1 手順あたりの待ち時間（ミリ秒）を返す
  async function play(trace, getStep) {
    for (const ev of trace) {
      const step = getStep();
      switch (ev.type) {
        // ---- 推論 ----
        case 'tokenize':
          startInferScene();
          for (const t of ev.tokens) {
            scene.heard.append(el('span', 'token', t));
            await wait(step * 0.2);
          }
          await wait(step * 0.5);
          break;

        case 'lookup': {
          if (scene?.type !== 'infer') startInferScene();
          const { kid, shelf, dice } = scene;
          kid.classList.remove('at-shelf');
          shelf.replaceChildren();
          dice.replaceChildren();
          await wait(step * 0.4);
          kid.classList.add('at-shelf');
          await wait(step * 0.6);
          shelf.append(el('div', 'shelf-key', `「${ev.key}」の次に来る文字`));
          if (!ev.found) shelf.append(el('div', 'shelf-empty', '（からっぽ）'));
          await wait(step * 0.6);
          break;
        }

        case 'probs': {
          if (scene?.type !== 'infer') break;
          const bars = el('div', 'bars');
          scene.rows = ev.candidates.map((c) => {
            const row = el('div', 'bar-row');
            const track = el('div', 'bar-track');
            const fill = el('div', 'bar-fill');
            track.append(fill);
            row.append(
              el('span', 'bar-token', c.token),
              track,
              el('span', 'bar-num', `${c.count}回 ${Math.round(c.p * 100)}%`),
            );
            bars.append(row);
            return { token: c.token, p: c.p, row, fill };
          });
          scene.shelf.append(bars);
          await wait(30); // 幅 0 を一度描かせてから伸ばす
          for (const r of scene.rows) r.fill.style.width = `${r.p * 100}%`;
          await wait(step);
          break;
        }

        case 'pick': {
          if (scene?.type !== 'infer') break;
          const { rows, dice } = scene;
          const strip = el('div', 'strip');
          const segs = rows.map((r) => {
            const seg = el('div', 'strip-seg', r.token);
            seg.style.width = `${r.p * 100}%`;
            strip.append(seg);
            return seg;
          });
          const needle = el('div', 'needle');
          strip.append(needle);
          const num = el('div', 'dice-num', 'サイコロをふる…');
          dice.replaceChildren(strip, num);
          await wait(30);
          needle.style.left = `${ev.r * 100}%`;
          await wait(step * 0.7);
          num.textContent = `サイコロ: ${ev.r.toFixed(2)} → 「${ev.token}」`;
          const i = rows.findIndex((r) => r.token === ev.token);
          if (i >= 0) {
            rows[i].row.classList.add('picked');
            segs[i].classList.add('picked');
          }
          await wait(step);
          break;
        }

        case 'emit':
          if (scene?.type !== 'infer') break;
          scene.out.append(el('span', '', ev.token));
          await wait(step * 0.6);
          break;

        case 'end':
          if (scene?.type !== 'infer') break;
          scene.end.textContent = END_TEXT[ev.reason] ?? '';
          await wait(step * 0.6);
          break;

        // ---- 短期記憶 ----
        case 'hear': {
          const item = addMemItem(ev.text);
          item.el.classList.add('new');
          await wait(step * 0.8);
          item.el.classList.remove('new');
          break;
        }

        case 'forget': {
          const i = memItems.findIndex((m) => m.text === ev.text);
          if (i < 0) break;
          const [item] = memItems.splice(i, 1);
          item.el.classList.add('gone');
          await wait(step * 0.8);
          item.el.remove();
          updateMemLabel();
          break;
        }

        // ---- 学習 ----
        case 'replay': {
          if (scene?.type !== 'sleep') startSleepScene();
          const item = memItems.find((m) => m.text === ev.text);
          if (item) item.el.classList.add('replaying');
          scene.recall.textContent = ev.text;
          scene.shelf.replaceChildren();
          scene.kid.classList.remove('at-shelf');
          await wait(step);
          break;
        }

        case 'count': {
          if (scene?.type !== 'sleep') startSleepScene();
          const { kid, shelf } = scene;
          kid.classList.add('at-shelf');
          const cell = el('div', 'count-cell');
          const num = el('span', 'count-num', String(ev.before));
          cell.append(el('span', 'bar-token', ev.token), num, el('span', 'count-unit', '回'));
          shelf.replaceChildren(el('div', 'shelf-key', `「${ev.key}」の次に来る文字`), cell);
          await wait(step * 0.6);
          num.textContent = String(ev.after);
          num.classList.add('changed');
          await wait(step * 0.8);
          break;
        }

        default:
          // 知らない type は無視する
          break;
      }
      stage.scrollTop = stage.scrollHeight;
    }
  }

  showIdle();
  updateMemLabel();
  return { play, say, showIdle, syncMemory };
}
