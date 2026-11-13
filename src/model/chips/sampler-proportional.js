export default {
  id: 'sampler-proportional',
  slot: 'sampler',
  name: '回数に比例した抽選',
  description: '多く聞いた文字ほど選ばれやすい',
  pick(candidates, random) {
    const r = random();
    let sum = 0;
    for (const c of candidates) {
      sum += c.p;
      if (r < sum) return c.token;
    }
    // 丸め誤差で合計が 1 に届かなかった場合
    return candidates[candidates.length - 1].token;
  },
};
