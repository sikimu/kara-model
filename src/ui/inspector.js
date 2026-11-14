// 本の中身を開く画面。右下のアイテム欄から作業用バインダーを、部屋の本棚から原本を開く。
// 開いている間は再生を止める（stage.js が pause 理由 'inspect' を管理する）。数値はマウスオーバー／タップで出す。
// ここでは計算をしない。トレース（v.stages）と原本（model.net）の値を写すだけ。

import { iconButton } from './icons.js';
import { tokenLabel, CONTROL } from '../model/vocabulary.js';

const ROOM_BOOKS = [
  { room: 0, title: '文字の本と順番の本', parameters: ['embed', 'pos'], role: '文字（とまとまり・目印）ごとに d 個、順番ごとに d 個の数が記録されています。①で写して足し、計算の材料にします。' },
  { room: 1, title: '②の本（見くらべる）', parameters: ['q', 'k'], role: '「どの札を見るか」を決める 2 つの表です。材料の数に掛けて、見る側（Q）と見られる側（K）の数を作ります。' },
  { room: 2, title: '③の本（まぜる）', parameters: ['v', 'o'], role: '札から取り分ける情報を作る表（V）と、まぜた結果を整える表（O）です。' },
  { room: 3, title: '④の部屋', parameters: [], role: 'この部屋には原本がありません。①（2層め以降はその層の入力）の数に、③の結果を足すだけです。' },
  { room: 4, title: '⑤の本（しぼる）', parameters: ['f1', 'f2'], role: '数を MLP の幅に広げる表（F1）と、しぼったあとで d 個に戻す表（F2）です。' },
  { room: 5, title: '出力の本', parameters: ['out', 'bias'], role: '文字ごとに d 個の数と 1 つの下駄（バイアス）があり、手がかりの数と掛け合わせて点をつけます。' },
];
const PARAM_LABEL = { embed: '文字の本', pos: '順番の本', q: 'Q（見る側）', k: 'K（見られる側）', v: 'V（取り分け）', o: 'O（整える）', f1: 'F1（広げる）', f2: 'F2（戻す）', out: '出力の本', bias: 'バイアス' };
const PAGE = 12;

