import { benchmark } from './run.mjs';
try {
  const result = benchmark(message => postMessage({ progress: message }));
  postMessage({ result });
} catch (error) { postMessage({ error: error.stack }); }
