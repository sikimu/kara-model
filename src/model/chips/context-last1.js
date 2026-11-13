export default {
  id: 'context-last1',
  slot: 'context',
  name: '直前 1 文字',
  description: 'すぐ前の 1 文字だけを見る',
  key(tokens) {
    return tokens[tokens.length - 1];
  },
};
