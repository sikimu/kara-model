// モデルの自動検査（画面なし）。node tools/check-neural.mjs
// 勾配の検算、因果性、正解マスク、文字の登録、まとまり探し、保存復元、表示用の記録と実計算の一致を確かめる。
import assert from 'node:assert/strict';
import { createTransformer, softmax } from '../src/model/transformer.js';
import { createVocabulary, CONTROL, graphemes } from '../src/model/vocabulary.js';
import { sequenceOf, windowsOf } from '../src/model/corpus.js';
import { createModel, END, EMPTY_REPLY, PENDING_CAPACITY } from '../src/model/model.js';
import { PRESETS, STUDY } from '../src/model/config.js';
import { save, load } from '../src/save.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// 1. 勾配: 全パラメータ群から大きい 3 要素ずつを中心差分で検算（float64 の小さな構成）
{
  const tiny = createTransformer({ window: 8, dim: 6, heads: 3, layers: 2, hidden: 12 }, 12, { precision: 'float64' });
  const ids = [1, 2, 3, 2, 5], targets = [2, 3, 2, 4, 1], mask = [true, false, true, true, true];
  tiny.loss(ids, targets, mask, true);
  const saved = Object.fromEntries(Object.entries(tiny.params).map(([k, p]) => [k, [...p.g]]));
  let checked = 0;
  for (const [key, p] of Object.entries(tiny.params)) {
    const top = [...p.x.keys()].sort((a, b) => Math.abs(saved[key][b]) - Math.abs(saved[key][a])).slice(0, 3);
    for (const i of top) {
      const old = p.x[i], e = 1e-6;
      p.x[i] = old + e; const plus = tiny.loss(ids, targets, mask); p.x[i] = old - e; const minus = tiny.loss(ids, targets, mask); p.x[i] = old;
      const numeric = (plus - minus) / (2 * e), analytic = saved[key][i];
      const error = Math.abs(numeric - analytic) / Math.max(1e-6, Math.abs(numeric) + Math.abs(analytic));
      assert.ok(error < 1e-4, `${key}[${i}] の勾配が合わない: ${numeric} / ${analytic}`); checked++;
    }
  }
  assert.equal(checked, Object.keys(tiny.params).length * 3);
  // 因果性: 後ろの札を変えても前の位置の点は変わらない
  const a = Array.from(tiny.forward([1, 2, 3, 4]).x), b = Array.from(tiny.forward([1, 2, 8, 9]).x);
  assert.deepEqual(a.slice(0, 24), b.slice(0, 24));
  // 正解マスク: 対象が 0 行なら更新しない。対象行だけで損失を平均する
  assert.equal(tiny.train(ids, targets, [false, false, false, false, false], .035, 1), null);
  const only = tiny.loss([1, 2, 3], [2, 3, 2], [false, false, true]);
  const probs = softmax(tiny.forward([1, 2, 3]).x.subarray(24, 36));
  assert.ok(near(only, -Math.log(probs[2])), '最後の行だけの損失');
  // 学習で損失が下がる
  const initial = tiny.loss(ids, targets, mask); for (let i = 0; i < 80; i++) tiny.train(ids, targets, mask, .035, 1);
  assert.ok(tiny.loss(ids, targets, mask) < initial * .5, '損失が下がらない');
  // 語彙を増やしても既存の数値と既存候補の点は変わらない
  const before = Array.from(tiny.forward([1, 2, 3]).x), embed = Array.from(tiny.params.embed.x);
  tiny.grow(2, [{ embed: Array(6).fill(.1), out: Array(6).fill(.2), bias: .3 }]);
  assert.equal(tiny.vocabSize, 14); assert.deepEqual(Array.from(tiny.params.embed.x.subarray(0, 72)), embed);
  const after = Array.from(tiny.forward([1, 2, 3]).x);
  for (let r = 0; r < 3; r++) for (let v = 0; v < 12; v++) assert.ok(near(before[r * 12 + v], after[r * 14 + v]), '旧候補の点が変わった');
  assert.equal(tiny.params.bias.x[12], .3); assert.equal(tiny.params.bias.x[13], 0);
}

