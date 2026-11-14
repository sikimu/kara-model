import assert from 'node:assert/strict';
import { createNeural } from '../src/model/neural.js';
import { createModel, MEMORY_CAPACITY, dialogueTokens } from '../src/model/model.js';

const net = createNeural();
const ids = net.encode(['<bos>', '<user>', 'あ', '<turn>', '<assistant>', 'い'], true);
const prefix = ids.slice(0, -1), target = ids.at(-1), baseline = net.snapshot();
const analytic = net.gradients(prefix, target);
for (const [key, values] of Object.entries(analytic.grad)) {
  const indices = [...values.keys()].sort((a, b) => Math.abs(values[b]) - Math.abs(values[a])).slice(0, 3);
  for (const index of indices) {
    const loss = delta => { const data = structuredClone(baseline); data.weights[key][index] += delta; net.restore(data); return -Math.log(net.forward(prefix).probs[target]); };
    const numeric = (loss(1e-5) - loss(-1e-5)) / 2e-5;
    assert.ok(Math.abs(numeric - values[index]) < 1e-5, `${key}[${index}] backward mismatch ${numeric} / ${values[index]}`);
  }
}
net.restore(baseline);
const tail = Array(24).fill(ids[2]);
assert.deepEqual(net.forward([ids[0], ...tail]).probs, net.forward([ids[3], ...tail]).probs, 'tokens outside the context window must not leak');
const history = net.train([['<bos>', '<user>', 'あ', '<turn>', '<assistant>', 'い', '<turn>', '<eos>']], 80);
assert.ok(history.at(-1).loss < history[0].loss * .7, 'cross entropy must decrease');
const a = net.predict(['<bos>', '<user>', 'あ', '<turn>', '<assistant>']);
const b = net.predict(['<bos>', '<user>', 'い', '<turn>', '<assistant>']);
assert.ok(a.some((c, i) => Math.abs(c.p - b[i].p) > 1e-8), 'prompt must affect predictions');
assert.ok(Math.abs(a.reduce((s, c) => s + c.p, 0) - 1) < 1e-12);
const copy = createNeural(); assert.equal(copy.restore(net.snapshot()), true); assert.deepEqual(copy.predict(['あ']), net.predict(['あ']));
const model = createModel({ random: () => .3 });
const dialogue = [{ speaker: '0', text: 'やあ' }, { speaker: '1', text: 'こんにちは' }, { speaker: '0', text: 'またね' }];
model.hearDialogue(dialogue);
assert.equal(model.shortMemory.length, 1); assert.deepEqual(model.shortMemory[0].turns, dialogue);
assert.deepEqual(dialogueTokens(model.shortMemory[0]).filter(t => t.startsWith('<')), ['<bos>', '<user>', '<turn>', '<assistant>', '<turn>', '<user>', '<turn>', '<eos>']);
const trace = (await model.sleepAsync()).trace;
assert.ok(trace.some(e => e.type === 'gradient' && e.loss > 0)); assert.equal(model.shortMemory.length, 0);
const restored = createModel({ random: () => .3 }); restored.restore(model.snapshot()); assert.deepEqual(restored.infer('やあ'), model.infer('やあ'));
for (let i = 0; i < MEMORY_CAPACITY + 1; i++) model.hearDialogue([{ speaker: '0', text: String(i) }, { speaker: '1', text: '返事' }]);
assert.equal(model.shortMemory.length, 20); assert.equal(model.shortMemory[0].turns[0].text, '1'); assert.equal(model.shortMemory[0].turns.length, 2);
const old = { store: {}, shortMemory: ['古いメモ'], chips: {}, stats: { sleeps: 0 } };
restored.restore(old); assert.equal(restored.shortMemory[0].turns[0].text, '古いメモ'); assert.equal(restored.chips.predictor.id, 'predictor-table');
console.log(`OK 全パラメータ群の数値微分・損失低下 ${history[0].loss.toFixed(4)} → ${history.at(-1).loss.toFixed(4)}・入力依存・重み保存・対話単位・20件・旧セーブ互換`);
