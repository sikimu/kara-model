import assert from 'node:assert/strict';
import { workFrame, frameOf, stepNote, unitCount, readout, tuneChange, explainNeural, rouletteTurn, rouletteSector, arrangeNote } from '../src/ui/neural-explanation.js';
import proportional from '../src/model/chips/sampler-proportional.js';
import { createNeural } from '../src/model/neural.js';

// 学習: 重みを1個ずつ動かして見せる
const tune = { label: '注意 Q', kind: 'tune', before: [-.2, .3, 0, .1, .5, .5], values: [.1, -.4, .2, .1, .5, .6] };
const saved = structuredClone(tune);
assert.equal(unitCount(tune), 6);
assert.deepEqual(workFrame(tune, 0), { index: 0, phase: 0, count: 6 });
assert.deepEqual(workFrame(tune, .75), { index: 4, phase: .5, count: 6 });
assert.deepEqual(workFrame(tune, 1), { index: 5, phase: 1, count: 6 });
assert.deepEqual(tuneChange(tune, 1), { index: 1, before: .3, after: -.4 });
const learning = explainNeural({ mode: 'learn', epoch: 4, operation: { index: 0, k: .25 }, stages: [tune] });
assert.match(learning.title, /れんしゅう 4/);
assert.match(learning.detail, /1周分/);
assert.match(learning.detail, /0\.3000 → -0\.4000/);
assert.deepEqual(tune, saved, 'explanations must not change model values');

// 推論: 部屋ごとの記録が、実際の計算と一致する
const net = createNeural();
net.train([['<bos>', '<user>', 'や', 'あ', '<turn>', '<assistant>', 'や', 'あ', '<turn>', '<eos>']], 12);
const context = ['<bos>', '<user>', 'や', 'あ', '<turn>', '<assistant>'];
const { stages, weights } = net.inspect(context), c = net.forward(net.encode(context));
const near = (a, b) => Math.abs(a - b) < 1e-9;
assert.deepEqual(stages.map(s => s.kind), ['add', 'match', 'mix', 'add', 'gate', 'score']);
assert.deepEqual(stages.map(unitCount), [12, 6, 6, 12, 24, Math.min(5, stages[5].candidates.length)]);
for (const index of [0, 3]) stages[index].values.forEach((value, j) => assert.ok(near(value, stages[index].a[j] + stages[index].b[j]), 'たし算の部屋は a + b = 結果'));
assert.ok(near(weights.reduce((sum, w) => sum + w, 0), 1), '見る割合の合計は 100%');
stages[2].values.forEach((value, j) => assert.ok(near(value, stages[2].weights.reduce((sum, w, i) => sum + w * stages[2].parts[i][j], 0)), 'まぜる部屋は 割合 × 数 の合計'));
assert.ok(stages[4].before.every((x, j) => x >= 0 || Math.abs(stages[4].values[j]) < Math.abs(x)), 'しぼり機はマイナスを小さくする');
const predicted = net.predict(context).sort((a, b) => b.p - a.p).slice(0, 5);
stages[5].candidates.forEach((candidate, i) => { assert.equal(candidate.token, predicted[i].token); assert.ok(near(candidate.p, predicted[i].p), '点から直した確率が予測と同じ'); });
assert.deepEqual(stages[5].values, c.final);
assert.match(readout(stages[0], workFrame(stages[0], 0)), /＋.*＝/);
assert.match(explainNeural({ mode: 'infer', operation: { index: 1, k: 0 }, stages }).title, /見くらべる/);
assert.match(explainNeural({ mode: 'infer', operation: { index: 4, k: 0 }, stages }).body, /しぼり機/);

// くわしい説明: 置き終えた手順で止まり、その 1 手の数を説明する
assert.deepEqual(frameOf(stages[0], { k: 3 / 12, hold: 2 }), { index: 2, phase: 1, count: 12 });
const held = explainNeural({ mode: 'infer', operation: { index: 0, k: 3 / 12, hold: 2 }, stages });
assert.match(held.body, /いま置いたのは 3本め/);
assert.ok(held.body.includes(Math.abs(stages[0].values[2]).toFixed(2)), '説明の数は計算結果と同じ');
for (let index = 0; index < 6; index++) assert.ok(stepNote(stages[index], { index: 0, phase: 1 }, index).length > 30);
assert.match(stepNote(stages[4], { index: stages[4].before.findIndex(x => x < 0), phase: 1 }, 4), /マイナスなので/);
assert.deepEqual(explainNeural({ holdNote: { title: 'a', body: 'b', detail: 'c' } }), { title: 'a', body: 'b', detail: 'c' });
// 学習: 当てっこと、はずれの知らせ
const history = createNeural().train([['<bos>', '<user>', 'や', 'あ', '<turn>', '<assistant>', 'や', 'あ', '<turn>', '<eos>']], 3);
assert.ok(history.every(h => h.quizBefore.top.some(c => c.token === h.quizBefore.answer) && h.changes.every(c => c.moved > 0)));
assert.ok(history.at(-1).quiz.p > history[0].quizBefore.p, '練習すると正解の確率が上がる');
assert.ok(near(history[1].quizBefore.p, history[0].quiz.p), '次の周の当てっこは、前の周の結果から始まる');
assert.match(explainNeural({ mode: 'learn', epoch: 2, quiz: history[1].quizBefore }).detail, /はずれ/);
assert.match(explainNeural({ mode: 'learn', errorNote: { size: .5 }, courier: { token: null, k: .5 } }).title, /はずれの知らせ/);
assert.match(explainNeural({ mode: 'learn', quiz: history[0].quizBefore, errorNote: { size: .5 }, courier: { token: null, k: .5 } }).title, /はずれの知らせ/, '当てっこの後の運搬では逆向きの説明を優先する');

const attention = explainNeural({ courier: { token: 'あ', k: .5, from: { lane: 'attention' } }, attentionFocus: 0, attention: { weights: [.375] } });
assert.match(attention.detail, /37\.50%/);
const many = explainNeural({ courier: { tokens: ['や', 'あ'], k: .1, froms: [{ lane: 'heard' }, { lane: 'heard' }], tos: [] } });
assert.match(many.title, /2まい/);
const rows = [{ token: 'あ', p: .1 }, { token: 'い', p: .7 }, { token: '■', p: .2 }];
for (const r of [0, .099999, .1, .79999, .8, .999999]) {
  assert.equal(rouletteSector(rows, r).token, proportional.pick(rows, () => r));
  assert.ok(Math.abs(rouletteTurn(1, r) - 3 - r) < 1e-12);
}
assert.equal(rouletteTurn(0, .4), 0);
console.log('OK 部屋ごとの記録が実計算と一致・手順の区切り・説明の実数値・学習集約の明示・モデル値の不変性');

assert.match(arrangeNote('<user>', 1, '<bos>').body, /あなた/);
assert.match(arrangeNote('あ', 3, 'や').body, /「や」の次/);
assert.match(stepNote(tune, { index: 1, phase: 1 }, 0), /減らしました/);
assert.match(stepNote(tune, { index: 0, phase: 1 }, 0), /増やしました/);
assert.match(stepNote(tune, { index: 3, phase: 1 }, 0), /変わっていません/);
