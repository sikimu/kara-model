// 表示側の説明・案内が、記録された計算と一致し、モデルの値を変えないことを確かめる。node tools/check-neural-view.mjs
import assert from 'node:assert/strict';
import { createVisitGuide, explainNeural, roomNote, rouletteTurn, rouletteSector } from '../src/ui/neural-explanation.js';
import { simpleGuide, guidePicture, glossary } from '../src/ui/neural-guide.js';
import { createModel } from '../src/model/model.js';
import { PRESETS } from '../src/model/config.js';

// 入室ごとに 1 回。層が変われば同じ部屋でも入室。別の部屋へ移って戻ればまた説明する
const visit = createVisitGuide();
visit.enter({ lane: 'sorting' });
assert.equal(visit.take(), true);
visit.enter({ lane: 'attention', index: 8 });
assert.equal(visit.take(), false, '机や札の位置が変わっても同じ部屋なら説明しない');
visit.enter({ lane: 'work', index: 1 }, 0);
assert.equal(visit.take(), true);
assert.equal(visit.take(), false, '同じ部屋・同じ層では説明しない');
visit.enter({ lane: 'work', index: 1 }, 1);
assert.equal(visit.take(), true, '2層めの入室は別の入室として説明する');
visit.enter({ lane: 'candidates' });
assert.equal(visit.take(), true);
visit.enter({ lane: 'roulette' });
assert.equal(visit.take(), false, '候補を置く場所と抽選は同じ部屋');
visit.reset(); visit.enter({ lane: 'roulette' });
assert.equal(visit.take(), true, '頭の中を開き直したらリセット');

// 推論の記録から、部屋ごとの説明と案内を作る。数は記録そのもので、モデルの値は変わらない
const model = createModel({ random: () => .3 });
model.hearDialogue([{ speaker: 'you', source: 'user', text: 'やあ' }, { speaker: 'koto', source: 'koto', text: 'やあ' }]);
await model.sleepAsync(() => Promise.resolve());
const before = model.snapshot();
const trace = model.infer('やあ').trace, attention = trace.find(e => e.type === 'attention'), stages = attention.stages, cfg = PRESETS[0];
const saved = structuredClone(stages);
const v = { mode: 'infer', stages, operation: { index: 0, k: .5, room: 0, layer: null }, head: 0 };
const first = explainNeural(v, cfg);
assert.match(first.title, /① 文字を 数に する/);
assert.ok(first.body.includes(`${cfg.dim}個`) && first.body.includes(`${cfg.dim * 2}個にするのではありません`), '次元数は構成から出す');
const guide0 = simpleGuide(v, first, cfg);
assert.match(guide0.title, /「コト」の行を写す/, '文脈の最後はコトの番を示す目印');
assert.equal(guide0.embedding, stages[0].a, '図には実際に写した数を使う');
assert.match(guidePicture(guide0), new RegExp(`${cfg.dim}個の数`));
assert.ok(!guidePicture({ ...guide0, tokens: ['<script>'] }).includes('<script>'), '図に入力をHTMLとして埋め込まない');
for (let i = 1; i < stages.length - 1; i++) {
  const s = stages[i], note = explainNeural({ ...v, operation: { index: i, k: .5, room: s.room, layer: s.layer } }, cfg);
  assert.match(note.title, new RegExp(`${s.layer + 1}層め / ${cfg.layers}`), '層を明示する');
  const g = simpleGuide({ ...v, operation: { index: i, k: .5 } }, note, cfg);
  assert.ok(g.body.length > 30 && g.captions.length === 3);
  assert.match(guidePicture(g), /role="img"/);
}
const matchNote = explainNeural({ ...v, operation: { index: 1, k: .5, room: 1, layer: 0 }, head: 2 }, cfg);
assert.match(matchNote.detail, /ヘッド 3 を表示中/);
assert.match(roomNote(stages[1], cfg, '')[1], new RegExp(`ヘッドが${cfg.heads}つ`));
assert.match(explainNeural({ ...v, operation: { index: stages.length - 1, k: 1, room: 5, layer: null } }, cfg).title, /⑥/);
assert.deepEqual(stages, saved, '説明はトレースの値を変えない');
assert.deepEqual(model.snapshot(), before, '説明はモデルを変えない');
assert.ok(glossary['見る割合'].includes('次の札として選ばれる確率とは別'));
assert.ok(glossary['確率'].includes('必ず1回'));
assert.ok(glossary['原本'].includes('棚') && glossary['作業用バインダー'].includes('原本には残りません'));

// 学習の説明: 1 周分の更新をまとめていることを明示する
const sleepTrace = (await (async () => { model.hearDialogue([{ speaker: 'guest1', source: 'guest', text: 'こんにちは' }]); return model.sleepAsync(() => Promise.resolve()); })()).trace;
const gradient = sleepTrace.find(e => e.type === 'gradient'), tune = gradient.changes[0];
const learning = explainNeural({ mode: 'learn', epoch: gradient.epoch, epochs: gradient.epochs, stages: gradient.changes, operation: { index: 0, k: .5, room: tune.room, layer: tune.layer } }, cfg);
assert.match(learning.title, /れんしゅう 1 \/ 12/);
assert.match(learning.detail, /抜粋/);
assert.match(explainNeural({ mode: 'learn', epoch: 2, epochs: 12, quiz: gradient.quizBefore }, cfg).detail, /はずれ/);
assert.match(explainNeural({ mode: 'learn', errorNote: { size: .5 }, courier: { token: null, k: .5 } }, cfg).title, /はずれの知らせ/);
const tuneGuide = simpleGuide({ mode: 'learn', stages: gradient.changes, operation: { index: 0, k: .5 } }, learning, cfg);
assert.match(tuneGuide.title, /棚へ戻す/);
assert.match(tuneGuide.body, /文字の本|原本/);

// 勉強・登録・運搬の説明
assert.match(explainNeural({ mode: 'study', studyRound: { candidates: [{ a: 'や', b: 'あ', count: 3 }], k: 1 } }, cfg).detail, /「やあ」3回/);
assert.match(explainNeural({ mode: 'study', merging: { text: 'やあ', parts: ['や', 'あ'], count: 3, k: .5 } }, cfg).body, /3 回/);
assert.match(explainNeural({ registering: { tokens: ['猫'], k: .5 } }, cfg).detail, /登録は学習ではありません/);
const many = explainNeural({ courier: { tokens: ['や', 'あ'], k: .1, froms: [{ lane: 'heard' }, { lane: 'heard' }], tos: [{ lane: 'sorting' }] } }, cfg);
assert.match(many.title, /2まい/);
assert.match(explainNeural({ carrying: 'binder', binderPages: 6, courier: { token: null, k: .5, from: { lane: 'work', index: 0 }, to: { lane: 'work', index: 1 } } }, cfg).detail, /6ページ/);

// ルーレット: 確率区間・乱数・結果が一致する
const rows = [{ token: 'あ', p: .1 }, { token: 'い', p: .7 }, { token: '■', p: .2 }];
const pick = r => { let sum = 0; for (const row of rows) { sum += row.p; if (r < sum) return row.token; } return rows.at(-1).token; };
for (const r of [0, .099999, .1, .79999, .8, .999999]) {
  assert.equal(rouletteSector(rows, r).token, pick(r));
  assert.ok(Math.abs(rouletteTurn(1, r) - 3 - r) < 1e-12);
}
assert.equal(rouletteTurn(0, .4), 0);
console.log('OK 部屋ごとの説明が構成（次元・層・ヘッド）と記録に一致・入室の区切り・学習集約の明示・モデル値の不変性');
