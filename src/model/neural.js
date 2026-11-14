// 小さな decoder-only Transformer。1層・1ヘッド、RMSNorm、GELU MLP。
// 各予測位置より前だけを窓に取り、全パラメータを交差エントロピーで逆伝播する。
export const DIM = 12;
export const WINDOW = 24;
const HIDDEN = 24;
export const SPECIAL = ['<bos>', '<eos>', '<user>', '<assistant>', '<turn>', '<unk>', '<speaker2>', '<speaker3>'];
const zeros = n => Array(n).fill(0);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const softmax = a => { const m = Math.max(...a); const e = a.map(x => Math.exp(x - m)); const s = e.reduce((x, y) => x + y, 0); return e.map(x => x / s); };
const gelu = x => .5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + .044715 * x ** 3)));
const dgelu = x => { const a = Math.sqrt(2 / Math.PI); const t = Math.tanh(a * (x + .044715 * x ** 3)); return .5 * (1 + t) + .5 * x * (1 - t * t) * a * (1 + 3 * .044715 * x * x); };
function rms(x) { const scale = 1 / Math.sqrt(dot(x, x) / x.length + 1e-5); return { y: x.map(v => v * scale), x, scale }; }
function rmsBack(dy, cache) { const { x, scale } = cache; const c = dot(dy, x) * scale ** 3 / x.length; return dy.map((v, i) => v * scale - c * x[i]); }
function mul(x, w, n) { const y = zeros(n); for (let i = 0; i < x.length; i++) for (let j = 0; j < n; j++) y[j] += x[i] * w[i * n + j]; return y; }
function backMul(x, w, dy, dw) { const dx = zeros(x.length), n = dy.length; for (let i = 0; i < x.length; i++) for (let j = 0; j < n; j++) { dx[i] += w[i * n + j] * dy[j]; dw[i * n + j] += x[i] * dy[j]; } return dx; }
const add = (a, b) => a.map((v, i) => v + b[i]);

