// 教材。会話は発話ごとに「話者」「出所」「原文」を保ち、番号列は原文から作り直す。
// コト自身が生成した返事は文脈には入れるが、正解（予測対象）にも、まとまり探しの集計にも自動で入れない。

import { BOS, EOS, TURN, USER, ASSISTANT, GUEST, CONTROL } from './vocabulary.js';

export const SPEAKERS = { you: { role: USER, label: 'あなた' }, koto: { role: ASSISTANT, label: 'コト' }, guest1: { role: GUEST, label: '話す人1' }, guest2: { role: GUEST + 1, label: '話す人2' }, guest3: { role: GUEST + 2, label: '話す人3' }, guest4: { role: GUEST + 3, label: '話す人4' } };
export const SOURCES = ['user', 'koto', 'guest']; // ユーザーのお手本、コト自身の生成、招いた相手
export const speakerLabel = speaker => SPEAKERS[speaker]?.label ?? speaker;

export function normalizeTurns(turns) {
  return turns
    .filter(t => t && typeof t.text === 'string' && t.text.trim())
    .map(t => ({ speaker: SPEAKERS[t.speaker] ? t.speaker : 'guest1', source: SOURCES.includes(t.source) ? t.source : (t.speaker === 'koto' ? 'koto' : t.speaker === 'you' ? 'user' : 'guest'), text: t.text }));
}
export const conversationText = c => c.turns.map(t => t.text).join(' → ');

// 会話を 1 本の番号列にする。tokens[i] = { id, text, turn, start, end, learnable }
// learnable: その番号を「正解」にしてよいか。コトの生成文（とその直後の交代・おしまい）は正解にしない。話者の目印も正解にしない
export function sequenceOf(conversation, vocab) {
  const tokens = [{ id: BOS, text: CONTROL[BOS], turn: null, learnable: false }];
  conversation.turns.forEach((turn, index) => {
    const own = turn.source !== 'koto';
    tokens.push({ id: SPEAKERS[turn.speaker].role, text: CONTROL[SPEAKERS[turn.speaker].role], turn: index, learnable: false });
    const encoded = vocab.encode(turn.text);
    if (!encoded) throw new Error(`未登録の文字があります: ${turn.text}`);
    for (const t of encoded) tokens.push({ id: t.id, text: vocab.textOf(t.id), turn: index, start: t.start, end: t.end, learnable: own });
    tokens.push({ id: TURN, text: CONTROL[TURN], turn: index, learnable: own });
  });
  tokens.push({ id: EOS, text: CONTROL[EOS], turn: conversation.turns.length - 1, learnable: conversation.turns.at(-1)?.source !== 'koto' });
  return tokens;
}

// 文脈窓に収まる学習用の窓に分ける。重なった部分の正解は 1 度だけ使う
export function windowsOf(tokens, window) {
  const ids = tokens.map(t => t.id), result = [];
  const covered = new Set(); // すでに正解として使った位置
  const stride = Math.max(1, Math.floor(window / 2));
  for (let start = 0; start === 0 || start + 1 < ids.length; start += stride) {
    const end = Math.min(ids.length, start + window + 1); // end は正解の最後の次
    if (end - start < 2) break;
    const input = ids.slice(start, end - 1), targets = ids.slice(start + 1, end);
    const mask = targets.map((_, i) => { const at = start + 1 + i; const ok = tokens[at].learnable && !covered.has(at); if (ok) covered.add(at); return ok; });
    if (mask.some(Boolean)) result.push({ start, input, targets, mask });
    if (end >= ids.length) break;
  }
  return result;
}

// 会話の本。上限を超えたら古い会話から外す。獲得したまとまりや重みは本の整理では消えない
export function createBook(saved, limit) {
  let nextId = Number.isInteger(saved?.nextId) ? saved.nextId : 1;
  const conversations = Array.isArray(saved?.conversations) ? saved.conversations.map(c => ({ id: c.id, turns: normalizeTurns(c.turns) })) : [];
  function add(turns) {
    const conversation = { id: nextId++, turns: normalizeTurns(turns) };
    if (!conversation.turns.length) return null;
    conversations.push(conversation);
    const removed = [];
    while (conversations.length > limit) removed.push(conversations.shift());
    return { conversation, removed };
  }
  return { conversations, add, get nextId() { return nextId; }, snapshot: () => ({ nextId, conversations: structuredClone(conversations) }) };
}
