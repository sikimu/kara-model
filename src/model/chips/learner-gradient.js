export default {
  id: 'learner-gradient', slot: 'learner', name: '次トークン学習・誤差逆伝播',
  description: '交差エントロピー誤差を逆伝播し、SGDで重みを少しずつ直す',
  learn: (network, sequences) => network.train(sequences),
  async learnAsync(network, sequences) {
    const history = [];
    for (let epoch = 0; epoch < 12; epoch++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      history.push({ ...network.train(sequences, 1)[0], epoch: epoch + 1 });
    }
    return history;
  },
};
