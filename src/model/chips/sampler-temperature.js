import proportional from './sampler-proportional.js';

export default {
  id: 'sampler-temperature',
  slot: 'sampler',
  name: '温度つきの抽選',
  description: '温度を下げると確率の高い候補に集中し、上げると幅広い候補を選ぶ',
  probabilities(candidates, temperature) {
    const logs = candidates.map(c => Math.log(c.p) / temperature);
    const max = Math.max(...logs);
    const weights = logs.map(n => Math.exp(n - max));
    const total = weights.reduce((a, b) => a + b, 0);
    return candidates.map((c, i) => ({ ...c, p: weights[i] / total }));
  },
  pick: proportional.pick,
};
