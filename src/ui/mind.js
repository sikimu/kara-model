// 頭の中パネル。モデルが返したトレースを順に再生する。

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

  function showIdle() {
    root.replaceChildren(el('div', 'mind-idle', '頭の中（話しかけると動きます）'));
  }

  // trace を順に再生する。getStep() は 1 手順あたりの待ち時間（ミリ秒）を返す
  async function play(trace, getStep) {
    const heard = el('div', 'tokens');
    const walk = el('div', 'walk');
    const kid = el('div', 'kid');
    walk.append(kid);
    const shelf = el('div', 'shelf');
    const dice = el('div', 'dice');
    const out = el('div', 'out');
    const end = el('div', 'end');
    root.replaceChildren(
      el('div', 'mind-label', '聞いた言葉'), heard,
      walk,
      el('div', 'mind-label', '棚（集計表）'), shelf, dice,
      el('div', 'mind-label', '口から出る言葉'), out, end,
    );

    let rows = [];
    for (const ev of trace) {
      const step = getStep();
      switch (ev.type) {
        case 'tokenize':
          for (const t of ev.tokens) {
            heard.append(el('span', 'token', t));
            await wait(step * 0.2);
          }
          await wait(step * 0.5);
          break;

        case 'lookup': {
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
          const bars = el('div', 'bars');
          rows = ev.candidates.map((c) => {
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
          shelf.append(bars);
          await wait(30); // 幅 0 を一度描かせてから伸ばす
          for (const r of rows) r.fill.style.width = `${r.p * 100}%`;
          await wait(step);
          break;
        }

        case 'pick': {
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
          out.append(el('span', '', ev.token));
          await wait(step * 0.6);
          break;

        case 'end':
          end.textContent = END_TEXT[ev.reason] ?? '';
          await wait(step * 0.6);
          break;

        default:
          // 知らない type は無視する
          break;
      }
      root.scrollTop = root.scrollHeight;
    }
  }

  showIdle();
  return { play, showIdle };
}
