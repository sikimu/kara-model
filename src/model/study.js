// 机の勉強「ことばのまとまり探し」。本に残っている会話で繰り返し並ぶ 2 つの札を 1 つのまとまりにする。
// 既存の番号・重みは保つ。新しいまとまりの数は構成元 2 つの平均で始める（仮の方式。docs/vocabulary-growth-results.md）。

import { STUDY } from './config.js';
import { graphemes } from './vocabulary.js';

// 教材: 本の会話のうち、コト自身の生成文を除いた発話
export function materialOf(book) {
  const utterances = [];
  for (const conversation of book.conversations) conversation.turns.forEach((turn, index) => {
    if (turn.source === 'koto') return;
    utterances.push({ conversation: conversation.id, turn: index, speaker: turn.speaker, text: turn.text });
  });
  return utterances;
}

// 隣り合う札の組を数える。発話をまたぐ組は作らない。出現箇所に会話・発話・原文の範囲を残す
export function countPairs(utterances, vocab) {
  const counts = new Map();
  for (const u of utterances) {
    const tokens = vocab.encode(u.text);
    if (!tokens) continue;
    for (let i = 1; i < tokens.length; i++) {
      const key = `${tokens[i - 1].id},${tokens[i].id}`;
      if (!counts.has(key)) counts.set(key, { a: tokens[i - 1].id, b: tokens[i].id, count: 0, examples: [] });
      const entry = counts.get(key);
      entry.count++;
      if (entry.examples.length < 6) entry.examples.push({ conversation: u.conversation, turn: u.turn, start: tokens[i - 1].start, end: tokens[i].end });
    }
  }
  return [...counts.values()];
}

// 候補を決まった順に並べる: 回数の多い順、同数なら番号の組の小さい順。登録済み・長すぎる組は除く
export function candidatesOf(pairs, vocab) {
  return pairs
    .map(p => ({ ...p, text: vocab.textOf(p.a) + vocab.textOf(p.b) }))
    .filter(p => p.count >= STUDY.minCount && !vocab.has(p.text) && graphemes(p.text).length <= STUDY.maxChars)
    .sort((x, y) => y.count - x.count || x.a - y.a || x.b - y.b);
}

// 勉強の計画。vocab は作業用の写し（ここで書き換える）。結果コード:
//   added（追加あり）, no-material（教材なし）, no-candidate（条件を満たす新しい組なし）, full（登録上限）
export function planStudy(book, vocab, mergeLimit) {
  const utterances = materialOf(book);
  const sources = [...new Set(utterances.map(u => u.conversation))];
  if (!utterances.length) return { code: 'no-material', added: [], sources, rounds: [] };
  const added = [], rounds = [];
  let full = vocab.counts().merges >= mergeLimit;
  while (!full && added.length < STUDY.perStudy) {
    const candidates = candidatesOf(countPairs(utterances, vocab), vocab);
    rounds.push(candidates.slice(0, 8).map(c => ({ text: c.text, count: c.count, a: vocab.textOf(c.a), b: vocab.textOf(c.b) })));
    if (!candidates.length) break;
    const best = candidates[0], id = vocab.addMerge(best.a, best.b);
    added.push({ id, text: best.text, pair: [best.a, best.b], parts: [vocab.textOf(best.a), vocab.textOf(best.b)], count: best.count, examples: best.examples });
    if (vocab.counts().merges >= mergeLimit) full = true;
  }
  const code = added.length ? 'added' : full ? 'full' : 'no-candidate';
  return { code, full, added, sources, rounds };
}
