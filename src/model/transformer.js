// 小さな decoder-only Transformer。構成（文脈・次元・層・ヘッド・MLP幅）は作成時に決めて保存する。
// 原本（パラメータ）は Float32、計算の中間値と勾配は Float64。独立試作 tools/benchmark/transformer.mjs を土台にした。
// 画面のために別の計算はしない。トレース用には forward の中間値をそのまま写す。

const alloc = n => new Float64Array(n);
const node = (x, rows, cols, back = null) => ({ x, rows, cols, g: alloc(x.length), back });
export function softmax(values) {
  let max = -Infinity; for (const v of values) if (v > max) max = v;
  const out = Float64Array.from(values, v => Math.exp(v - max)); let sum = 0; for (const v of out) sum += v;
  for (let i = 0; i < out.length; i++) out[i] /= sum; return out;
}
const GELU_A = Math.sqrt(2 / Math.PI);

// Float32 の原本を文字列で保存するための変換（localStorage は文字列しか置けない）
export function packFloats(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength); let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
export function unpackFloats(text, length) {
  const s = atob(text); if (s.length !== length * 4) throw new Error('原本の長さが違います');
  const bytes = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  const out = new Float32Array(bytes.buffer); for (const v of out) if (!Number.isFinite(v)) throw new Error('原本に数でない値があります');
  return out;
}

