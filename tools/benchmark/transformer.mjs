// Independent CPU-only benchmark. Not imported by the game.
const alloc = n => new Float64Array(n);
const node = (x, rows, cols, back = null) => ({ x, rows, cols, g: alloc(x.length), back });
const softmax = x => { const m = Math.max(...x), y = Float64Array.from(x, v => Math.exp(v - m)); const s = y.reduce((a, b) => a + b, 0); return y.map(v => v / s); };

export function createTransformer(config, seed = 173, precision = 'float32') {
  const { dim: D, heads: H, layers: L, window: W, vocab: V } = config;
  if (D % H || D < 1 || H < 1 || L < 1) throw Error('Invalid architecture');
  const F = D * 2, K = D / H, params = {};
  let state = seed;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const parameter = (name, rows, cols, scale) => {
    const Type = precision === 'float64' ? Float64Array : Float32Array;
    return params[name] = node(Type.from({ length: rows * cols }, () => (random() * 2 - 1) * scale), rows, cols);
  };
  parameter('embed', V, D, .12); parameter('pos', W, D, .02);
  for (let l = 0; l < L; l++) {
    for (const name of ['q', 'k', 'v', 'o']) parameter(`${l}.${name}`, D, D, Math.sqrt(3 / D) * .5);
    parameter(`${l}.f1`, D, F, Math.sqrt(3 / D) * .5);
    parameter(`${l}.f2`, F, D, Math.sqrt(3 / F) * .5);
  }
  parameter('out', D, V, .12); parameter('bias', 1, V, 0);
  let tape;
  const record = n => { tape.push(n); return n; };
  function linear(a, w) {
    const R = a.rows, I = a.cols, O = w.cols, y = alloc(R * O);
    for (let r = 0; r < R; r++) for (let i = 0; i < I; i++) {
      const v = a.x[r * I + i], wi = i * O, ri = r * O;
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
    const n = node(a.x.map((x, i) => x + b.x[i]), a.rows, a.cols, () => {
      for (let i = 0; i < n.g.length; i++) { a.g[i] += n.g[i]; b.g[i] += n.g[i]; }
    }); return record(n);
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
    const t = a.x.map(x => Math.tanh(Math.sqrt(2 / Math.PI) * (x + .044715 * x ** 3)));
    const n = node(a.x.map((x, i) => .5 * x * (1 + t[i])), a.rows, a.cols, () => {
      for (let i = 0; i < a.x.length; i++) {
        const x = a.x[i], derivative = .5 * (1 + t[i]) + .5 * x * (1 - t[i] ** 2) * Math.sqrt(2 / Math.PI) * (1 + 3 * .044715 * x * x);
        a.g[i] += n.g[i] * derivative;
      }
    }); return record(n);
  }
  function attention(q, k, v) {
    const N = q.rows, y = alloc(N * D), weights = alloc(H * N * N), scale = 1 / Math.sqrt(K);
    for (let h = 0; h < H; h++) for (let r = 0; r < N; r++) {
      const scores = alloc(r + 1);
      for (let s = 0; s <= r; s++) for (let d = 0; d < K; d++) scores[s] += q.x[r * D + h * K + d] * k.x[s * D + h * K + d] * scale;
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
          for (let d = 0; d < K; d++) {
            const ri = r * D + h * K + d, si = s * D + h * K + d;
            dp[s] += n.g[ri] * v.x[si]; v.g[si] += p * n.g[ri];
          }
          mean += dp[s] * p;
        }
        for (let s = 0; s <= r; s++) {
          const ds = weights[(h * N + r) * N + s] * (dp[s] - mean) * scale;
          for (let d = 0; d < K; d++) {
            const ri = r * D + h * K + d, si = s * D + h * K + d;
            q.g[ri] += ds * k.x[si]; k.g[si] += ds * q.x[ri];
          }
        }
      }
    }); return record(n);
  }
  function forward(input) {
    const ids = input.slice(-W); if (!ids.length || ids.some(i => i < 0 || i >= V || !Number.isInteger(i))) throw Error('Invalid tokens');
    tape = []; const N = ids.length, x = alloc(N * D);
    for (let r = 0; r < N; r++) for (let d = 0; d < D; d++) x[r * D + d] = params.embed.x[ids[r] * D + d] + params.pos.x[r * D + d];
    const embedded = node(x, N, D, () => {
      for (let r = 0; r < N; r++) for (let d = 0; d < D; d++) { const g = embedded.g[r * D + d]; params.embed.g[ids[r] * D + d] += g; params.pos.g[r * D + d] += g; }
    }); record(embedded); let a = embedded;
    for (let l = 0; l < L; l++) {
      const n = norm(a), q = linear(n, params[`${l}.q`]), k = linear(n, params[`${l}.k`]), v = linear(n, params[`${l}.v`]);
      const residual = add(a, linear(attention(q, k, v), params[`${l}.o`]));
      a = add(residual, linear(gelu(linear(norm(residual), params[`${l}.f1`])), params[`${l}.f2`]));
    }
    const logits = linear(a, params.out), result = node(logits.x.map((x, i) => x + params.bias.x[i % V]), N, V, () => {
      for (let i = 0; i < result.g.length; i++) { logits.g[i] += result.g[i]; params.bias.g[i % V] += result.g[i]; }
    }); return record(result);
  }
  function loss(ids, targets, backward = false) {
    for (const p of Object.values(params)) p.g.fill(0);
    const logits = forward(ids); if (targets.length !== logits.rows) throw Error('Target shape');
    let total = 0;
    for (let r = 0; r < logits.rows; r++) {
      const values = logits.x.subarray(r * V, (r + 1) * V), p = softmax(values), target = targets[r];
      const max = Math.max(...values); let sum = 0; for (const value of values) sum += Math.exp(value - max);
      total += max + Math.log(sum) - values[target];
      if (backward) for (let j = 0; j < V; j++) logits.g[r * V + j] = (p[j] - (j === target ? 1 : 0)) / logits.rows;
    }
    if (backward) for (let i = tape.length - 1; i >= 0; i--) tape[i].back?.();
    return total / logits.rows;
  }
  function train(ids, targets, rate = .035) {
    const value = loss(ids, targets, true); let squared = 0;
    for (const p of Object.values(params)) for (const g of p.g) squared += g * g;
    const factor = rate * Math.min(1, 1 / Math.max(1e-12, Math.sqrt(squared)));
    for (const p of Object.values(params)) for (let i = 0; i < p.x.length; i++) p.x[i] -= factor * p.g[i];
    return value;
  }
  function predict(ids) { const logits = forward(ids); return softmax(logits.x.subarray((logits.rows - 1) * V)); }
  function pack(tokenizer) {
    const arrays = Object.entries(params), header = new TextEncoder().encode(JSON.stringify({ format: 'kara-benchmark-1', config, tokenizer, arrays: arrays.map(([key, p]) => [key, p.x.length]) }));
    const bytes = new Uint8Array(4 + header.length + arrays.reduce((s, [, p]) => s + p.x.length * 4, 0));
    const view = new DataView(bytes.buffer); view.setUint32(0, header.length, true); bytes.set(header, 4); let at = 4 + header.length;
    for (const [, p] of arrays) for (const value of p.x) { view.setFloat32(at, value, true); at += 4; }
    return bytes;
  }
  return { config, params, forward, loss, train, predict, pack, parameterCount: Object.values(params).reduce((s, p) => s + p.x.length, 0) };
}

export function unpack(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), size = view.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, size + 4)));
  if (header.format !== 'kara-benchmark-1') throw Error('Unknown format');
  const model = createTransformer(header.config); let at = size + 4;
  for (const [key, length] of header.arrays) {
    const p = model.params[key]; if (!p || p.x.length !== length) throw Error('Parameter shape');
    for (let i = 0; i < length; i++) { const value = view.getFloat32(at, true); if (!Number.isFinite(value)) throw Error('Invalid weight'); p.x[i] = value; at += 4; }
  }
  if (at !== bytes.length) throw Error('Invalid length');
  return { model, tokenizer: header.tokenizer };
}
