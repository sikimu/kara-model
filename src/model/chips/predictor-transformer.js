export default { id: 'predictor-transformer', slot: 'predictor', name: '小さなTransformer', description: '1層・1ヘッドの自己注意とニューラルネットで、次のトークンの確率を出す', predict: (network, tokens) => network.predict(tokens) };
