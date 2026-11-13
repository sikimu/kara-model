export default {
  id: 'tokenizer-char',
  slot: 'tokenizer',
  name: '文字単位',
  description: '文を 1 文字ずつに切る',
  tokenize(text) {
    return Array.from(text);
  },
};
