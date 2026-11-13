export default {
  id: 'learner-count',
  slot: 'learner',
  name: '数えて +1',
  description: '隣り合う 2 文字ごとに回数を 1 増やす',
  learn(store, sequences, contextChip, trace) {
    for (const tokens of sequences) {
      for (let i = 1; i < tokens.length; i++) {
        const key = contextChip.key(tokens.slice(0, i));
        const token = tokens[i];
        if (!Object.hasOwn(store, key)) store[key] = {};
        const row = store[key];
        const before = Object.hasOwn(row, token) ? row[token] : 0;
        const after = before + 1;
        row[token] = after;
        trace.push({ type: 'count', key, token, before, after });
      }
    }
  },
};
