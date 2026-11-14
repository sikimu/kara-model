// 文字・まとまり・目印の対応表。番号は末尾に足すだけで、振り直しも再利用もしない。
// 「1文字」は書記素（Intl.Segmenter）。原文は正規化せず、結合文字や絵文字を途中で割らない。

import { CHAR_CAPACITY, SEGMENTER_VERSION } from './config.js';

export const CONTROL = ['<bos>', '<eos>', '<turn>', '<user>', '<assistant>', '<guest1>', '<guest2>', '<guest3>', '<guest4>'];
export const BOS = 0, EOS = 1, TURN = 2, USER = 3, ASSISTANT = 4, GUEST = 5;
export const CONTROL_LABEL = { '<bos>': 'はじまり', '<eos>': 'おしまい', '<turn>': '交代', '<user>': 'あなた', '<assistant>': 'コト', '<guest1>': '話す人1', '<guest2>': '話す人2', '<guest3>': '話す人3', '<guest4>': '話す人4' };

if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
  throw new Error('この環境では文字の区切り（Intl.Segmenter）を使えません');
}
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const graphemes = text => Array.from(segmenter.segment(text), s => s.segment);

export function createVocabulary(saved = null) {
  // entries[id] = { text, kind: 'control' | 'char' | 'merge', pair?: [a, b] }
  let entries = CONTROL.map(text => ({ text, kind: 'control' }));
  let merges = []; // [a, b, id] 追加順。適用もこの順
  const index = new Map(entries.map((e, i) => [e.text, i]));
  if (saved) {
    if (saved.segmenter !== SEGMENTER_VERSION) throw new Error('文字の区切り方の版が違います');
    if (!Array.isArray(saved.entries) || saved.entries.length < CONTROL.length) throw new Error('対応表が壊れています');
    saved.entries.forEach((e, i) => {
      if (i < CONTROL.length) { if (e.text !== CONTROL[i] || e.kind !== 'control') throw new Error('目印の番号が違います'); return; }
      if (typeof e.text !== 'string' || !e.text || !['char', 'merge'].includes(e.kind)) throw new Error(`対応表の ${i} 番が壊れています`);
      if (index.has(e.text)) throw new Error(`「${e.text}」が重複しています`);
      if (e.kind === 'merge') {
        const [a, b] = e.pair ?? [];
        if (!(Number.isInteger(a) && Number.isInteger(b) && a < i && b < i && a >= CONTROL.length && b >= CONTROL.length)) throw new Error(`まとまり ${i} の元が不正です`);
        if (saved.entries[a].text + saved.entries[b].text !== e.text) throw new Error(`まとまり「${e.text}」の元と一致しません`);
      } else if (graphemes(e.text).length !== 1) throw new Error(`「${e.text}」は1文字ではありません`);
      entries.push(e.kind === 'merge' ? { text: e.text, kind: 'merge', pair: [e.pair[0], e.pair[1]] } : { text: e.text, kind: 'char' });
      index.set(e.text, i);
    });
    merges = entries.flatMap((e, id) => e.kind === 'merge' ? [[e.pair[0], e.pair[1], id]] : []);
  }

  const counts = () => ({ chars: entries.filter(e => e.kind === 'char').length, merges: merges.length, control: CONTROL.length, total: entries.length });

  // 文字を登録する。登録した番号の一覧を返す（学習ではなく、対応表への追加）
  function registerChars(text) {
    const added = [];
    for (const ch of graphemes(text)) {
      if (index.has(ch)) continue;
      if (counts().chars >= CHAR_CAPACITY) return { added, full: true };
      const id = entries.length;
      entries.push({ text: ch, kind: 'char' });
      index.set(ch, id);
      added.push(id);
    }
    return { added, full: false };
  }
  function addMerge(a, b) {
    const text = entries[a].text + entries[b].text;
    if (index.has(text)) return null;
    const id = entries.length;
    entries.push({ text, kind: 'merge', pair: [a, b] });
    index.set(text, id);
    merges.push([a, b, id]);
    return id;
  }

  // 1つの発話を番号の列にする。各番号に原文の範囲 [start, end) を付ける。未登録の文字があれば null
  function encode(text) {
    const chars = graphemes(text);
    let tokens = [], at = 0;
    for (const ch of chars) {
      const id = index.get(ch);
      if (id == null) return null;
      tokens.push({ id, start: at, end: at + ch.length });
      at += ch.length;
    }
    for (const [a, b, id] of merges) {
      const next = [];
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].id === a && tokens[i + 1]?.id === b) { next.push({ id, start: tokens[i].start, end: tokens[i + 1].end }); i++; } else next.push(tokens[i]);
      }
      tokens = next;
    }
    return tokens;
  }
  const decode = ids => ids.map(id => entries[id]?.text ?? '').join('');
  const textOf = id => entries[id]?.text ?? '';
  const kindOf = id => entries[id]?.kind ?? null;
  const idOf = text => index.get(text) ?? null;
  const isControl = id => id < CONTROL.length;
  const has = text => index.has(text);

  function snapshot() { return { segmenter: SEGMENTER_VERSION, entries: entries.map(e => e.kind === 'merge' ? { text: e.text, kind: 'merge', pair: [...e.pair] } : { text: e.text, kind: e.kind }) }; }
  function clone() { return createVocabulary(snapshot()); }

  return { get size() { return entries.length; }, get entries() { return entries; }, get merges() { return merges; }, counts, registerChars, addMerge, encode, decode, textOf, kindOf, idOf, isControl, has, snapshot, clone };
}

export const tokenLabel = text => CONTROL_LABEL[text] ?? (text === '■' ? 'おしまい' : text);
