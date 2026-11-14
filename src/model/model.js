// 空モデル本体。DOM にも three.js にも触れない。
// 推論・学習は結果と一緒にトレース（手順の配列）を返す。

import tokenizerChar from './chips/tokenizer-char.js';
import contextLast1 from './chips/context-last1.js';
import predictorTable from './chips/predictor-table.js';
import samplerProportional from './chips/sampler-proportional.js';
import learnerCount from './chips/learner-count.js';
import samplerTemperature from './chips/sampler-temperature.js';
import contextCausal from './chips/context-causal.js';
import predictorTransformer from './chips/predictor-transformer.js';
import learnerGradient from './chips/learner-gradient.js';
import { createNeural } from './neural.js';

export const BOS = '▶'; // 話者交代
export const EOS = '■'; // 文末
export const EMPTY_REPLY = '……';
export const MAX_OUTPUT = 30;
export const MEMORY_CAPACITY = 20;
export const memoryText = entry => typeof entry === 'string' ? entry : entry.turns.map(t => t.text).join(' → ');
const memoryEntry = entry => typeof entry === 'string' ? { turns: [{ speaker: 'unknown', text: entry }] } : structuredClone(entry);
export function dialogueTokens(entry, tokenize = Array.from) {
  const turns = memoryEntry(entry).turns, speakers = [...new Set(turns.map(t => t.speaker))];
  const roles = ['<user>', '<assistant>', '<speaker2>', '<speaker3>'];
  return ['<bos>', ...turns.flatMap(t => [roles[Math.min(3, speakers.indexOf(t.speaker))], ...tokenize(t.text), '<turn>']), '<eos>'];
}