// 2. 対応表: 文字の区切り、登録、まとまり、往復
{
  const vocab = createVocabulary();
  assert.deepEqual(graphemes('が👨‍👩‍👧え'), ['が', '👨‍👩‍👧', 'え'], '結合文字と絵文字を割らない');
  const { added, full } = vocab.registerChars('りんごが好き。りんご');
  assert.equal(full, false); assert.equal(added.length, 7);
  assert.equal(vocab.registerChars('りんご').added.length, 0, '登録済みの文字は増えない');
  const tokens = vocab.encode('りんごが好き。');
  assert.equal(tokens.length, 7); assert.deepEqual(tokens.map(t => [t.start, t.end]), [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]]);
  assert.equal(vocab.encode('未登録'), null);
  const id = vocab.addMerge(vocab.idOf('り'), vocab.idOf('ん'));
  assert.equal(id, vocab.size - 1); assert.equal(vocab.textOf(id), 'りん'); assert.equal(vocab.kindOf(id), 'merge');
  assert.equal(vocab.addMerge(vocab.idOf('り'), vocab.idOf('ん')), null, '同じまとまりを二重登録しない');
  const merged = vocab.encode('りんごりん');
  assert.deepEqual(merged.map(t => vocab.textOf(t.id)), ['りん', 'ご', 'りん']);
  assert.deepEqual(merged.map(t => [t.start, t.end]), [[0, 2], [2, 3], [3, 5]], 'まとまりも原文の範囲を保つ');
  assert.equal(vocab.decode(merged.map(t => t.id)), 'りんごりん');
  const restored = createVocabulary(vocab.snapshot());
  assert.deepEqual(restored.entries, vocab.entries); assert.deepEqual(restored.merges, vocab.merges);
  assert.equal(vocab.counts().merges, 1); assert.equal(vocab.counts().control, CONTROL.length);
  // 系列: コトの生成文は正解にしない。話者の目印も正解にしない
  const seq = sequenceOf({ turns: [{ speaker: 'you', source: 'user', text: 'りんご' }, { speaker: 'koto', source: 'koto', text: 'ご' }] }, vocab);
  assert.deepEqual(seq.map(t => t.text), ['<bos>', '<user>', 'りん', 'ご', '<turn>', '<assistant>', 'ご', '<turn>', '<eos>']);
  assert.deepEqual(seq.map(t => t.learnable), [false, false, true, true, true, false, false, false, false]);
  // 窓分け: 重なった正解を二重に使わない
  const long = Array.from({ length: 20 }, (_, i) => ({ id: i % 5 + 9, text: 'x', learnable: true }));
  const windows = windowsOf(long, 8), used = windows.flatMap(w => w.mask.map((m, i) => m ? w.start + 1 + i : -1).filter(i => i >= 0));
  assert.equal(new Set(used).size, used.length); assert.equal(used.length, 19);
  for (const w of windows) assert.ok(w.input.length <= 8 && w.input.length === w.targets.length && w.targets.length === w.mask.length);
}

