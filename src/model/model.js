// 空モデル本体。DOM にも three.js にも触れない。
// 推論・学習は結果と一緒にトレース（手順の配列）を返す。

import tokenizerChar from './chips/tokenizer-char.js';
import contextLast1 from './chips/context-last1.js';
import predictorTable from './chips/predictor-table.js';
import samplerProportional from './chips/sampler-proportional.js';
import learnerCount from './chips/learner-count.js';
import samplerTemperature from './chips/sampler-temperature.js';

export const BOS = '▶'; // 話者交代
export const EOS = '■'; // 文末
export const EMPTY_REPLY = '……';
export const MAX_OUTPUT = 30;
export const MEMORY_CAPACITY = 5;

export function createModel({ random = Math.random } = {}) {
  const chips = {
    tokenizer: tokenizerChar,
    context: contextLast1,
    predictor: predictorTable,
    sampler: samplerProportional,
    learner: learnerCount,
  };
  const store = {};       // 集計表: 文脈キー → { 次の文字 → 回数 }
  const shortMemory = []; // 短期記憶（文の配列）
  const stats = { sleeps: 0 };
  const options = { temperature: 1 };
  const tutorial = { step: 0, reflection: null };
  const samplers = [samplerProportional, samplerTemperature];
  function setSampler(id, temperature = options.temperature) {
    const chip = samplers.find(c => c.id === id);
    if (!chip || !Number.isFinite(temperature) || temperature < 0.25 || temperature > 2) return false;
    chips.sampler = chip;
    options.temperature = temperature;
    return true;
  }

  // 推論。入力文は切り分けるだけで、返事には影響しない（初期チップ構成の制約）
  function infer(text) {
    const trace = [];
    trace.push({ type: 'tokenize', tokens: chips.tokenizer.tokenize(text) });

    const context = [BOS];
    const output = [];
    let reason;
    for (;;) {
      const key = chips.context.key(context);
      const found = chips.predictor.predict(store, key);
      trace.push({ type: 'lookup', key, found: found.length > 0 });
      if (found.length === 0) { reason = 'empty'; break; }

      const total = found.reduce((sum, c) => sum + c.count, 0);
      let candidates = found.map((c) => ({ ...c, p: c.count / total }));
      if (chips.sampler.probabilities) candidates = chips.sampler.probabilities(candidates, options.temperature);
      trace.push({ type: 'probs', candidates });

      const r = random();
      const token = chips.sampler.pick(candidates, () => r);
      trace.push({ type: 'pick', token, r });
      if (token === EOS) { reason = 'eos'; break; }

      trace.push({ type: 'emit', token });
      output.push(token);
      context.push(token);
      if (output.length >= MAX_OUTPUT) { reason = 'limit'; break; }
    }
    trace.push({ type: 'end', reason });

    return { text: output.length > 0 ? output.join('') : EMPTY_REPLY, trace };
  }

  // 聞く。短期記憶にためるだけで、集計表は変えない
  function hear(text) {
    const trace = [{ type: 'hear', text }];
    shortMemory.push(text);
    while (shortMemory.length > MEMORY_CAPACITY) {
      trace.push({ type: 'forget', text: shortMemory.shift() });
    }
    return { trace };
  }

  // 眠る。短期記憶を 1 文ずつ再生して集計表を更新し、短期記憶を空にする
  function sleep() {
    const trace = [];
    while (shortMemory.length > 0) {
      const text = shortMemory.shift();
      const tokens = [BOS, ...chips.tokenizer.tokenize(text), EOS];
      trace.push({ type: 'replay', text, tokens });
      chips.learner.learn(store, [tokens], chips.context, trace);
      trace.push({ type: 'forget', text });
    }
    stats.sleeps += 1;
    return { trace };
  }

  // セーブ用に今の状態を取り出す
  function snapshot() {
    return {
      store: structuredClone(store),
      shortMemory: [...shortMemory],
      chips: Object.fromEntries(Object.entries(chips).map(([slot, chip]) => [slot, chip.id])),
      stats: { ...stats },
      options: { ...options },
      tutorial: { ...tutorial },
    };
  }

  // snapshot() の形のデータで状態を置き換える
  function restore(data) {
    for (const key of Object.keys(store)) delete store[key];
    Object.assign(store, structuredClone(data.store));
    shortMemory.length = 0;
    shortMemory.push(...data.shortMemory.slice(-MEMORY_CAPACITY));
    stats.sleeps = data.stats?.sleeps ?? 0;
    setSampler('sampler-proportional', 1);
    setSampler(data.chips?.sampler, data.options?.temperature ?? 1);
    tutorial.step = Number.isInteger(data.tutorial?.step) && data.tutorial.step >= 0 && data.tutorial.step <= 4
      ? data.tutorial.step : (stats.sleeps > 0 || Object.keys(store).length > 0 ? 4 : 0);
    tutorial.reflection = ['first-talk', 'heard', 'slept', 'replied', 'quiet'].includes(data.tutorial?.reflection)
      ? data.tutorial.reflection : null;
  }

  return { chips, store, shortMemory, stats, options, tutorial, samplers, setSampler, infer, hear, sleep, snapshot, restore };
}