export function createInspector(app, model) {
  const dialog = document.createElement('dialog');
  dialog.className = 'inspect-view';
  const close = iconButton('close', '閉じる', 'item-close');
  const title = document.createElement('h2');
  const role = document.createElement('p'); role.className = 'inspect-role';
  const body = document.createElement('div'); body.className = 'inspect-body';
  const foot = document.createElement('p'); foot.className = 'inspect-foot';
  foot.textContent = '数の 1 つ 1 つに「色」や「気持ち」のような決まった意味が割り当てられているわけではありません。最初の値があることは「学習済み」という意味ではなく、学習で少しずつ直します。マウスを乗せる／タップで値を見られます。';
  dialog.append(close, title, role, body, foot);
  app.append(dialog);
  const listeners = { open: [], close: [] };
  const emit = name => listeners[name].forEach(fn => fn());
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => emit('close'));
  dialog.addEventListener('click', (ev) => { if (ev.target === dialog) dialog.close(); });
  const show = () => { if (!dialog.open) { dialog.showModal(); emit('open'); } };
  const signed = x => `${x < 0 ? '−' : '+'}${Math.abs(x).toFixed(3)}`;

  // 数の列。箱の色は符号、濃さは大きさ。値はホバー／タップで出す
  function cells(values, prefix = '', max = null) {
    const row = document.createElement('div'); row.className = 'num-row';
    const scale = max ?? Math.max(1e-6, ...values.map(Math.abs));
    values.forEach((x, j) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = `num-cell ${x < 0 ? 'neg' : 'pos'}`;
      b.style.setProperty('--amount', String(Math.min(1, Math.abs(x) / scale)));
      b.title = `${prefix}${j + 1}個め: ${signed(x)}`; b.setAttribute('aria-label', b.title);
      b.addEventListener('click', () => { row.querySelectorAll('.num-cell.show').forEach(c => c.classList.remove('show')); b.classList.add('show'); b.dataset.value = signed(x); });
      row.append(b);
    });
    return row;
  }
  function section(heading, note = '') {
    const s = document.createElement('section'); s.className = 'inspect-section';
    const h = document.createElement('h3'); h.textContent = heading; s.append(h);
    if (note) { const p = document.createElement('p'); p.textContent = note; s.append(p); }
    return s;
  }

  // 作業用バインダー: 見開きで「元の情報」と「現在の情報」
  function openBinder(v) {
    const stages = (v.stages ?? []).filter(Boolean);
    const d = model.config.dim;
    title.textContent = '作業用バインダー';
    role.textContent = `今回の計算に必要な情報だけを綴じたバインダーです。左は①で数に変えたときの元の情報、右はいま計算を進めている現在の情報。原本（棚の本）は別で、推論ではこちらだけを書き直します。1 ページは ${d}個の数の組です。`;
    body.replaceChildren();
    if (!stages.length) { const p = document.createElement('p'); p.textContent = 'まだページがありません。ことばが届いて①の部屋を通ると、ページができます。'; body.append(p); return show(); }
    const spread = document.createElement('div'); spread.className = 'binder-spread';
    const left = section('元の情報（①で写した数）', `文字の本の数 ＋ 順番の本の数。${d}個と${d}個を同じ位置どうしで足して${d}個（並べて${d * 2}個にする意味ではありません）。`);
    const first = stages.find(s => s.room === 0);
    if (first?.entries) {
      const list = document.createElement('div'); list.className = 'binder-pages';
      first.entries.forEach((e, i) => {
        const page = document.createElement('div'); page.className = `binder-page${i === first.entries.length - 1 ? ' current' : ''}`;
        const h = document.createElement('h4'); h.textContent = `${i + 1}番 「${tokenLabel(e.token)}」`;
        page.append(h, cells(e.values, `「${tokenLabel(e.token)}」${i + 1}番の`));
        list.append(page);
      });
      left.append(list);
    }
    const right = section('現在の情報（最後の位置）', '部屋を通るごとに書き直されます。最後の位置の情報から、次の札の候補に点をつけます。');
    const latest = stages.filter(s => s.kind !== 'score' && s.room !== 1 && s.room !== 2);
    const groups = new Map();
    for (const s of stages) {
      const key = s.layer == null ? (s.room === 0 ? '①' : '⑥') : `${s.layer + 1}層め`;
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(s);
    }
    for (const [key, list] of groups) {
      const box = document.createElement('div'); box.className = 'binder-page';
      const h = document.createElement('h4'); h.textContent = key; box.append(h);
      for (const s of list) {
        const p = document.createElement('p'); p.className = 'binder-line';
        const name = { add: s.room === 0 ? '① 写して足した' : '④ たしなおした', match: '② 見る割合', mix: '③ まぜた結果', gate: '⑤ しぼった結果', score: '⑥ 点をつける手がかり', tune: s.label }[s.kind ?? 'tune'];
        p.textContent = name; box.append(p);
        if (s.kind === 'match') {
          (s.heads ?? [{ weights: s.weights }]).forEach((hd, hi) => { const q = document.createElement('p'); q.className = 'binder-note'; q.textContent = `ヘッド${hi + 1}: ${s.tokens.map((t, i) => `${tokenLabel(t)} ${(hd.weights[i] * 100).toFixed(0)}%`).join(' ・ ')}`; box.append(q); });
        } else if (s.kind === 'gate') { box.append(cells(s.values, 'しぼった後 ')); const q = document.createElement('p'); q.className = 'binder-note'; q.textContent = `MLP の幅は ${s.values.length}。このあと ${d}個に戻して足します。`; box.append(q); box.append(cells(s.after, '2回目の残差の後 ')); }
        else if (s.values) box.append(cells(s.values, `${name} `));
      }
      right.append(box);
    }
    void latest;
    spread.append(left, right);
    body.append(spread);
    show();
  }

  // 原本: 部屋の本棚から開く。層とページ（文字）を切り替える
  function openBook(roomIndex, layer = 0) {
    const info = ROOM_BOOKS[roomIndex];
    const net = model.net, vocab = model.vocab, cfg = model.config;
    title.textContent = info.title + (info.parameters.length && roomIndex !== 0 && roomIndex !== 5 ? `　${layer + 1}層め / ${cfg.layers}` : '');
    role.textContent = `${info.role} 学習で調整・保存する原本です。推論では持ち出さず、必要な行だけを写します。`;
    body.replaceChildren();
    if (roomIndex !== 0 && roomIndex !== 5 && info.parameters.length) {
      const tabs = document.createElement('nav'); tabs.className = 'inspect-tabs';
      for (let l = 0; l < cfg.layers; l++) { const b = document.createElement('button'); b.type = 'button'; b.textContent = `${l + 1}層め`; b.setAttribute('aria-pressed', String(l === layer)); b.addEventListener('click', () => openBook(roomIndex, l)); tabs.append(b); }
      body.append(tabs);
    }
    for (const key of info.parameters) {
      const name = roomIndex === 0 || roomIndex === 5 ? key : `${layer}.${key}`;
      const p = net.params[name]; if (!p) continue;
      const s = section(PARAM_LABEL[key], `${p.rows} 行 × ${p.cols} 列。合計 ${p.x.length.toLocaleString()} 個の数。`);
      const rows = p.rows, scale = Math.max(1e-6, ...Array.from(p.x.subarray(0, Math.min(p.x.length, 4096))).map(Math.abs));
      let page = 0;
      const table = document.createElement('div'); table.className = 'book-rows';
      const pager = document.createElement('div'); pager.className = 'book-pager';
      const render = () => {
        table.replaceChildren();
        for (let r = page * PAGE; r < Math.min(rows, (page + 1) * PAGE); r++) {
          const line = document.createElement('div'); line.className = 'book-row';
          const head = document.createElement('span'); head.className = 'book-head';
          head.textContent = key === 'embed' || key === 'out' || key === 'bias' ? `${r + 1}: ${tokenLabel(vocab.textOf(key === 'bias' ? 0 : r))}${key === 'bias' ? '' : vocab.kindOf(r) === 'merge' ? '（まとまり）' : r < CONTROL.length ? '（目印）' : ''}` : key === 'pos' ? `${r + 1}番め` : `${r + 1}行め`;
          if (key === 'bias') head.textContent = '全文字の下駄';
          line.append(head, cells(Array.from(p.x.subarray(r * p.cols, (r + 1) * p.cols)), `${head.textContent} `, scale));
          table.append(line);
        }
        pager.replaceChildren();
        if (rows > PAGE) {
          const prev = document.createElement('button'); prev.type = 'button'; prev.textContent = '前のページ'; prev.disabled = page === 0; prev.addEventListener('click', () => { page--; render(); });
          const label = document.createElement('span'); label.textContent = `${page * PAGE + 1}〜${Math.min(rows, (page + 1) * PAGE)} / ${rows}`;
          const next = document.createElement('button'); next.type = 'button'; next.textContent = '次のページ'; next.disabled = (page + 1) * PAGE >= rows; next.addEventListener('click', () => { page++; render(); });
          pager.append(prev, label, next);
        }
      };
      render();
      s.append(table, pager);
      body.append(s);
    }
    if (!info.parameters.length) { const p = document.createElement('p'); p.textContent = '原本はありません。'; body.append(p); }
    show();
  }

  // 勉強の結果
  function openStudy(result) {
    title.textContent = 'ことばの まとまり探しの結果';
    const codes = { added: `新しいまとまりを ${result.added.length} つ登録しました。`, 'no-material': '本に会話が残っていないので、何も調べられませんでした。', 'no-candidate': '2 回以上ならぶ新しい組は見つかりませんでした。追加はありません。', full: `まとまりの登録枠（${result.limit}）がいっぱいなので、新しいまとまりは追加できません。既存のまとまりは消しません。`, 'save-failed': '保存に失敗したので、今回の追加は取り消しました。前回の状態のままです。' };
    role.textContent = `${codes[result.code] ?? ''}${result.code === 'added' && result.full ? ` これで登録枠（${result.limit}）がいっぱいになりました。` : ''} まとまりは ${result.merges ?? 0} / ${result.limit}。文字は別の枠なので、まとまりが満杯でも新しい文字は登録できます。`;
    body.replaceChildren();
    if (result.added.length) {
      const s = section('今回見つけたまとまり', '意味を覚えたのではなく、よく出る並びをひとまとまりで読めるようにしました。使い方は、これからの学習で育ちます。');
      const list = document.createElement('ul'); list.className = 'study-list';
      for (const m of result.added) {
        const li = document.createElement('li'), strong = document.createElement('strong');
        strong.textContent = `「${m.text}」`;
        li.append(strong, document.createTextNode(` ＝ 「${m.parts[0]}」＋「${m.parts[1]}」　${m.count} 回ならんでいた`));
        list.append(li);
      }
      s.append(list); body.append(s);
    }
    if (result.sources?.length) {
      const s = section('元になった会話', 'コト自身が作った返事は、数えるときに除いています。');
      const list = document.createElement('ul'); list.className = 'study-list';
      for (const c of result.sources) { const li = document.createElement('li'); li.textContent = c.text; list.append(li); }
      s.append(list); body.append(s);
    }
    show();
  }

  return { openBinder, openBook, openStudy, close: () => { if (dialog.open) dialog.close(); }, get isOpen() { return dialog.open; }, on(name, fn) { listeners[name].push(fn); }, ROOM_BOOKS };
}