export function createTransformer(config, vocabSize, { seed = 173, state = null, precision = 'float32' } = {}) {
  const Floats = precision === 'float64' ? Float64Array : Float32Array; // float64 は勾配の検算用
  const { dim: D, heads: H, layers: L, window: W, hidden: F } = config;
  if (!(D > 0 && H > 0 && L > 0 && W > 0 && F > 0) || D % H) throw new Error('構成が成立しません');
  const K = D / H;
  let V = vocabSize;
  let rng = state ?? (seed >>> 0);
  const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
  const params = {};
  const scaleOf = name => name === 'embed' || name === 'out' ? .12 : name === 'pos' ? .02 : name === 'bias' ? 0 : name.endsWith('f2') ? Math.sqrt(3 / F) * .5 : Math.sqrt(3 / D) * .5;
  const parameter = (name, rows, cols) => {
    const scale = scaleOf(name);
    params[name] = node(Floats.from({ length: rows * cols }, () => (random() * 2 - 1) * scale), rows, cols);
  };
  parameter('embed', V, D); parameter('pos', W, D);
  for (let l = 0; l < L; l++) {
    for (const n of ['q', 'k', 'v', 'o']) parameter(`${l}.${n}`, D, D);
    parameter(`${l}.f1`, D, F); parameter(`${l}.f2`, F, D);
  }
  parameter('out', V, D); parameter('bias', 1, V);

  let tape;
  const record = n => { tape.push(n); return n; };
  function linear(a, w) {
    const R = a.rows, I = a.cols, O = w.cols, y = alloc(R * O);
    for (let r = 0; r < R; r++) for (let i = 0; i < I; i++) {
      const v = a.x[r * I + i]; if (v === 0) continue; const wi = i * O, ri = r * O;
      for (let j = 0; j < O; j++) y[ri + j] += v * w.x[wi + j];
    }
    const n = node(y, R, O, () => {
      for (let r = 0; r < R; r++) for (let i = 0; i < I; i++) {
        const ai = r * I + i, wi = i * O, ri = r * O, v = a.x[ai]; let sum = 0;
        for (let j = 0; j < O; j++) { const g = n.g[ri + j]; sum += g * w.x[wi + j]; w.g[wi + j] += v * g; }
        a.g[ai] += sum;
      }
    }); return record(n);
  }
  function add(a, b) {
    const n = node(a.x.map((x, i) => x + b.x[i]), a.rows, a.cols, () => { for (let i = 0; i < n.g.length; i++) { a.g[i] += n.g[i]; b.g[i] += n.g[i]; } });
    return record(n);
  }
  function norm(a) {
    const y = alloc(a.x.length), scales = alloc(a.rows);
    for (let r = 0; r < a.rows; r++) {
      let s = 0; for (let j = 0; j < D; j++) s += a.x[r * D + j] ** 2;
      scales[r] = 1 / Math.sqrt(s / D + 1e-5);
      for (let j = 0; j < D; j++) y[r * D + j] = a.x[r * D + j] * scales[r];
    }
    const n = node(y, a.rows, D, () => {
      for (let r = 0; r < a.rows; r++) {
        let dot = 0; for (let j = 0; j < D; j++) dot += n.g[r * D + j] * a.x[r * D + j];
        for (let j = 0; j < D; j++) { const i = r * D + j; a.g[i] += n.g[i] * scales[r] - a.x[i] * dot * scales[r] ** 3 / D; }
      }
    }); return record(n);
  }
  function gelu(a) {
    const t = a.x.map(x => Math.tanh(GELU_A * (x + .044715 * x ** 3)));
    const n = node(a.x.map((x, i) => .5 * x * (1 + t[i])), a.rows, a.cols, () => {
      for (let i = 0; i < a.x.length; i++) {
        const x = a.x[i], d = .5 * (1 + t[i]) + .5 * x * (1 - t[i] ** 2) * GELU_A * (1 + 3 * .044715 * x * x);
        a.g[i] += n.g[i] * d;
      }
    }); return record(n);
  }
  // 因果マスク付きの自己注意。weights は H×N×N（r 行が s 列を見る割合。s > r は 0）
  function attention(q, k, v) {
    const N = q.rows, y = alloc(N * D), weights = alloc(H * N * N), allScores = alloc(H * N * N), scale = 1 / Math.sqrt(K);
    for (let h = 0; h < H; h++) for (let r = 0; r < N; r++) {
      const scores = alloc(r + 1);
      for (let s = 0; s <= r; s++) { let dot = 0; for (let d = 0; d < K; d++) dot += q.x[r * D + h * K + d] * k.x[s * D + h * K + d]; scores[s] = dot * scale; allScores[(h * N + r) * N + s] = scores[s]; }
      const p = softmax(scores);
      for (let s = 0; s <= r; s++) {
        weights[(h * N + r) * N + s] = p[s];
        for (let d = 0; d < K; d++) y[r * D + h * K + d] += p[s] * v.x[s * D + h * K + d];
      }
    }
    const n = node(y, N, D, () => {
      for (let h = 0; h < H; h++) for (let r = 0; r < N; r++) {
        const dp = alloc(r + 1); let mean = 0;
        for (let s = 0; s <= r; s++) {
          const p = weights[(h * N + r) * N + s];
          for (let d = 0; d < K; d++) { const ri = r * D + h * K + d, si = s * D + h * K + d; dp[s] += n.g[ri] * v.x[si]; v.g[si] += p * n.g[ri]; }
          mean += dp[s] * p;
        }
        for (let s = 0; s <= r; s++) {
          const ds = weights[(h * N + r) * N + s] * (dp[s] - mean) * scale;
          for (let d = 0; d < K; d++) { const ri = r * D + h * K + d, si = s * D + h * K + d; q.g[ri] += ds * k.x[si]; k.g[si] += ds * q.x[ri]; }
        }
      }
    }); n.weights = weights; n.scores = allScores; return record(n);
  }
  // 出力の原本は V×D（文字ごとに D 個）。語彙を末尾に足せる並び
  function outputs(a) {
    const N = a.rows, y = alloc(N * V), out = params.out, bias = params.bias;
    for (let r = 0; r < N; r++) for (let i = 0; i < V; i++) { let dot = 0; for (let d = 0; d < D; d++) dot += a.x[r * D + d] * out.x[i * D + d]; y[r * V + i] = dot + bias.x[i]; }
    const n = node(y, N, V, () => {
      for (let r = 0; r < N; r++) for (let i = 0; i < V; i++) {
        const g = n.g[r * V + i]; if (g === 0) continue; bias.g[i] += g;
        for (let d = 0; d < D; d++) { out.g[i * D + d] += g * a.x[r * D + d]; a.g[r * D + d] += g * out.x[i * D + d]; }
      }
    }); return record(n);
  }

  // ids は文脈窓に収まる長さ（呼ぶ側で切る）。detail=true で層ごとの中間値を返す
  function forward(ids, detail = false) {
    if (!ids.length || ids.length > W || ids.some(i => !Number.isInteger(i) || i < 0 || i >= V)) throw new Error('入力の番号が不正です');
    tape = []; const N = ids.length, x = alloc(N * D);
    for (let r = 0; r < N; r++) for (let d = 0; d < D; d++) x[r * D + d] = params.embed.x[ids[r] * D + d] + params.pos.x[r * D + d];
    const embedded = node(x, N, D, () => {
      for (let r = 0; r < N; r++) for (let d = 0; d < D; d++) { const g = embedded.g[r * D + d]; params.embed.g[ids[r] * D + d] += g; params.pos.g[r * D + d] += g; }
    }); record(embedded);
    let a = embedded; const layers = [];
    for (let l = 0; l < L; l++) {
      const n1 = norm(a), q = linear(n1, params[`${l}.q`]), k = linear(n1, params[`${l}.k`]), v = linear(n1, params[`${l}.v`]);
      const mixed = attention(q, k, v), projected = linear(mixed, params[`${l}.o`]), residual = add(a, projected);
      const n2 = norm(residual), pre = linear(n2, params[`${l}.f1`]), hidden = gelu(pre), mlp = linear(hidden, params[`${l}.f2`]);
      const output = add(residual, mlp);
      if (detail) layers.push({ input: a, n1, q, k, v, mixed, projected, residual, n2, pre, hidden, mlp, output });
      a = output;
    }
    const logits = outputs(a);
    return detail ? { logits, embedded, layers, N } : logits;
  }
  // targets[r] は r 行の正解。mask[r] が false の行は損失に入れない。対象が 0 行なら null
  function loss(ids, targets, mask = null, backward = false) {
    for (const p of Object.values(params)) p.g.fill(0);
    const logits = forward(ids); if (targets.length !== logits.rows) throw new Error('正解の長さが違います');
    let total = 0, count = 0;
    for (let r = 0; r < logits.rows; r++) if (!mask || mask[r]) count++;
    if (!count) return null;
    for (let r = 0; r < logits.rows; r++) {
      if (mask && !mask[r]) continue;
      const values = logits.x.subarray(r * V, (r + 1) * V), p = softmax(values);
      total += -Math.log(Math.max(p[targets[r]], 1e-300));
      if (backward) for (let j = 0; j < V; j++) logits.g[r * V + j] = (p[j] - (j === targets[r] ? 1 : 0)) / count;
    }
    if (backward) for (let i = tape.length - 1; i >= 0; i--) tape[i].back?.();
    return total / count;
  }
  // 1系列ぶんの更新。勾配ノルムが clip を超えたら縮める。更新しなかったときは null
  function train(ids, targets, mask, rate, clip) {
    const value = loss(ids, targets, mask, true); if (value == null) return null;
    let squared = 0; for (const p of Object.values(params)) for (const g of p.g) squared += g * g;
    const normValue = Math.sqrt(squared), factor = rate * Math.min(1, clip / Math.max(1e-12, normValue));
    for (const p of Object.values(params)) for (let i = 0; i < p.x.length; i++) p.x[i] -= factor * p.g[i];
    return { loss: value, gradientNorm: normValue };
  }
  function predict(ids) { const logits = forward(ids); return softmax(logits.x.subarray((logits.rows - 1) * V)); }

  // 語彙を count 個増やす。init[i] = { embed, out, bias } があればその値、なければ乱数。既存の数値は触らない
  function grow(count, init = []) {
    if (count <= 0) return;
    const embed = new Floats((V + count) * D); embed.set(params.embed.x);
    const out = new Floats((V + count) * D); out.set(params.out.x);
    const bias = new Floats(V + count); bias.set(params.bias.x);
    for (let i = 0; i < count; i++) {
      const row = (V + i) * D, given = init[i];
      for (let d = 0; d < D; d++) { embed[row + d] = given ? given.embed[d] : (random() * 2 - 1) * .12; out[row + d] = given ? given.out[d] : (random() * 2 - 1) * .12; }
      bias[V + i] = given ? given.bias : 0;
    }
    V += count;
    params.embed = node(embed, V, D); params.out = node(out, V, D); params.bias = node(bias, 1, V);
  }
  const rowOf = (name, i) => Array.from(params[name].x.subarray(i * params[name].cols, (i + 1) * params[name].cols));

  function snapshot() {
    return { config: { ...config }, vocabSize: V, state: rng, params: Object.fromEntries(Object.entries(params).map(([k, p]) => [k, packFloats(p.x)])) };
  }
  function restore(data) {
    if (!data || data.vocabSize !== V || !data.params) throw new Error('原本の形が合いません');
    for (const [k, p] of Object.entries(params)) {
      if (typeof data.params[k] !== 'string') throw new Error(`原本「${k}」がありません`);
      p.x = unpackFloats(data.params[k], p.x.length);
    }
    rng = data.state >>> 0;
  }
  const parameterCount = () => Object.values(params).reduce((s, p) => s + p.x.length, 0);

  return { config, params, forward, loss, train, predict, grow, rowOf, snapshot, restore, parameterCount, get vocabSize() { return V; }, get state() { return rng; } };
}
