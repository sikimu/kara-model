// 空モデル本体。DOM にも three.js にも触れない。
// 推論・学習・勉強は結果と一緒にトレース（手順の配列）を返し、画面側がそれを再生する。
// 構成・語彙・原本・会話の本・学習待ち・進行を 1 組で保存する（docs/implementation-design.md 第2節）。

import { PRESETS, DEFAULT_LIMITS, FORMAT_VERSION, PENDING_CAPACITY, TRAINING, MAX_OUTPUT, validConfig, validLimits } from './config.js';
import { createVocabulary, CONTROL, BOS, EOS, TURN, USER, ASSISTANT } from './vocabulary.js';
import { createTransformer, softmax } from './transformer.js';
import { createBook, sequenceOf, windowsOf, normalizeTurns, conversationText } from './corpus.js';
import { planStudy } from './study.js';

export const EMPTY_REPLY = '……';
export const END = '■'; // 返事の終わり（おしまい・交代の 2 つの目印をまとめた候補）
export { MAX_OUTPUT, PENDING_CAPACITY };
export { conversationText };

const row = (n, r) => Array.from(n.x.subarray(r * n.cols, (r + 1) * n.cols));
const mean = (a, b) => a.map((x, i) => (x + b[i]) / 2);

export function createModel({ config = PRESETS[0], limits = DEFAULT_LIMITS, saved = null, random = Math.random, seed = 173 } = {}) {
  if (saved) {
    if (saved.formatVersion !== FORMAT_VERSION) throw new Error('保存形式の版が違います');
    config = saved.config; limits = saved.limits;
  }
  if (!validConfig(config)) throw new Error('検証済みでない構成です');
  if (!validLimits(limits)) throw new Error('上限の値が候補にありません');
  config = { window: config.window, dim: config.dim, layers: config.layers, heads: config.heads, hidden: config.hidden };
  limits = { conversations: limits.conversations, merges: limits.merges };

  let vocab = createVocabulary(saved?.vocabulary ?? null);
  let net = createTransformer(config, vocab.size, { seed, state: saved?.parameters?.state ?? null });
  if (saved) net.restore(saved.parameters);
  let book = createBook(saved?.conversationBook, limits.conversations);
  let pending = Array.isArray(saved?.pendingLessons) ? saved.pendingLessons.map(c => ({ id: c.id, turns: normalizeTurns(c.turns) })).filter(c => c.turns.length).slice(-PENDING_CAPACITY) : [];
  const progress = { sleeps: 0, updates: 0, lastLoss: null, learned: false, lastStudy: null };
  const tutorial = { step: 0, reflection: null }; // main.js が参照するので同じオブジェクトを保つ
  let revision = 0;
  if (saved) {
    const p = saved.progress ?? {};
    progress.sleeps = Number.isInteger(p.sleeps) ? p.sleeps : 0;
    progress.updates = Number.isInteger(p.updates) ? p.updates : 0;
    progress.lastLoss = Number.isFinite(p.lastLoss) ? p.lastLoss : null;
    progress.learned = !!p.learned;
    progress.lastStudy = p.lastStudy ?? null;
    tutorial.step = Number.isInteger(p.tutorial?.step) && p.tutorial.step >= 0 && p.tutorial.step <= 4 ? p.tutorial.step : (progress.sleeps > 0 ? 4 : 0);
    tutorial.reflection = ['first-talk', 'heard', 'slept', 'replied', 'quiet'].includes(p.tutorial?.reflection) ? p.tutorial.reflection : null;
    revision = Number.isInteger(saved.revision) ? saved.revision : 0;
  }
  // 学習待ちや本の文字は登録済みのはず。保存の不整合は読み込みで見つける
  for (const c of [...book.conversations, ...pending]) for (const t of c.turns) if (!vocab.encode(t.text)) throw new Error(`本の文字「${t.text}」が対応表にありません`);

  // 初見の文字を対応表と原本に追加する（学習ではなく登録）。文字の枠が満杯なら何も変えずに知らせる
  function register(text) {
    const before = vocab.size;
    const { added, full } = vocab.registerChars(text);
    if (full) {
      // 途中まで登録した分も取り消さず、原本だけ合わせる（対応表と原本の形を常に一致させる）
      net.grow(vocab.size - before);
      return { added: added.map(id => vocab.textOf(id)), full: true };
    }
    net.grow(added.length);
    if (added.length) revision++;
    return { added: added.map(id => vocab.textOf(id)), full: false };
  }

  // 返事の候補: 文字とまとまり（目印は出さない）。おしまい・交代は「おしまい」1 つにまとめる
  function candidatesOf(probs, logits = null) {
    const list = [];
    for (let id = CONTROL.length; id < vocab.size; id++) list.push({ token: vocab.textOf(id), id, p: probs[id], score: logits ? logits[id] : undefined });
    list.push({ token: END, id: EOS, p: probs[EOS] + probs[TURN], score: logits ? Math.log(Math.exp(logits[EOS]) + Math.exp(logits[TURN])) : undefined });
    const sum = list.reduce((s, c) => s + c.p, 0);
    for (const c of list) c.p /= sum;
    return list;
  }
  const pick = (candidates, r) => { let sum = 0; for (const c of candidates) { sum += c.p; if (r < sum) return c; } return candidates.at(-1); };

  // 部屋ごとの記録。forward の中間値を写すだけで、ここで別の計算はしない
  function stagesOf(d, ids, texts) {
    const D = config.dim, H = config.heads, N = d.N, last = N - 1, K = D / H;
    const entries = ids.map((id, p) => ({ token: texts[p], id, position: p, a: net.rowOf('embed', id), b: net.rowOf('pos', p), values: row(d.embedded, p) }));
    const stages = [{ kind: 'add', room: 0, layer: null, label: '文字の本と順番の本から写す', entries, ...entries[last], sourceToken: texts[last] }];
    d.layers.forEach((Lr, l) => {
      const att = Lr.mixed;
      const heads = Array.from({ length: H }, (_, h) => ({
        weights: Array.from({ length: N }, (_, s) => att.weights[(h * N + last) * N + s]),
        scores: Array.from({ length: N }, (_, s) => att.scores[(h * N + last) * N + s]),
        query: row(Lr.q, last).slice(h * K, (h + 1) * K),
        keys: ids.map((_, s) => row(Lr.k, s).slice(h * K, (h + 1) * K)),
        parts: ids.map((_, s) => row(Lr.v, s).slice(h * K, (h + 1) * K)),
        values: row(Lr.mixed, last).slice(h * K, (h + 1) * K),
      }));
      stages.push({ kind: 'match', room: 1, layer: l, label: `${l + 1}層め: 見くらべる`, tokens: texts, sourceTokens: texts, heads, weights: heads[0].weights, scores: heads[0].scores, values: row(Lr.q, last), input: row(Lr.n1, last) });
      stages.push({ kind: 'mix', room: 2, layer: l, label: `${l + 1}層め: まぜる`, tokens: texts, sourceTokens: texts, heads, weights: heads[0].weights, parts: heads[0].parts, values: row(Lr.mixed, last) });
      stages.push({ kind: 'add', room: 3, layer: l, label: `${l + 1}層め: たしなおす`, a: row(Lr.input, last), b: row(Lr.projected, last), values: row(Lr.residual, last) });
      stages.push({ kind: 'gate', room: 4, layer: l, label: `${l + 1}層め: しぼる`, before: row(Lr.pre, last), values: row(Lr.hidden, last), a: row(Lr.residual, last), b: row(Lr.mlp, last), after: row(Lr.output, last) });
    });
    const final = row(d.layers.at(-1).output, last), logits = row(d.logits, last), probs = Array.from(softmax(logits));
    const candidates = candidatesOf(probs, logits).sort((a, b) => b.p - a.p).slice(0, 5);
    stages.push({ kind: 'score', room: 5, layer: null, label: '出力の本で点をつける', values: final, candidates });
    return stages;
  }

  // 推論。入力を文脈に入れ、コトの番の続きを 1 トークンずつ生成する。原本は変えない（文字の登録を終えてから）
  function infer(text) {
    const trace = [];
    const registered = register(text);
    if (registered.full) return { text: EMPTY_REPLY, trace: [{ type: 'full', text }], refused: true };
    if (registered.added.length) trace.push({ type: 'register', tokens: registered.added });
    const encoded = vocab.encode(text);
    trace.push({ type: 'tokenize', tokens: encoded.map(t => vocab.textOf(t.id)), spans: encoded.map(t => [t.start, t.end]), text });
    if (!progress.learned) { trace.push({ type: 'end', reason: 'empty' }); return { text: EMPTY_REPLY, trace }; }
    const ids = [BOS, USER, ...encoded.map(t => t.id), TURN, ASSISTANT];
    const out = [];
    let reason;
    for (;;) {
      const windowIds = ids.slice(-config.window), texts = windowIds.map(id => vocab.textOf(id));
      const detail = net.forward(windowIds, true);
      const probs = Array.from(softmax(detail.logits.x.subarray((detail.N - 1) * vocab.size)));
      const candidates = candidatesOf(probs);
      trace.push({ type: 'attention', tokens: texts, encoded: texts, window: { offset: ids.length - windowIds.length, total: ids.length, size: config.window }, stages: stagesOf(detail, windowIds, texts), config: { ...config }, weights: detail.layers.at(-1).mixed.weights.slice((detail.N - 1) * detail.N, detail.N * detail.N) });
      trace.push({ type: 'probs', candidates });
      const r = random(), chosen = pick(candidates, r);
      trace.push({ type: 'pick', token: chosen.token, r });
      if (chosen.token === END) { reason = 'eos'; break; }
      trace.push({ type: 'emit', token: chosen.token });
      out.push(chosen.token); ids.push(chosen.id);
      if (out.length >= MAX_OUTPUT) { reason = 'limit'; break; }
    }
    trace.push({ type: 'end', reason });
    return { text: out.length ? out.join('') : EMPTY_REPLY, trace };
  }

  // 聞く。会話を本と学習待ちに入れる。原本は変えない
  function hearDialogue(turns) {
    const normalized = normalizeTurns(turns);
    if (!normalized.length) return { trace: [] };
    const trace = [];
    for (const t of normalized) {
      const registered = register(t.text);
      if (registered.full) return { trace: [{ type: 'full', text: t.text }], refused: true };
      if (registered.added.length) trace.push({ type: 'register', tokens: registered.added });
    }
    const { conversation, removed } = book.add(normalized);
    const copy = structuredClone(conversation);
    trace.push({ type: 'hear', text: conversationText(copy), conversation: copy, removedFromBook: removed.map(conversationText) });
    pending.push(copy);
    while (pending.length > PENDING_CAPACITY) trace.push({ type: 'forget', text: conversationText(pending.shift()) });
    revision++;
    return { trace };
  }
  const hear = text => hearDialogue([{ speaker: 'guest1', source: 'guest', text }]);

  // 眠る。学習待ちの会話で原本を更新し、学習待ちを空にする。会話の本は変えない
  async function sleepAsync(pause = () => new Promise(resolve => setTimeout(resolve, 0))) {
    const trace = [];
    if (!pending.length) return { trace };
    const lessons = pending.map(c => ({ conversation: c, tokens: sequenceOf(c, vocab) }));
    for (const l of lessons) trace.push({ type: 'replay', text: conversationText(l.conversation), tokens: l.tokens.map(t => t.text), learnable: l.tokens.map(t => t.learnable), turns: structuredClone(l.conversation.turns) });
    const W = config.window, D = config.dim, L = config.layers;
    const windows = lessons.flatMap(l => windowsOf(l.tokens, W));
    // 当てっこの見本: 最初の会話で、正解にしてよい位置のうち真ん中あたり
    const sample = lessons.find(l => l.tokens.some((t, i) => i >= 2 && t.learnable));
    let at = 0;
    if (sample) { const okay = sample.tokens.map((t, i) => t.learnable && i >= 2 ? i : -1).filter(i => i >= 0); at = okay[Math.floor(okay.length / 2)]; }
    const ask = () => {
      if (!sample) return null;
      const ids = sample.tokens.map(t => t.id), context = ids.slice(Math.max(0, at - W), at);
      const candidates = candidatesOf(Array.from(net.predict(context)));
      const answerId = ids[at], answer = answerId === EOS || answerId === TURN ? END : vocab.textOf(answerId);
      const found = candidates.find(c => c.token === answer), p = found?.p ?? 0;
      const top = [...candidates].sort((x, y) => y.p - x.p).slice(0, 4);
      if (!top.some(c => c.token === answer)) top[3] = { token: answer, p };
      return { context: sample.tokens.slice(Math.max(0, at - 4), at).map(t => t.text), answer, p, top: top.map(c => ({ token: c.token, p: c.p })) };
    };
    // 表示用に抜き出す原本: 練習に出た文字 2 つの行と、各層の表の先頭 24 個
    const letters = [...new Set(lessons.flatMap(l => l.tokens.map(t => t.id)))].filter(id => id >= CONTROL.length).slice(0, 2);
    const groups = [{ label: '文字の本', parameter: 'embed', room: 0, layer: null, rows: letters }];
    for (let l = 0; l < L; l++) groups.push({ label: `②の本 ${l + 1}層め`, parameter: `${l}.q`, room: 1, layer: l }, { label: `③の本 ${l + 1}層め`, parameter: `${l}.v`, room: 2, layer: l }, { label: `⑤の本 ${l + 1}層め`, parameter: `${l}.f1`, room: 4, layer: l });
    groups.push({ label: '出力の本', parameter: 'out', room: 5, layer: null, rows: letters });
    const indicesOf = g => g.rows ? g.rows.flatMap(id => Array.from({ length: D }, (_, j) => id * D + j)) : Array.from({ length: 24 }, (_, j) => j);
    for (let epoch = 1; epoch <= TRAINING.epochs; epoch++) {
      const quizBefore = ask();
      const whole = Object.fromEntries(Object.entries(net.params).map(([k, p]) => [k, Float32Array.from(p.x)]));
      const before = groups.map(g => indicesOf(g).map(j => net.params[g.parameter].x[j]));
      let total = 0, count = 0, normTotal = 0;
      for (const w of windows) {
        const result = net.train(w.input, w.targets, w.mask, TRAINING.rate, TRAINING.clip);
        if (!result) continue;
        total += result.loss; normTotal += result.gradientNorm; count++; progress.updates++;
        await pause();
      }
      progress.lastLoss = count ? total / count : progress.lastLoss;
      const moved = Object.fromEntries(Object.entries(net.params).map(([k, p]) => { let s = 0; for (let j = 0; j < p.x.length; j++) s += Math.abs(p.x[j] - whole[k][j]); return [k, s / p.x.length]; }));
      trace.push({ type: 'gradient', epoch, epochs: TRAINING.epochs, loss: progress.lastLoss, quiz: ask(), quizBefore, gradientNorm: count ? normTotal / count : 0, updates: progress.updates, targets: count, moved,
        changes: groups.map((g, i) => ({ label: g.label, kind: 'tune', parameter: g.parameter, room: g.room, layer: g.layer, indices: indicesOf(g), tokens: g.rows ? indicesOf(g).map(j => vocab.textOf(Math.floor(j / D))) : null, before: before[i], values: indicesOf(g).map(j => net.params[g.parameter].x[j]), moved: moved[g.parameter] })) });
      if (count) progress.learned = true;
    }
    for (const l of lessons) trace.push({ type: 'forget', text: conversationText(l.conversation) });
    pending = [];
    progress.sleeps++;
    revision++;
    return { trace };
  }

  // 机の勉強。本の会話から繰り返し並ぶ札を見つけ、まとまりを登録した「次の状態」を別に作って返す。
  // 呼ぶ側は next を保存できたときだけ adopt() で切り替える（保存失敗や中断で対応表と原本が食い違わない）
  function study() {
    const working = vocab.clone();
    const plan = planStudy(book, working, limits.merges);
    const sources = plan.sources.map(id => { const c = book.conversations.find(x => x.id === id); return c ? { id, text: conversationText(c), turns: structuredClone(c.turns) } : null; }).filter(Boolean);
    const excerpt = e => { const c = book.conversations.find(x => x.id === e.conversation); return c ? c.turns[e.turn].text : ''; };
    const result = { code: plan.code, full: plan.full, limit: limits.merges, added: plan.added.map(m => ({ id: m.id, text: m.text, pair: m.pair, parts: m.parts, count: m.count, examples: m.examples.map(e => ({ ...e, text: excerpt(e) })) })), sources, rounds: plan.rounds, merges: working.counts().merges };
    const trace = [{ type: 'study', utterances: plan.sources.length ? sources.reduce((s, c) => s + c.turns.filter(t => t.source !== 'koto').length, 0) : 0, conversations: sources.length, rounds: plan.rounds, added: result.added, code: plan.code }];
    if (plan.code !== 'added') return { result, trace, next: null };
    const next = createModel({ saved: snapshot(), random, seed });
    next.applyMerges(plan.added);
    next.progress.lastStudy = { code: plan.code, full: plan.full, added: result.added.map(m => ({ text: m.text, parts: m.parts, count: m.count })), sources: sources.map(s => ({ id: s.id, text: s.text })), merges: result.merges, limit: limits.merges };
    return { result, trace, next };
  }
  function applyMerges(added) {
    for (const m of added) {
      const [a, b] = m.pair, id = vocab.addMerge(a, b);
      if (id !== m.id) throw new Error('まとまりの番号が合いません');
      net.grow(1, [{ embed: mean(net.rowOf('embed', a), net.rowOf('embed', b)), out: mean(net.rowOf('out', a), net.rowOf('out', b)), bias: (net.params.bias.x[a] + net.params.bias.x[b]) / 2 }]);
    }
    revision++;
  }
  function recordStudy(result) { progress.lastStudy = { code: result.code, full: result.full, added: [], sources: result.sources.map(s => ({ id: s.id, text: s.text })), merges: result.merges, limit: limits.merges }; revision++; }

  function stats() {
    const c = vocab.counts();
    return { chars: c.chars, merges: c.merges, kinds: c.chars + c.merges, updates: progress.updates, sleeps: progress.sleeps, learned: progress.learned, parameters: net.parameterCount(), lastLoss: progress.lastLoss };
  }
  function snapshot() {
    return { formatVersion: FORMAT_VERSION, revision, config: { ...config }, limits: { ...limits }, vocabulary: vocab.snapshot(), parameters: net.snapshot(), conversationBook: book.snapshot(), pendingLessons: structuredClone(pending), progress: { ...progress, tutorial: { ...tutorial } } };
  }
  // 別のモデル（study の next、または新規作成）の状態をそのまま引き継ぐ。構成・上限も含める
  function adopt(other) {
    const data = other.snapshot();
    config = { ...data.config }; limits = { ...data.limits };
    Object.assign(tutorial, data.progress.tutorial ?? { step: 0, reflection: null });
    vocab = createVocabulary(data.vocabulary);
    net = createTransformer(config, vocab.size, { seed, state: data.parameters.state }); net.restore(data.parameters);
    book = createBook(data.conversationBook, limits.conversations);
    pending = data.pendingLessons;
    Object.assign(progress, { sleeps: data.progress.sleeps, updates: data.progress.updates, lastLoss: data.progress.lastLoss, learned: data.progress.learned, lastStudy: data.progress.lastStudy });
    revision = data.revision;
  }

  return {
    get config() { return config; }, get limits() { return limits; }, tutorial, progress, stats, snapshot, adopt, applyMerges, recordStudy,
    infer, hear, hearDialogue, sleepAsync, study, register,
    get vocab() { return vocab; }, get net() { return net; }, get book() { return book; }, get pending() { return pending; }, get revision() { return revision; },
    // 以前の名前（表示側で使う）
    get shortMemory() { return pending; },
  };
}
