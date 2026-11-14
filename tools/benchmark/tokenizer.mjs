// Small byte-level BPE; freeze and exchange these merges with the weights.
export function fit(texts, capacity = 1024) {
  const encoder = new TextEncoder();
  let sequences = texts.map(t => [...encoder.encode(t)]);
  const vocab = Array.from({ length: 256 }, (_, i) => [i]), merges = [];
  while (vocab.length < capacity - 2) {
    const counts = new Map();
    for (const seq of sequences) for (let i = 1; i < seq.length; i++) {
      const key = `${seq[i - 1]},${seq[i]}`; counts.set(key, (counts.get(key) || 0) + 1);
    }
    const best = [...counts].filter(([key]) => key.split(',').reduce((s, n) => s + vocab[+n].length, 0) <= 18).sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] < 2) break;
    const [a, b] = best[0].split(',').map(Number), id = vocab.length;
    vocab.push([...vocab[a], ...vocab[b]]); merges.push([a, b, id]);
    sequences = sequences.map(seq => merge(seq, a, b, id));
  }
  return { vocab, merges, bos: vocab.length, eos: vocab.length + 1 };
}
function merge(seq, a, b, id) {
  const result = [];
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] === a && seq[i + 1] === b) { result.push(id); i++; } else result.push(seq[i]);
  }
  return result;
}
export function encode(text, tokenizer) {
  let ids = [...new TextEncoder().encode(text)];
  for (const [a, b, id] of tokenizer.merges) ids = merge(ids, a, b, id);
  return ids;
}
export function decode(ids, tokenizer) {
  return new TextDecoder().decode(Uint8Array.from(ids.flatMap(i => tokenizer.vocab[i] || [])));
}