export function createNeural(seed = 173) {
  let state = seed;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const init = (n, scale = .12) => Array.from({ length: n }, () => (random() * 2 - 1) * scale);
  let vocab = [...SPECIAL];
  let weights = { embed: init(vocab.length * DIM), pos: init(WINDOW * DIM, .02), q: init(DIM * DIM), k: init(DIM * DIM), v: init(DIM * DIM), o: init(DIM * DIM), f1: init(DIM * HIDDEN), f2: init(HIDDEN * DIM), out: init(vocab.length * DIM), bias: zeros(vocab.length) };
  let updates = 0, lastLoss = null, learned = false;
  function tokenId(token, grow = false) {
    let id = vocab.indexOf(token);
    if (id < 0 && grow) { id = vocab.length; vocab.push(token); weights.embed.push(...init(DIM)); weights.out.push(...init(DIM)); weights.bias.push(0); }
    return id < 0 ? 5 : id;
  }
  function encode(tokens, grow = false) { return tokens.map(t => tokenId(t, grow)); }
  function forward(ids) {
    ids = ids.slice(-WINDOW);
    if (!ids.length) ids = [0];
    const xs = ids.map((id, p) => Array.from({ length: DIM }, (_, j) => weights.embed[id * DIM + j] + weights.pos[p * DIM + j]));
    const norms = xs.map(rms), ns = norms.map(n => n.y), last = ids.length - 1;
    const q = mul(ns[last], weights.q, DIM), ks = ns.map(n => mul(n, weights.k, DIM)), vs = ns.map(n => mul(n, weights.v, DIM));
    const scores = ks.map(k => dot(q, k) / Math.sqrt(DIM)), attention = softmax(scores);
    const mix = zeros(DIM); vs.forEach((v, i) => v.forEach((x, j) => { mix[j] += attention[i] * x; }));
    const projected = mul(mix, weights.o, DIM), residual = add(xs[last], projected);
    const norm2 = rms(residual), pre = mul(norm2.y, weights.f1, HIDDEN), hidden = pre.map(gelu);
    const final = add(residual, mul(hidden, weights.f2, DIM));
    const logits = vocab.map((_, i) => dot(final, weights.out.slice(i * DIM, (i + 1) * DIM)) + weights.bias[i]);
    return { ids, xs, norms, ns, last, q, ks, vs, scores, attention, mix, projected, residual, norm2, pre, hidden, final, logits, probs: softmax(logits) };
  }
  function gradients(ids, target) {
    const c = forward(ids), grad = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, zeros(v.length)]));
    const dl = [...c.probs]; dl[target] -= 1;
    const dfinal = zeros(DIM);
    dl.forEach((d, i) => { grad.bias[i] = d; for (let j = 0; j < DIM; j++) { grad.out[i * DIM + j] += d * c.final[j]; dfinal[j] += d * weights.out[i * DIM + j]; } });
    const dhidden = backMul(c.hidden, weights.f2, dfinal, grad.f2);
    const dpre = dhidden.map((v, i) => v * dgelu(c.pre[i]));
    const dn2 = backMul(c.norm2.y, weights.f1, dpre, grad.f1);
    const dr = add(dfinal, rmsBack(dn2, c.norm2));
    const dmix = backMul(c.mix, weights.o, dr, grad.o);
    const da = c.vs.map(v => dot(dmix, v)), mean = dot(da, c.attention);
    const ds = da.map((a, i) => c.attention[i] * (a - mean) / Math.sqrt(DIM));
    const dq = zeros(DIM), dns = c.ns.map(() => zeros(DIM));
    c.ns.forEach((n, i) => {
      for (let j = 0; j < DIM; j++) dq[j] += ds[i] * c.ks[i][j];
      const dk = c.q.map(v => v * ds[i]), dv = dmix.map(v => v * c.attention[i]);
      dns[i] = add(backMul(n, weights.k, dk, grad.k), backMul(n, weights.v, dv, grad.v));
    });
    dns[c.last] = add(dns[c.last], backMul(c.ns[c.last], weights.q, dq, grad.q));
    c.ids.forEach((id, i) => {
      let dx = rmsBack(dns[i], c.norms[i]); if (i === c.last) dx = add(dx, dr);
      dx.forEach((v, j) => { grad.embed[id * DIM + j] += v; grad.pos[i * DIM + j] += v; });
    });
    return { grad, loss: -Math.log(Math.max(c.probs[target], 1e-12)) };
  }
  function train(sequences, epochs = 12) {
    const encoded = sequences.map(s => encode(s, true));
    const history = [];
    // 当てっこの見本: 最初の会話のまん中あたりで、次の文字を当てる
    const sample = encoded.find(ids => ids.length > 2), at = sample ? Math.min(sample.length - 1, Math.max(2, Math.ceil(sample.length / 2))) : 0;
    const ask = () => {
      if (!sample) return null;
      const probs = forward(sample.slice(Math.max(0, at - WINDOW), at)).probs, answer = vocab[sample[at]];
      const top = probs.map((p, i) => ({ token: vocab[i], p })).sort((x, y) => y.p - x.p).slice(0, 4);
      if (!top.some(c => c.token === answer)) top[3] = { token: answer, p: probs[sample[at]] };
      return { context: sample.slice(Math.max(0, at - 4), at).map(id => vocab[id]), answer, p: probs[sample[at]], top };
    };
    for (let epoch = 0; epoch < epochs; epoch++) {
      const quizBefore = ask(), whole = Object.fromEntries(Object.entries(weights).map(([key, list]) => [key, [...list]]));
      const groups = [['embed', '埋め込み'], ['q', '注意 Q'], ['v', '注意 V'], ['o', '注意の投影'], ['f1', 'MLP'], ['out', '出力']];
      const before = groups.map(([key]) => weights[key].slice(0, 24));
      let total = 0, count = 0, normTotal = 0;
      for (const ids of encoded) for (let at = 1; at < ids.length; at++) {
        const { grad, loss } = gradients(ids.slice(Math.max(0, at - WINDOW), at), ids[at]);
        const norm = Math.sqrt(Object.values(grad).reduce((sum, a) => sum + dot(a, a), 0));
        const rate = .035 * Math.min(1, 1 / Math.max(norm, 1e-12));
        for (const key of Object.keys(weights)) for (let j = 0; j < weights[key].length; j++) weights[key][j] -= rate * grad[key][j];
        total += loss; normTotal += norm; count++; updates++;
      }
      lastLoss = count ? total / count : null;
      const quiz = ask();
      history.push({ epoch: epoch + 1, loss: lastLoss, quiz, quizBefore, gradientNorm: count ? normTotal / count : 0, updates, targets: count,
        changes: groups.map(([key, label], i) => ({ label, kind: 'tune', before: before[i], values: weights[key].slice(0, 24),
          moved: weights[key].reduce((sum, w, j) => sum + Math.abs(w - whole[key][j]), 0) / weights[key].length })),
        matrices: [weights.q.slice(0, 144), weights.f1.slice(0, 144), weights.out.slice(-144)] });
    }
    learned ||= encoded.some(s => s.length > 1);
    return history;
  }
  function predict(tokens) {
    if (!learned) return [];
    const { probs } = forward(encode(tokens));
    // 話者記号などは返事の本文へ出さない。文末とターン末尾は同じ終了候補へまとめる。
    const allowed = vocab.map((token, i) => ({ token, p: probs[i], count: 0 })).filter((c, i) => i >= SPECIAL.length);
    allowed.push({ token: '■', p: probs[1] + probs[4], count: 0 });
    const sum = allowed.reduce((s, c) => s + c.p, 0);
    return allowed.map(c => ({ ...c, p: c.p / sum }));
  }
  function snapshot() { return { vocab: [...vocab], weights: structuredClone(weights), updates, lastLoss, learned, state }; }
  function restore(data) {
    if (!data || !Array.isArray(data.vocab) || !data.vocab.slice(0, SPECIAL.length).every((v, i) => v === SPECIAL[i])) return false;
    const lengths = { embed: data.vocab.length * DIM, pos: WINDOW * DIM, q: DIM * DIM, k: DIM * DIM, v: DIM * DIM, o: DIM * DIM, f1: DIM * HIDDEN, f2: HIDDEN * DIM, out: data.vocab.length * DIM, bias: data.vocab.length };
    if (!Object.entries(lengths).every(([k, n]) => Array.isArray(data.weights?.[k]) && data.weights[k].length === n && data.weights[k].every(Number.isFinite))) return false;
    vocab = [...data.vocab]; weights = structuredClone(data.weights); updates = data.updates ?? 0; lastLoss = data.lastLoss; learned = !!data.learned; state = data.state >>> 0; return true;
  }
  return { encode, predict, train, snapshot, restore, gradients, forward,
    // 画面で再生するための記録。計算済みの値を写すだけで、ここで別の計算はしない。
    inspect: tokens => {
      const ids = encode(tokens).slice(-WINDOW), c = forward(ids), id = c.ids[c.last];
      const encoded = c.ids.map(i => vocab[i]);
      // predict と同じ候補のまとめ方（話者記号を除き、終わりの 2 種を 1 つにする）で得点を並べる
      const scored = vocab.map((token, i) => ({ token, score: c.logits[i] })).filter((_, i) => i >= SPECIAL.length);
      scored.push({ token: '■', score: Math.log(Math.exp(c.logits[1]) + Math.exp(c.logits[4])) });
      const shares = softmax(scored.map(s => s.score));
      const candidates = scored.map((s, i) => ({ ...s, p: shares[i] })).sort((a, b) => b.p - a.p).slice(0, 5);
      return { tokens: tokens.slice(-WINDOW), encoded, weights: c.attention,
        stages: [
          { label: '埋め込み + 位置', kind: 'add', values: c.xs[c.last], token: encoded[c.last], position: c.last,
            a: weights.embed.slice(id * DIM, (id + 1) * DIM), b: weights.pos.slice(c.last * DIM, (c.last + 1) * DIM) },
          { label: 'RMSNorm → Q・K・V', kind: 'match', values: c.q, tokens: encoded, sourceTokens: tokens.slice(-WINDOW), scores: c.scores, weights: c.attention },
          { label: '注意の重みで合成', kind: 'mix', values: c.mix, tokens: encoded, sourceTokens: tokens.slice(-WINDOW), weights: c.attention, parts: c.vs },
          { label: '投影 + 残差', kind: 'add', values: c.residual, a: c.xs[c.last], b: c.projected },
          { label: 'RMSNorm → MLP・GELU', kind: 'gate', values: c.hidden, before: c.pre },
          { label: 'MLP + 残差 → 出力', kind: 'score', values: c.final, candidates },
        ] };
    },
    get updates() { return updates; }, get lastLoss() { return lastLoss; } };
}
