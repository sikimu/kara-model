import { createTransformer, unpack } from './transformer.mjs';
import { fit, encode, decode } from './tokenizer.mjs';
const assert = (ok, label) => { if (!ok) throw Error(label); };
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const measure = (fn, n = 5) => { const times = []; for (let i = 0; i < n; i++) { const start = performance.now(); fn(); times.push(performance.now() - start); } return { medianMs: median(times), minMs: Math.min(...times), maxMs: Math.max(...times), repeats: n }; };
export function validate() {
  const model = createTransformer({ dim: 6, heads: 3, layers: 3, window: 8, vocab: 12 }, 173, 'float64');
  const ids = [1, 2, 3, 2], targets = [2, 3, 2, 4];
  model.loss(ids, targets, true);
  const saved = Object.fromEntries(Object.entries(model.params).map(([k, p]) => [k, [...p.g]]));
  let maxError = 0, checked = 0;
  for (const [key, p] of Object.entries(model.params)) {
    const indices = [...p.x.keys()].sort((a, b) => Math.abs(saved[key][b]) - Math.abs(saved[key][a])).slice(0, 3);
    for (const i of indices) {
      const old = p.x[i], epsilon = 1e-5;
      p.x[i] = old + epsilon; const plus = model.loss(ids, targets);
      p.x[i] = old - epsilon; const minus = model.loss(ids, targets); p.x[i] = old;
      const numerical = (plus - minus) / (2 * epsilon), analytical = saved[key][i];
      const error = Math.abs(numerical - analytical) / Math.max(1e-5, Math.abs(numerical) + Math.abs(analytical));
      maxError = Math.max(maxError, error); checked++; assert(error < 1e-4, `Gradient ${key}[${i}]: ${error}`);
    }
  }
  const a = model.forward([1, 2, 3, 4]).x.slice(), b = model.forward([1, 2, 8, 9]).x;
  assert(a.slice(0, 24).every((v, i) => v === b[i]), 'Future token leakage');
  const initial = model.loss(ids, targets); for (let i = 0; i < 100; i++) model.train(ids, targets);
  const final = model.loss(ids, targets); assert(final < initial * .5, 'Learning did not reduce loss');
  return { gradientValuesChecked: checked, maxRelativeGradientError: maxError, causalMask: true, initialLoss: initial, finalLoss: final };
}
const pairs = [
  ['こんにちは', 'こんにちは。元気？'], ['元気？', '元気だよ。'], ['おはよう', 'おはよう。いい朝だね。'], ['おやすみ', 'おやすみ。また明日。'],
  ['名前は？', 'コロだよ。'], ['何が好き？', 'りんごが好き。'], ['りんごは？', '赤くておいしい。'], ['猫は？', 'にゃーと鳴くよ。'],
  ['犬は？', 'わんと鳴くよ。'], ['ありがとう', 'どういたしまして。'], ['遊ぼう', '一緒に遊ぼう。'], ['今日は雨', '傘を持っていこう。'],
  ['今日は晴れ', '散歩に行こう。'], ['おなかすいた', 'ごはんを食べよう。'], ['何色が好き？', '青が好き。'], ['海は？', '広くて青いね。'],
  ['眠いよ', '少し休もう。'], ['またね', 'また遊ぼうね。'], ['楽しいね', 'うん、楽しいね。'], ['コロ', '呼んだ？']
];
export function benchmark(progress = () => {}) {
  progress('Validating gradients, causality and learning'); const checks = validate();
  const texts = pairs.map(([a, b]) => `ユーザー：${a}\nコロ：${b}`), tokenizer = fit(texts);
  for (const text of [...texts, '未知の漢字と絵文字🐻']) assert(decode(encode(text, tokenizer), tokenizer) === text, 'Tokenizer roundtrip');
  const multi = tokenizer.vocab.map((_, i) => decode([i], tokenizer)).filter(t => !t.includes('�') && [...t].length >= 2);
  assert(multi.length > 0, 'Missing multi-character tokens');
  const result = { checks, tokenizer: { size: tokenizer.vocab.length + 2, mergeCount: tokenizer.merges.length, multiCharacterExamples: multi.slice(-12) }, cases: [] };
  for (const config of [{ window: 128, dim: 48, layers: 3, heads: 3, vocab: 1024 }, { window: 256, dim: 96, layers: 3, heads: 3, vocab: 2048 }]) {
    progress(`Testing ${config.window}/${config.dim}`);
    const model = createTransformer(config), sequences = texts.map(t => [tokenizer.bos, ...encode(t, tokenizer), tokenizer.eos]);
    const loss = () => sequences.reduce((sum, seq) => sum + model.loss(seq.slice(0, -1), seq.slice(1)), 0) / sequences.length;
    const initialLoss = loss();
    const start = performance.now();
    for (let epoch = 0; epoch < 12; epoch++) {
      for (const seq of sequences) model.train(seq.slice(0, -1), seq.slice(1));
      progress(`${config.window}/${config.dim}: training epoch ${epoch + 1}/12`);
    }
    const trainingMs = performance.now() - start, finalLoss = loss(); assert(finalLoss < initialLoss, 'Corpus loss did not fall');
    const full = Array.from({ length: config.window }, (_, i) => i % tokenizer.vocab.length);
    model.predict(full); model.loss(full, full, true);
    const fullInference = measure(() => model.predict(full));
    const fullTraining = measure(() => model.train(full, full));
    const generation = measure(() => { const context = [...full]; for (let i = 0; i < 30; i++) { const p = model.predict(context); let best = 0; for (let j = 1; j < p.length; j++) if (p[j] > p[best]) best = j; context.push(best); } }, 3);
    const bytes = model.pack(tokenizer), restored = unpack(bytes), expected = model.predict(full), actual = restored.model.predict(full);
    assert(expected.every((v, i) => v === actual[i]), 'Weight save/load mismatch');
    assert(JSON.stringify(restored.tokenizer) === JSON.stringify(tokenizer), 'Tokenizer save/load mismatch');
    result.cases.push({ config, parameters: model.parameterCount, fileBytes: bytes.length, sequenceLengths: sequences.map(s => s.length - 1), trainingUpdates: 240, trainingMs, initialLoss, finalLoss, fullInference, fullTraining, generate30AtFullContext: generation, exactSaveReload: true });
  }
  return result;
}
