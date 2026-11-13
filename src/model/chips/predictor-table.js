export default {
  id: 'predictor-table',
  slot: 'predictor',
  name: '集計表',
  description: '文脈の次に来た文字の回数を引く',
  predict(store, key) {
    if (!Object.hasOwn(store, key)) return [];
    return Object.entries(store[key]).map(([token, count]) => ({ token, count }));
  },
};