// 3. モデル: 推論・聞く・眠る・記録の一致・保存復元
{
  const model = createModel({ random: () => .3 });
  assert.equal(model.infer('やあ').text, EMPTY_REPLY, '学習前は無言');
  assert.equal(model.vocab.counts().chars, 2, '推論の入力でも文字を登録する');
  const dialogue = [{ speaker: 'guest1', source: 'guest', text: 'やあ' }, { speaker: 'guest2', source: 'guest', text: 'こんにちは' }, { speaker: 'guest1', source: 'guest', text: 'またね' }];
  const heard = model.hearDialogue(dialogue);
  assert.ok(heard.trace.some(e => e.type === 'register') && heard.trace.some(e => e.type === 'hear'));
  assert.equal(model.pending.length, 1); assert.equal(model.book.conversations.length, 1);
  model.hearDialogue([{ speaker: 'you', source: 'user', text: 'やあ' }, { speaker: 'koto', source: 'koto', text: 'こんにちは' }]);
  const { trace } = await model.sleepAsync(() => Promise.resolve());
  assert.equal(trace.filter(e => e.type === 'replay').length, 2);
  const gradients = trace.filter(e => e.type === 'gradient');
  assert.equal(gradients.length, 12); assert.ok(gradients.at(-1).loss < gradients[0].loss, '周回で損失が下がる');
  assert.ok(gradients[0].quizBefore.top.some(c => c.token === gradients[0].quizBefore.answer));
  assert.ok(gradients.at(-1).quiz.p > gradients[0].quizBefore.p, '練習で正解の確率が上がる');
  for (const c of gradients.at(-1).changes) {
    assert.deepEqual(c.values, c.indices.map(i => model.net.params[c.parameter].x[i]), '学習後の値は原本そのもの');
    assert.ok(Number.isInteger(c.room) && c.room >= 0 && c.room <= 5);
    if (c.tokens) c.tokens.forEach((t, j) => assert.equal(t, model.vocab.textOf(Math.floor(c.indices[j] / 48))));
  }
  assert.equal(gradients.at(-1).changes.filter(c => c.room === 1).length, 3, '層ごとに②の本を記録する');
  assert.equal(model.pending.length, 0); assert.equal(model.book.conversations.length, 2, '眠っても会話の本は残る');
  assert.equal(model.stats().sleeps, 1); assert.ok(model.stats().updates > 0);
  // 推論の記録と実計算
  const result = model.infer('やあ');
  const attention = result.trace.find(e => e.type === 'attention');
  assert.deepEqual(attention.tokens, ['<bos>', '<user>', 'や', 'あ', '<turn>', '<assistant>']);
  const stages = attention.stages, cfg = PRESETS[0];
  assert.equal(stages.length, 2 + 4 * cfg.layers);
  assert.deepEqual(stages.map(s => s.room), [0, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 5]);
  assert.equal(stages[0].entries.length, 6); assert.equal(stages[0].a.length, cfg.dim);
  for (const e of stages[0].entries) e.values.forEach((v, j) => assert.ok(near(v, e.a[j] + e.b[j]), '①は文字の数 + 順番の数'));
  for (const s of stages.filter(s => s.kind === 'match')) {
    assert.equal(s.heads.length, cfg.heads);
    for (const h of s.heads) { assert.ok(near(h.weights.reduce((a, b) => a + b, 0), 1), 'ヘッドごとに見る割合の合計は 100%'); assert.equal(h.keys.length, 6); }
  }
  for (const s of stages.filter(s => s.kind === 'mix')) s.heads.forEach((h, hi) => h.values.forEach((v, d) => assert.ok(near(v, h.weights.reduce((sum, w, i) => sum + w * h.parts[i][d], 0)), `③は割合 × 数の合計（ヘッド${hi}）`)));
  for (const s of stages.filter(s => s.kind === 'add' && s.room === 3)) s.values.forEach((v, j) => assert.ok(near(v, s.a[j] + s.b[j]), '④は層の入力 + 注意の投影'));
  const adds = stages.filter(s => s.room === 3), gates = stages.filter(s => s.room === 4);
  assert.deepEqual(adds[1].a, gates[0].after, '2層めの入力は 1層めの出力そのもの（①の値を足し直さない）');
  for (const s of gates) { assert.equal(s.before.length, cfg.hidden); s.after.forEach((v, j) => assert.ok(near(v, s.a[j] + s.b[j]), '⑤の 2 回目の残差')); }
  const score = stages.at(-1), probs = result.trace.find(e => e.type === 'probs').candidates;
  const top = [...probs].sort((a, b) => b.p - a.p).slice(0, 5);
  score.candidates.forEach((c, i) => { assert.equal(c.token, top[i].token); assert.ok(near(c.p, top[i].p)); });
  assert.ok(near(probs.reduce((s, c) => s + c.p, 0), 1)); assert.ok(probs.some(c => c.token === END) && !probs.some(c => c.token.startsWith('<')));
  const picked = result.trace.find(e => e.type === 'pick');
  let sum = 0, expected = null; for (const c of probs) { sum += c.p; if (picked.r < sum) { expected = c.token; break; } }
  assert.equal(picked.token, expected, '抽選は記録した乱数と確率で決まる');
  // 保存復元
  const data = model.snapshot();
  const restored = createModel({ saved: structuredClone(data), random: () => .3 });
  assert.deepEqual(restored.infer('やあ').text, model.infer('やあ').text);
  assert.deepEqual(Array.from(restored.net.predict([0, 3, 9])), Array.from(model.net.predict([0, 3, 9])), '復元後の予測が一致');
  assert.equal(restored.book.conversations.length, 2); assert.equal(restored.config.dim, 48); assert.equal(restored.limits.conversations, 30);
  globalThis.localStorage = { store: new Map(), setItem(k, v) { this.store.set(k, v); }, getItem(k) { return this.store.has(k) ? this.store.get(k) : null; }, removeItem(k) { this.store.delete(k); } };
  assert.equal(save(data), true); assert.equal(load().status, 'ok'); assert.deepEqual(load().data.revision, data.revision);
  localStorage.setItem('kara-model-save', JSON.stringify({ version: 1, store: {} })); assert.equal(load().status, 'old');
  localStorage.setItem('kara-model-save', '{"formatVersion":2'); assert.equal(load().status, 'invalid');
  const broken = structuredClone(data); broken.parameters.params.embed = broken.parameters.params.embed.slice(0, 40);
  assert.throws(() => createModel({ saved: broken }), '壊れた原本は読み込みで止める');
  const otherShape = structuredClone(data); otherShape.config = { ...otherShape.config, dim: 12 };
  assert.throws(() => createModel({ saved: otherShape }), '検証済みでない構成は受け付けない');
  // 学習待ちの上限
  for (let i = 0; i < PENDING_CAPACITY + 1; i++) model.hearDialogue([{ speaker: 'guest1', source: 'guest', text: String(i) }]);
  assert.equal(model.pending.length, PENDING_CAPACITY); assert.equal(model.book.conversations.length, 23);
  console.log(`OK モデル: 勾配・因果性・マスク・記録の一致・保存復元・損失 ${gradients[0].loss.toFixed(3)} → ${gradients.at(-1).loss.toFixed(3)}`);
}

