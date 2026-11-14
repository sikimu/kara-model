// 頭の中の画面。推論・学習・勉強のあいだ、画面全体をこれに切り替える。
// three.js の 3D の建物（neural-view.js）を描き、ここではトレースの再生手順（どの部屋へ行き、何を運び、どこで止まるか）を決める。
// 2D の canvas は、もわもわ（場面転換の雲）と 3D の転写に使う。

import { sound } from './sound.js';
import { END, MAX_OUTPUT } from '../model/model.js';
import { tokenLabel } from '../model/vocabulary.js';
import { createNeuralView, travelLength } from './neural-view.js';
import { createVisitGuide } from './neural-explanation.js';

export { MAX_OUTPUT };
const END_TEXT = { eos: 'おしまい', empty: 'ことばは、まだ眠っている', limit: 'ひと息つこう' };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createMindView(root, room, model, inspector) {
  const canvas = document.createElement('canvas');
  canvas.className = 'mind-view';
  root.append(canvas);
  const neuralView = createNeuralView(room, canvas, model, inspector);
  const g = canvas.getContext('2d');
  let W = 1, H = 1;
  function resize() {
    W = Math.max(1, root.clientWidth); H = Math.max(1, root.clientHeight);
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(resize).observe(root);
  resize();

  // ---- 画面の状態 ----
  let reveal = 0;          // もわもわの進み具合（0: 閉じている、1: 全面）
  let origin = { x: 0, y: 0 };
  let clock = 0;
  let v = fresh('explore');
  function fresh(mode) {
    return { mode, phase: null, heard: null, source: [], sourceAt: 0, inboxText: '', contextCards: [], stages: [], operation: null, rows: [], visibleRows: [], out: [], endText: '', losses: [], head: 0, newPages: [] };
  }
  const stats = () => model.stats();

  // もわもわ（考えごとの雲）の形
  function cloudPath(cx, cy, r) {
    g.beginPath();
    g.moveTo(cx + r * 0.75, cy);
    g.arc(cx, cy, r * 0.75, 0, Math.PI * 2);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2 + clock * 0.4, br = r * (0.3 + 0.05 * Math.sin(clock * 3 + i * 1.7));
      const bx = cx + Math.cos(a) * r * 0.72, by = cy + Math.sin(a) * r * 0.72;
      g.moveTo(bx + br, by); g.arc(bx, by, br, 0, Math.PI * 2);
    }
  }
  function draw() {
    g.clearRect(0, 0, W, H);
    if (reveal <= 0) return;
    neuralView.draw(g, v, W, H, clock);
    if (reveal >= 1) return;
    const side = origin.x > W / 2 ? -1 : 1;
    const cx = clamp(origin.x + side * 90, 80, W - 80), cy = clamp(origin.y - 170, 80, H - 80);
    const far = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy));
    const k = clamp((reveal - 0.42) / 0.58, 0, 1), r = k <= 0 ? 0 : 46 + k * k * far * 1.45;
    g.globalCompositeOperation = 'destination-in';
    if (r > 0) { cloudPath(cx, cy, r); g.fill(); } else g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = '#fff';
    if (r > 0) { cloudPath(cx, cy, r + 7); g.fill(); }
    [[0.04, 26, 30, 8], [0.16, 50, 66, 13], [0.28, 74, 112, 19]].forEach(([at, dx, dy, size], i) => {
      const bk = clamp((reveal - at) / 0.12, 0, 1) * (1 - clamp((reveal - 0.7) / 0.2, 0, 1));
      if (bk <= 0) return;
      g.beginPath(); g.arc(origin.x + side * dx, origin.y - dy + Math.sin(clock * 4 + i) * 2, size * bk * bk * (3 - 2 * bk), 0, Math.PI * 2);
      g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#c9cfe6'; g.lineWidth = 2; g.stroke();
    });
    g.globalCompositeOperation = 'source-over';
  }
  room.onFrame(draw);

  // ---- 開く、閉じる ----
  let ambientRun = 0, ambientStep = 300, lastCards = null;
  const visitGuide = createVisitGuide();
  const sfx = (name, step, param) => { if (step > 0) sound.play(name, param); };
  async function breathe(run) {
    while (run === ambientRun && reveal > 0) {
      const start = clock;
      await room.tween(ambientStep * 4, (k) => { if (run === ambientRun) clock = start + k; }, true);
    }
  }
  // mode: 'infer' | 'learn' | 'explore' | 'study'。from は雲が出てくる場所（画面上の位置）
  async function open(mode, from, ms) {
    visitGuide.reset();
    root.classList.add('mind-active');
    v = fresh(mode);
    if (mode === 'explore' && lastCards) Object.assign(v, structuredClone(lastCards));
    resize();
    neuralView.open(mode);
    origin = from ?? { x: W / 2, y: H / 2 };
    canvas.style.pointerEvents = 'auto';
    sfx('moya', ms);
    await room.tween(ms, (k) => { reveal = k; });
    reveal = 1;
    void breathe(++ambientRun);
  }
  async function close(ms) {
    // 開き直したときに見せる札とページ。バインダーのページは、最後の推論のものを残す
    if (v.mode !== 'explore') {
      lastCards = { ...lastCards, ...Object.fromEntries(['source', 'sourceAt', 'contextCards', 'inboxText', 'out', 'newPages'].map(key => [key, structuredClone(v[key])])) };
      if (v.mode === 'infer' && v.stages?.some(Boolean)) Object.assign(lastCards, { stages: structuredClone(v.stages), completedStage: v.completedStage });
    }
    ambientRun++;
    canvas.style.pointerEvents = 'none';
    await room.tween(ms, (k) => { reveal = 1 - k; });
    reveal = 0;
    root.classList.remove('mind-active');
    neuralView.close();
  }

  // ---- トレースの再生 ----
  // step は 1 手順の時間（ミリ秒）。gate は一時停止・コマ送りの待ち。isPaused は机上の動きも止めるため。
  // getStep があれば毎フレーム読み、動いている途中でも速さの変更と「飛ばす」が効く
  async function handle(ev, step, gate = async () => {}, isPaused = () => false, getStep = null) {
    ambientStep = step > 0 ? step : ambientStep;
    canvas.dataset.phase = ev.type;
    v.phase = ev.type;
    const stepNow = () => (getStep ? getStep() : step);
    // units は手順数。一時停止中は進まず、飛ばすときはすぐ終わる
    const animate = async (units, fn = () => {}) => {
      if (units <= 0 || room.fastForward || stepNow() === 0) { fn(1); return; }
      let k = 0, last = performance.now();
      while (k < 1) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const now = performance.now(), s = stepNow();
        if (room.fastForward || s === 0) k = 1; else if (!isPaused()) k = Math.min(1, k + (now - last) / (units * s));
        last = now;
        fn(k);
      }
    };
    // 2 トークンめ以降と 2 層め以降、学習の途中の周回は同じ作業なので短く進める（計算結果は同じ）
    const quickTour = v.mode === 'infer' ? v.out.length > 0 : v.mode === 'learn' ? ev.epoch > 1 && ev.epoch < (ev.epochs ?? 12) : false;
    let carried = false;
    // 歩く時間は道のりに合わせる。札はまとめて手に持って運べる
    const strides = (from, to) => 2 + Math.min(7, travelLength(from, to) / 4.5);
    // 入室ごとに 1 回だけ止めて説明する。同じ部屋の次の作業はそのまま続ける
    let skipping = false;
    // always: 短縮した周回でも止める（各周の終わりの 1 回だけ）
    const hold = async (note = null, always = false) => {
      if (skipping || stepNow() === 0 || !neuralView.detail) return;
      if (always ? false : (quickTour || !visitGuide.take())) return;
      v.holdNote = note;
      const reason = await neuralView.waitNext();
      v.holdNote = null;
      if (reason === 'skip' || reason === 'close') skipping = true;
    };
    const walkTo = async (to) => {
      const at = v.courier?.tos?.at(-1) ?? v.courier?.to;
      if (!at || JSON.stringify(at) === JSON.stringify(to)) { visitGuide.enter(to, v.layer); return; }
      v.courier = { token: null, from: at, to, k: 0 };
      canvas.dataset.carry = 'walking';
      await animate(strides(at, to) * (quickTour ? .5 : 1), k => { v.courier.k = k; });
      visitGuide.enter(to, v.layer);
    };
    const carryMany = async (tokens, froms, tos) => {
      if (carried) await gate();
      carried = true;
      await walkTo(froms[0]);
      const pack = tokens.length > 1 ? .3 : .2;
      v.courier = { tokens, froms, tos, k: 0 };
      await animate((strides(froms.at(-1), tos[0]) + 1 + Math.min(tokens.length, 12) * .25), k => {
        v.courier.k = k;
        canvas.dataset.carry = k < pack ? 'packing' : k > 1 - pack ? 'unpacking' : 'walking';
        if (!(canvas.dataset.carrySeen ?? '').includes(canvas.dataset.carry)) canvas.dataset.carrySeen = `${canvas.dataset.carrySeen ?? ''} ${canvas.dataset.carry}`;
      });
      v.courier = { token: null, from: tos.at(-1), to: tos.at(-1), k: 1 };
      visitGuide.enter(tos.at(-1), v.layer);
      delete canvas.dataset.carry;
    };
    const said = tokens => tokens.map(tokenLabel).join('・');
    const carry = (token, from, to) => token == null ? walkTo(to) : carryMany([token], [from], [to]);
    const perRow = () => neuralView.cardsPerRow;
    // ポストから札をまとめて運び、ならべる部屋の机へ聞いた順に直接置く（机の端に仮置きしない）。
    // 1 列（24 まい）がいっぱいになったら、先の列を端へ詰めて束にしてから続きを置く
    const placeCards = async (tokens, offset, fromIndex = 0) => {
      const per = perRow();
      for (let at = 0; at < tokens.length;) {
        const base = offset + at, chunk = tokens.slice(at, at + Math.min(tokens.length - at, per - base % per, 12));
        if (base > 0 && base % per === 0) {
          v.stackPacking = { start: base - per, k: 0 };
          await animate(2, k => { v.stackPacking.k = k; });
          v.stackPacking = null;
        }
        await carryMany(chunk, chunk.map((_, i) => ({ lane: 'heard', index: (fromIndex + at + i) % 24 })), chunk.map((_, i) => ({ lane: 'attention', index: base + i })));
        chunk.forEach((token, j) => { v.contextCards[base + j] = token; });
        at += chunk.length;
        v.sourceAt = fromIndex + at;
      }
    };
    // 部屋をまわる。推論は ①→(②③④⑤)×層→⑥。学習は はずれの知らせを持って ⑥→…→①
    const operate = async (stages, order = stages.map((_, i) => i)) => {
      v.stages = []; v.completedStage = -1;
      const seenRooms = new Set(); // 動作確認用: この巡回で通った部屋
      for (const i of order) {
        const stage = stages[i];
        // 入室の区切り: 層ごと。学習では同じ部屋の当てっこと本の書き直しを別の入室として説明する
        v.layer = stage.layer ?? (v.mode === 'learn' ? 'book' : null);
        v.carrying = v.mode === 'learn' ? 'note' : 'binder';
        await walkTo({ lane: 'work', index: stage.room });
        delete canvas.dataset.carry;
        v.carrying = null;
        await gate();
        v.stages[i] = stage; v.operation = { index: i, k: 0, room: stage.room, layer: stage.layer };
        canvas.dataset.operation = String(stage.room);
        canvas.dataset.stage = String(i);
        seenRooms.add(stage.room); canvas.dataset.roomsSeen = [...seenRooms].sort().join('');
        if (stage.layer != null) canvas.dataset.layer = String(stage.layer); else delete canvas.dataset.layer;
        await hold();
        // 本を開いて写す／書き直す。2層め以降・2トークンめ以降は同じ作業なので早く進める
        const quick = quickTour || (stage.layer != null && stage.layer > 0);
        await animate((quickTour ? 1.5 : quick ? 3 : 5), k => { v.operation.k = k; });
        if (v.mode === 'learn') { v.returning = { room: stage.room, k: 0 }; await animate((quickTour ? 1 : 2), k => { v.returning.k = k; }); v.returning = null; }
        v.completedStage = i;
        v.courier = { token: null, from: { lane: 'work', index: stage.room }, to: { lane: 'work', index: stage.room }, k: 1 };
        v.operation = null; delete canvas.dataset.operation; delete canvas.dataset.stage;
      }
      v.layer = null;
    };

    if (ev.type === 'register') {
      // 初見の文字: 文字の本に新しいページを足す（登録であって、学習ではない）
      v.newPages = [...(v.newPages ?? []), ...ev.tokens];
      v.registering = { tokens: ev.tokens, k: 0 };
      await walkTo({ lane: 'work', index: 0 });
      await hold({ title: `はじめて見る文字「${said(ev.tokens)}」`, body: `文字の本に「${said(ev.tokens)}」のページを足しました。ページの ${model.config.dim}個の数は、まだ小さなでたらめの値です。意味を覚えたのではなく、計算に使う場所を用意しただけです。`, detail: '文字の登録と、お手本から数を学習することは別の作業です。文字は、まとまりの登録数とは別の枠に入ります。' });
      await animate(3, k => { v.registering.k = k; });
      v.registering = null;
    }
    if (ev.type === 'tokenize') {
      v.heard = []; v.source = []; v.sourceAt = 0;
      if (ev.tokens.length) {
        visitGuide.enter({ lane: 'entrance' });
        v.arriving = true; v.inboxText = ev.text ?? ev.tokens.join('');
        await hold({ title: '玄関のポストに、あなたのことばが届いた', body: `「${v.inboxText}」を受け取りました。元のことばはポストに残し、その写しの札を使って返事の準備をします。`, detail: 'つぎへ進むと、コトがポストから札を取り出して運びます。' });
        v.arriving = false;
      }
      v.heard = [...ev.tokens]; v.source = [...ev.tokens];
    }
    if (ev.type === 'attention') {
      const first = !v.attention;
      v.attention = ev; v.rows = []; v.visibleRows = []; v.workToken = null; v.lottery = null; v.picked = null;
      v.config = ev.config; v.window = ev.window;
      const last = ev.tokens.length - 1;
      if (first) {
        v.source = ev.tokens; v.sourceAt = 0; v.contextCards = [];
        await placeCards(ev.tokens, 0, 0);
        await hold({ title: 'ならべる 部屋: 聞いた ことばを 順番に 置いた', body: `届いたことばを札にして、聞いた順に並べました（${said(ev.tokens)}）。「はじまり」「あなた」「交代」「コト」は、だれがいつ話したかを表す札です。コトはこの並び全体を手がかりにして、続きを 1 つずつ考えます。`, detail: `${ev.tokens.length}まいの札。1まいが計算の単位（トークン）です。まとまりを登録していれば、複数の文字が 1 まいになることもあります。` });
      } else {
        v.contextCards = ev.tokens.slice(0, -1);
        await carry(ev.tokens[last], { lane: 'output', index: Math.max(0, v.out.length - 1) }, { lane: 'attention', index: last });
        v.contextCards.push(ev.tokens[last]);
        await hold({ title: `いま出した「${tokenLabel(ev.tokens[last])}」を 文脈に 足した`, body: '返事として出した札も、文脈のいちばん後ろに並べます。次の札は、聞いたことばと、ここまでに自分が出した札の両方を見て決めます。', detail: `文脈は ${ev.tokens.length}まいになりました。` });
      }
      // 札をまとめて①の装置へ。ページに変えてバインダーへ綴じる
      v.attentionFocus = last;
      // 2 トークンめ以降は、いま足した札だけを持って①へ（ほかのページはバインダーに綴じてある）
      const batch = first ? ev.tokens.map((_, i) => i) : [last];
      await carryMany(batch.map(i => ev.tokens[i]), batch.map(i => ({ lane: 'attention', index: i })), batch.map(() => ({ lane: 'work', index: 0 })));
      v.attentionFocus = null;
      v.binderPages = ev.tokens.length;
      await operate(ev.stages ?? []);
    }
    if (ev.type === 'probs') {
      v.rows = []; v.visibleRows = []; v.picked = null;
      const rows = [...ev.candidates].sort((a, b) => b.p - a.p).slice(0, 5);
      await carryMany(rows.map(r => r.token), rows.map((_, slot) => ({ lane: 'work', index: 5, slot, count: rows.length })), rows.map((_, index) => ({ lane: 'candidates', index })));
      v.visibleRows = [...rows]; v.rows = ev.candidates; v.share = 0;
      canvas.dataset.share = 'growing';
      await animate(5, k => { v.share = k; });
      delete canvas.dataset.share;
      await hold({ title: '点を 確率に なおした', body: `⑥でつけた点を、全部足すと100%になる割合に直しました。いちばん高いのは「${tokenLabel(rows[0].token)}」の ${(rows[0].p * 100).toFixed(1)}% です。この割合の幅でルーレットを回します。`, detail: `表示は上位${rows.length}つ。ルーレットには ${ev.candidates.length} 個すべての候補が乗ります。` });
    }
    if (ev.type === 'pick') {
      await walkTo({ lane: 'roulette' });
      delete canvas.dataset.carry;
      v.lottery = { r: ev.r, k: 0, token: ev.token };
      await animate(10, k => { v.lottery.k = k; });
      v.picked = ev.token;
      await animate(2);
      await hold();
      if (!v.visibleRows.some(r => r.token === ev.token)) {
        const selected = v.rows.find(r => r.token === ev.token);
        await carry(ev.token, { lane: 'roulette' }, { lane: 'candidates', index: 4 });
        v.visibleRows[4] = selected; v.workToken = null;
      }
      v.picked = ev.token;
    }
    if (ev.type === 'emit') {
      const rows = v.visibleRows, selected = v.rows.find(r => r.token === ev.token);
      if (selected && !rows.includes(selected)) rows[rows.length - 1] = selected;
      await carry(ev.token, { lane: 'candidates', index: Math.max(0, rows.indexOf(selected)), count: rows.length }, { lane: 'output', index: v.out.length });
      v.out.push(ev.token);
      await hold({ title: `返事に「${tokenLabel(ev.token)}」を 足した`, body: `ルーレットで選ばれた札を、返事の部屋に並べました。いまの返事は「${v.out.map(tokenLabel).join('')}」です。「おしまい」が選ばれるまで、文脈に足して次を考える、をくり返します。`, detail: `返事 ${v.out.length}まいめ` });
    }
    if (ev.type === 'end') v.endText = END_TEXT[ev.reason];
    if (ev.type === 'full') v.endText = '文字の本が いっぱい';
    if (ev.type === 'gradient') {
      v.epoch = ev.epoch; v.epochs = ev.epochs;
      v.workToken = null; v.stages = []; v.errorNote = null;
      if (ev.quizBefore) {
        await walkTo({ lane: 'work', index: 5 });
        delete canvas.dataset.carry;
        v.quiz = { ...ev.quizBefore, k: 0 }; canvas.dataset.quiz = 'asking';
        await animate((quickTour ? 2 : 5), k => { v.quiz.k = k; });
        if (!quickTour) await animate(3);
        await hold();
        v.errorNote = { size: 1 - ev.quizBefore.p };
      }
      // はずれの知らせを持って、⑥から①へ逆向きに原本を書き直していく
      await operate(ev.changes ?? [], (ev.changes ?? []).map((_, i) => i).reverse());
      v.quiz = null; v.errorNote = null; delete canvas.dataset.quiz;
      (v.losses ??= []).push(ev);
      await hold({ title: `れんしゅう ${ev.epoch} / ${ev.epochs} が 終わった`, body: `原本を書き直して棚へ戻したので、同じ問題をもう一度解くと、正解「${tokenLabel(ev.quiz?.answer ?? '')}」に付ける確率が ${((ev.quizBefore?.p ?? 0) * 100).toFixed(1)}% から ${((ev.quiz?.p ?? 0) * 100).toFixed(1)}% に変わりました。広間の掲示板に、はずれの大きさを書き足します。`, detail: `この周は ${ev.targets} 回の更新をまとめて表示しました。はずれの大きさ（平均）${ev.loss.toFixed(3)}` }, true);
    }
    if (ev.type === 'replay') {
      v.seq = ev.tokens; v.source = ev.tokens; v.contextCards ??= []; v.workToken = null; v.inboxText = ev.text ?? ev.tokens.map(tokenLabel).join('');
      v.learnable = ev.learnable;
      v.sourceAt = 0;
      await placeCards(ev.tokens, v.contextCards.length, 0);
      const own = ev.learnable.filter(Boolean).length, skipped = ev.tokens.length - own;
      await hold({ title: 'ならべる 部屋: 聞いた会話を 思い出して 置いた', body: `眠っている間に、起きているときに聞いた会話を 1 つずつ思い出します。いま並べたのは「${ev.tokens.map(tokenLabel).join('')}」。この並びの「途中まで見て、次の札を当てる」を練習問題にします。`, detail: `${ev.tokens.length}まいの札。正解として使うのは ${own}まい。コト自身が作った返事や話者の目印（${skipped}まい）は、文脈には入れますが正解にはしません。` });
    }
    if (ev.type === 'study') {
      v.study = ev;
      await walkTo({ lane: 'attention', index: 0 });
      await hold({ title: 'ことばの まとまり探し', body: ev.conversations ? `本に残っている ${ev.conversations} 件の会話（${ev.utterances} の発話）を読み返し、となり合う札の組が何回出てくるかを数えます。コト自身が作った返事は数えません。` : '本に会話が残っていないので、数えるものがありません。', detail: '2 回以上ならぶ組を、1 回の勉強で少しずつまとまりにします。' });
      for (let i = 0; i < ev.rounds.length; i++) {
        v.studyRound = { candidates: ev.rounds[i], k: 0 };
        await animate(4, k => { v.studyRound.k = k; });
        const added = ev.added[i];
        if (!added) break;
        v.merging = { ...added, k: 0 };
        sfx('count', step);
        await animate(4, k => { v.merging.k = k; });
        v.merging = null;
        v.studyRound = null;
        await carry(added.text, { lane: 'attention', index: 0 }, { lane: 'work', index: 0 });
        v.newPages = [...(v.newPages ?? []), added.text];
        v.registering = { tokens: [added.text], k: 0 };
        await animate(3, k => { v.registering.k = k; });
        v.registering = null;
        await hold({ title: `「${added.text}」を ひとまとまりに`, body: `「${added.parts[0]}」の次に「${added.parts[1]}」が ${added.count} 回ならんでいたので、「${added.text}」を 1 まいの札として読めるようにしました。文字の本に新しいページを足し、${model.config.dim}個の数は元の 2 まいの平均から始めます。`, detail: '意味を覚えたのではなく、よく出る並びをひとまとまりで読めるようにしただけです。使い方は、これからの学習で育ちます。' });
        await walkTo({ lane: 'attention', index: 0 });
      }
      v.studyRound = null;
      v.endText = ev.code === 'added' ? `${ev.added.length} つの まとまり` : ev.code === 'full' ? 'まとまりの枠が いっぱい' : ev.code === 'no-material' ? '本に 会話がない' : '新しい まとまりは なかった';
    }
    await animate((ev.type === 'gradient' ? 2 : .8));
  }

  return { open, close, handle, sync() {}, stats, get isOpen() { return reveal > 0; }, view: neuralView };
}