export function createModel({ random = Math.random } = {}) {
  const chips = {
    tokenizer: tokenizerChar,
    context: contextCausal,
    predictor: predictorTransformer,
    sampler: samplerProportional,
    learner: learnerGradient,
  };
  const store = {};       // 集計表: 文脈キー → { 次の文字 → 回数 }
  const shortMemory = []; // 短期記憶（文の配列）
  const stats = { sleeps: 0 };
  const options = { temperature: 1 };
  const tutorial = { step: 0, reflection: null };
  const samplers = [samplerProportional, samplerTemperature];
  const network = createNeural();
  const neural = () => chips.predictor === predictorTransformer;
  function setArchitecture(id) {
    if (!['transformer', 'count'].includes(id)) return false;
    chips.context = id === 'transformer' ? contextCausal : contextLast1;
    chips.predictor = id === 'transformer' ? predictorTransformer : predictorTable;
    chips.learner = id === 'transformer' ? learnerGradient : learnerCount;
    return true;
  }
  function setSampler(id, temperature = options.temperature) {
    const chip = samplers.find(c => c.id === id);
    if (!chip || !Number.isFinite(temperature) || temperature < 0.25 || temperature > 2) return false;
    chips.sampler = chip;
    options.temperature = temperature;
    return true;
  }

  // 推論。Transformerは入力と生成済みトークンを文脈にする。実験用集計モデルは直前1文字。
  function infer(text) {
    const trace = [];
    trace.push({ type: 'tokenize', tokens: chips.tokenizer.tokenize(text) });

    const context = [BOS];
    const neuralContext = ['<bos>', '<user>', ...chips.tokenizer.tokenize(text), '<turn>', '<assistant>'];
    const output = [];
    let reason;
    for (;;) {
      const key = chips.context.key(context);
      const found = neural() ? chips.predictor.predict(network, neuralContext) : chips.predictor.predict(store, key);
      if (neural()) trace.push({ type: 'attention', ...network.inspect(neuralContext) });
      trace.push({ type: 'lookup', key, found: found.length > 0 });
      if (found.length === 0) { reason = 'empty'; break; }

      const total = found.reduce((sum, c) => sum + c.count, 0);
      let candidates = neural() ? found : found.map((c) => ({ ...c, p: c.count / total }));
      if (chips.sampler.probabilities) candidates = chips.sampler.probabilities(candidates, options.temperature);
      trace.push({ type: 'probs', candidates });

      const r = random();
      const token = chips.sampler.pick(candidates, () => r);
      trace.push({ type: 'pick', token, r });
      if (token === EOS) { reason = 'eos'; break; }

      trace.push({ type: 'emit', token });
      output.push(token);
      context.push(token);
      neuralContext.push(token);
      if (output.length >= MAX_OUTPUT) { reason = 'limit'; break; }
    }
    trace.push({ type: 'end', reason });

    return { text: output.length > 0 ? output.join('') : EMPTY_REPLY, trace };
  }

  // 聞く。短期記憶にためるだけで、集計表は変えない
  function hear(text) {
    return hearDialogue([{ speaker: 'unknown', text }]);
  }
  function hearDialogue(turns) {
    const entry = { turns: turns.filter(t => typeof t.text === 'string' && t.text.trim()).map(t => ({ speaker: String(t.speaker), text: t.text })) };
    if (!entry.turns.length) return { trace: [] };
    const trace = [{ type: 'hear', text: memoryText(entry) }];
    shortMemory.push(entry);
    while (shortMemory.length > MEMORY_CAPACITY) {
      trace.push({ type: 'forget', text: memoryText(shortMemory.shift()) });
    }
    return { trace };
  }

  // 眠る。短期記憶を 1 文ずつ再生して集計表を更新し、短期記憶を空にする
  function sleep() {
    const trace = [];
    if (neural() && shortMemory.length) {
      const entries = structuredClone(shortMemory);
      const history = chips.learner.learn(network, entries.map(entry => dialogueTokens(entry, chips.tokenizer.tokenize)));
      for (const entry of entries) {
        trace.push({ type: 'replay', text: memoryText(entry), tokens: dialogueTokens(entry, chips.tokenizer.tokenize), neural: true });
        trace.push({ type: 'forget', text: memoryText(entry) });
      }
      trace.push(...history.map(h => ({ type: 'gradient', ...h })));
      shortMemory.length = 0;
      stats.sleeps++;
      return { trace };
    }
    while (shortMemory.length > 0) {
      const entry = memoryEntry(shortMemory.shift());
      const text = memoryText(entry);
      for (const turn of entry.turns) {
        const tokens = [BOS, ...chips.tokenizer.tokenize(turn.text), EOS];
        trace.push({ type: 'replay', text, tokens });
        chips.learner.learn(store, [tokens], chips.context, trace);
      }
      trace.push({ type: 'forget', text });
    }
    stats.sleeps += 1;
    return { trace };
  }
  async function sleepAsync() {
    if (!neural() || !shortMemory.length) return sleep();
    const entries = structuredClone(shortMemory);
    const history = await chips.learner.learnAsync(network, entries.map(entry => dialogueTokens(entry, chips.tokenizer.tokenize)));
    const trace = entries.flatMap(entry => [
      { type: 'replay', text: memoryText(entry), tokens: dialogueTokens(entry, chips.tokenizer.tokenize), neural: true },
      { type: 'forget', text: memoryText(entry) },
    ]);
    trace.push(...history.map(h => ({ type: 'gradient', ...h })));
    shortMemory.splice(0, entries.length);
    stats.sleeps++;
    return { trace };
  }

  // セーブ用に今の状態を取り出す
  function snapshot() {
    return {
      store: structuredClone(store),
      shortMemory: structuredClone(shortMemory),
      neural: network.snapshot(),
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
    shortMemory.push(...data.shortMemory.slice(-MEMORY_CAPACITY).map(memoryEntry));
    stats.sleeps = data.stats?.sleeps ?? 0;
    setSampler('sampler-proportional', 1);
    setSampler(data.chips?.sampler, data.options?.temperature ?? 1);
    const restoredNeural = network.restore(data.neural);
    setArchitecture(data.chips?.predictor === 'predictor-transformer' && restoredNeural ? 'transformer' : 'count');
    tutorial.step = Number.isInteger(data.tutorial?.step) && data.tutorial.step >= 0 && data.tutorial.step <= 4
      ? data.tutorial.step : (stats.sleeps > 0 || Object.keys(store).length > 0 ? 4 : 0);
    tutorial.reflection = ['first-talk', 'heard', 'slept', 'replied', 'quiet'].includes(data.tutorial?.reflection)
      ? data.tutorial.reflection : null;
  }

  return { chips, store, shortMemory, stats, options, tutorial, samplers, network, setArchitecture, setSampler, infer, hear, hearDialogue, sleep, sleepAsync, snapshot, restore };
}