// 4. 机の勉強: 繰り返す並びをまとまりにし、既存の番号・重みを保つ
{
  const model = createModel({ random: () => .5 });
  const empty = model.study();
  assert.equal(empty.result.code, 'no-material'); assert.equal(empty.next, null);
  for (const text of ['りんごが好き。', '赤いりんご。', 'りんごを食べる。']) model.hearDialogue([{ speaker: 'you', source: 'user', text }, { speaker: 'koto', source: 'koto', text: 'りんごりんごりんご' }]);
  await model.sleepAsync(() => Promise.resolve());
  const before = model.snapshot(), oldSize = model.vocab.size, oldEmbed = Array.from(model.net.params.embed.x), oldOut = Array.from(model.net.params.out.x);
  const oldProbs = Array.from(model.net.predict([0, 3, model.vocab.idOf('り')]));
  const { result, next, trace } = model.study();
  assert.equal(result.code, 'added'); assert.ok(result.added.length > 0 && result.added.length <= STUDY.perStudy);
  assert.ok(result.added.some(m => m.text === 'りん'), `繰り返す「りん」をまとめる: ${result.added.map(m => m.text)}`);
  assert.ok(result.added.every(m => m.count >= STUDY.minCount && m.examples.every(e => e.text.includes(m.text))));
  assert.ok(!result.added.some(m => m.count >= 9), 'コトの生成文「りんごりんごりんご」は集計に入れない');
  assert.equal(trace[0].type, 'study'); assert.equal(result.sources.length, 3);
  assert.deepEqual(model.snapshot(), before, 'study は呼んだモデルを変えない');
  // next: 旧番号・旧重みはそのまま。新しい欄は構成元の平均
  assert.equal(next.vocab.size, oldSize + result.added.length);
  for (let i = 0; i < oldSize; i++) assert.equal(next.vocab.textOf(i), model.vocab.textOf(i));
  assert.deepEqual(Array.from(next.net.params.embed.x.subarray(0, oldEmbed.length)), oldEmbed);
  assert.deepEqual(Array.from(next.net.params.out.x.subarray(0, oldOut.length)), oldOut);
  const first = result.added[0], [a, b] = first.pair;
  next.net.rowOf('embed', first.id).forEach((v, d) => assert.ok(near(v, (oldEmbed[a * 48 + d] + oldEmbed[b * 48 + d]) / 2, 1e-6)));
  const newProbs = Array.from(next.net.predict([0, 3, model.vocab.idOf('り')]));
  const oldLogits = Array.from(model.net.forward([0, 3, model.vocab.idOf('り')]).x).slice(2 * oldSize), newLogits = Array.from(next.net.forward([0, 3, model.vocab.idOf('り')]).x).slice(2 * next.vocab.size);
  oldLogits.forEach((v, i) => assert.ok(near(v, newLogits[i], 1e-5), '旧候補の点はそのまま')); assert.ok(newProbs.length > oldProbs.length);
  const encoded = next.vocab.encode('りんごが好き。');
  assert.ok(encoded.some(t => next.vocab.kindOf(t.id) === 'merge'), '追加後は同じ文章をまとまりで読む');
  assert.equal(next.vocab.decode(encoded.map(t => t.id)), 'りんごが好き。');
  // 採用して続ける: 推論・学習・保存復元
  model.adopt(next);
  assert.equal(model.vocab.size, oldSize + result.added.length); assert.ok(model.progress.lastStudy.added.length > 0);
  const reply = model.infer('りんご'); assert.ok(reply.trace.some(e => e.type === 'attention'));
  model.hearDialogue([{ speaker: 'you', source: 'user', text: 'りんごが好き。' }]);
  const learned = await model.sleepAsync(() => Promise.resolve());
  assert.ok(learned.trace.some(e => e.type === 'replay' && e.tokens.some(t => !t.startsWith('<') && graphemes(t).length >= 2)), 'まとまりを学習に使う');
  const again = createModel({ saved: model.snapshot(), random: () => .5 });
  assert.deepEqual(Array.from(again.net.predict([0, 3, model.vocab.idOf('りん')])), Array.from(model.net.predict([0, 3, model.vocab.idOf('りん')])));
  // 2 回目: 重複登録しない。上限で止まる
  const second = model.study();
  if (second.next) { assert.ok(second.result.added.every(m => !result.added.some(x => x.text === m.text))); model.adopt(second.next); }
  const limited = createModel({ limits: { conversations: 10, merges: 32 }, random: () => .5 });
  for (let i = 0; i < 40; i++) limited.hearDialogue([{ speaker: 'you', source: 'user', text: 'あいうえおかきくけこさしすせそ' }]);
  assert.equal(limited.book.conversations.length, 10, '本の上限で古い会話から外す');
  let rounds = 0;
  while (rounds++ < 40) { const s = limited.study(); if (s.code === 'full' || !s.next) { assert.ok(['full', 'no-candidate'].includes(s.result.code)); break; } limited.adopt(s.next); }
  assert.ok(limited.vocab.counts().merges <= 32, 'まとまりの登録上限を超えない');
  assert.equal(limited.study().result.code, limited.vocab.counts().merges >= 32 ? 'full' : 'no-candidate');
  assert.equal(limited.register('新').full, false, 'まとまりが満杯でも文字は別枠で登録できる');
  console.log(`OK 勉強: ${result.added.map(m => `${m.text}(${m.count})`).join(' ')} ・ 旧番号と重みの保持・採用後の学習・保存復元・上限`);
}
