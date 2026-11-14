// Isolated append-only vocabulary experiment; not used by the game.
import { createTransformer, unpack } from './transformer.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
const assert = (ok, label) => { if (!ok) throw Error(label); };
const trainTexts = ['りんごが好き。', '赤いりんご。', 'りんごを食べる。', '青い空が好き。', '青い海が好き。', '海を見る。'];
const heldout = ['赤い空を見る。', '青いりんごが好き。'];
function encode(text, t) {
  let ids = [...text].map(c => { const id = t.vocab.indexOf(c); assert(id >= 2, `Unknown test character ${c}`); return id; });
  for (const [a, b, id] of t.merges) {
    const next = [];
    for (let i = 0; i < ids.length; i++) { if (ids[i] === a && ids[i + 1] === b) { next.push(id); i++; } else next.push(ids[i]); }
    ids = next;
  }
  return ids;
}
const decode = (ids, t) => ids.map(id => t.vocab[id]).join('');
function grow(t, texts, count = 6) {
  const next = structuredClone(t), added = [];
  for (let step = 0; step < count; step++) {
    const counts = new Map();
    for (const text of texts) {
      const ids = encode(text, next);
      for (let i = 1; i < ids.length; i++) {
        const key = `${ids[i - 1]},${ids[i]}`; counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    const candidates = [...counts].filter(([key, n]) => {
      const [a, b] = key.split(',').map(Number), word = next.vocab[a] + next.vocab[b];
      return n >= 2 && [...word].length <= 6 && !next.vocab.includes(word);
    }).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (!candidates.length) break;
    const [a, b] = candidates[0][0].split(',').map(Number), id = next.vocab.length;
    next.vocab.push(next.vocab[a] + next.vocab[b]); next.merges.push([a, b, id]);
    added.push({ id, text: next.vocab[id], pair: [a, b], occurrences: candidates[0][1] });
  }
  return { tokenizer: next, added };
}
function expand(old, t, mode, seed) {
  const oldV = old.config.vocab, V = t.vocab.length, D = old.config.dim;
  const model = createTransformer({ ...old.config, vocab: V }, seed);
  for (const [key, p] of Object.entries(old.params)) {
    if (key === 'out') {
      for (let d = 0; d < D; d++) for (let i = 0; i < oldV; i++) model.params.out.x[d * V + i] = p.x[d * oldV + i];
    } else model.params[key].x.set(p.x);
  }
  if (mode === 'mean' || mode === 'mean-low-bias') {
    for (const [a, b, id] of t.merges.filter(m => m[2] >= oldV)) {
      for (let d = 0; d < D; d++) {
        model.params.embed.x[id * D + d] = (model.params.embed.x[a * D + d] + model.params.embed.x[b * D + d]) / 2;
        model.params.out.x[d * V + id] = (model.params.out.x[d * V + a] + model.params.out.x[d * V + b]) / 2;
      }
      model.params.bias.x[id] = (model.params.bias.x[a] + model.params.bias.x[b]) / 2 - (mode === 'mean-low-bias' ? 4 : 0);
    }
  }
  // Exact copy of ALL old weights, including changed-stride output matrix.
  for (const [key, p] of Object.entries(old.params)) for (let i = 0; i < p.x.length; i++) {
    const at = key === 'out' ? Math.floor(i / oldV) * V + i % oldV : i;
    assert(p.x[i] === model.params[key].x[at], `Old weight changed: ${key}/${i}`);
  }
  return model;
}
function score(model, t, texts) {
  let total = 0, chars = 0, tokens = 0;
  for (const text of texts) {
    const ids = [t.bos, ...encode(text, t), t.eos], n = ids.length - 1;
    total += model.loss(ids.slice(0, -1), ids.slice(1)) * n; chars += [...text].length; tokens += n;
  }
  return { nllPerCharacter: total / chars, lossPerToken: total / tokens, predictedTokens: tokens };
}
function train(model, t, epochs) {
  const start = performance.now();
  for (let e = 0; e < epochs; e++) for (const text of trainTexts) {
    const ids = [t.bos, ...encode(text, t), t.eos]; model.train(ids.slice(0, -1), ids.slice(1));
  }
  return performance.now() - start;
}
const base = { vocab: ['<bos>', '<eos>', ...new Set([...trainTexts, ...heldout].flatMap(s => [...s]))], merges: [], bos: 0, eos: 1 };
const { tokenizer: grown, added } = grow(base, trainTexts);
assert(added.length > 0 && added.some(x => [...x.text].length >= 2), 'No multi-character additions');
assert(base.vocab.every((v, i) => grown.vocab[i] === v), 'Old IDs changed');
assert(grown.bos === base.bos && grown.eos === base.eos, 'Special IDs changed');
for (const text of [...trainTexts, ...heldout]) assert(decode(encode(text, grown), grown) === text, 'Roundtrip');
assert(grow(grown, [], 6).added.length === 0, 'Empty corpus added tokens');
const report = { date: new Date().toISOString(), environment: { runtime: process.version, cpu: os.cpus()[0].model }, config: { window: 128, dim: 48, layers: 3, heads: 3 }, corpus: { trainTexts, heldout, pretrainEpochs: 60, continuationEpochs: 60 }, vocabulary: { before: base.vocab.length, after: grown.vocab.length, added }, cases: [] };
for (const seed of [173, 719, 2026]) {
  const old = createTransformer({ ...report.config, vocab: base.vocab.length }, seed);
  const initial = score(old, base, trainTexts), pretrainMs = train(old, base, 60), before = score(old, base, trainTexts);
  assert(before.nllPerCharacter < initial.nllPerCharacter, 'Pretraining failed');
  const heldoutBefore = score(old, base, heldout);
  const control = unpack(old.pack(base)).model;
  train(control, base, 60);
  const noGrowthContinuation = { train: score(control, base, trainTexts), heldout: score(control, base, heldout) };
  for (const mode of ['random', 'mean', 'mean-low-bias']) {
    const model = expand(old, grown, mode, seed + 1);
    const probe = [base.bos, ...encode('りんご', base)];
    const oldLogits = old.forward(probe).x, newLogits = model.forward(probe).x;
    for (let r = 0; r < probe.length; r++) for (let v = 0; v < base.vocab.length; v++) assert(oldLogits[r * base.vocab.length + v] === newLogits[r * grown.vocab.length + v], 'Old logits changed on same input');
    const p = model.predict(probe), newMass = p.slice(base.vocab.length).reduce((a, b) => a + b, 0);
    const immediate = score(model, grown, trainTexts), heldoutImmediate = score(model, grown, heldout);
    const newEmbedBefore = model.params.embed.x.slice(base.vocab.length * model.config.dim);
    const continuationMs = train(model, grown, 60), after = score(model, grown, trainTexts), heldoutAfter = score(model, grown, heldout);
    assert(Number.isFinite(after.nllPerCharacter) && after.nllPerCharacter < immediate.nllPerCharacter, 'Continuation failed');
    assert(newEmbedBefore.some((v, i) => v !== model.params.embed.x[base.vocab.length * model.config.dim + i]), 'New embedding did not learn');
    const saved = model.pack(grown), restored = unpack(saved), context = [grown.bos, ...encode('りんご', grown)];
    const expected = model.predict(context), actual = restored.model.predict(context);
    assert(expected.every((v, i) => v === actual[i]), 'Save/reload prediction mismatch');
    assert(JSON.stringify(restored.tokenizer) === JSON.stringify(grown), 'Tokenizer restore mismatch');
    const repeated = grow(grown, trainTexts, 2);
    assert(new Set(repeated.tokenizer.vocab).size === repeated.tokenizer.vocab.length, 'Duplicate vocabulary');
    assert(grown.merges.every((m, i) => JSON.stringify(m) === JSON.stringify(repeated.tokenizer.merges[i])), 'Old rules changed');
    if (repeated.added.length) {
      const again = expand(model, repeated.tokenizer, mode, seed + 2); train(again, repeated.tokenizer, 1);
      assert(Number.isFinite(score(again, repeated.tokenizer, trainTexts).nllPerCharacter), 'Second growth failed');
    }
    report.cases.push({ seed, mode, initial, before, immediate, after, heldoutBefore, heldoutImmediate, heldoutAfter, noGrowthContinuation, newProbabilityMassOnOldInput: newMass, pretrainMs, continuationMs, fileBytes: saved.length, oldWeightsAndIDsPreserved: true, oldLogitsPreservedOnSameInput: true, newEmbeddingUpdated: true, exactSaveReload: true, secondGrowthCount: repeated.added.length });
    console.log(JSON.stringify({ seed, mode, before: before.nllPerCharacter, immediate: immediate.nllPerCharacter, after: after.nllPerCharacter, newMass }));
  }
}
await mkdir(new URL('./results/', import.meta.url), { recursive: true });
await writeFile(new URL('./results/growth.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log('PASS: all growth checks; results/growth.json');
