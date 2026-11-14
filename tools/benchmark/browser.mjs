// Run: node tools/benchmark/browser.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = createServer(async (req, res) => {
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<script>window.statusData={};window.ticks=0;setInterval(()=>ticks++,100);const worker=new Worker('/worker.mjs',{type:'module'});worker.onmessage=e=>{statusData=e.data;};worker.onerror=e=>{statusData={error:e.message};};</script>`); return;
  }
  if (!['/worker.mjs', '/run.mjs', '/transformer.mjs', '/tokenizer.mjs'].includes(req.url)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(path.join(root, req.url)));
});
await new Promise(resolve => server.listen(8782, '127.0.0.1', resolve));
const profile = await mkdtemp(path.join(os.tmpdir(), 'kara-benchmark-'));
const chrome = spawn(process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9342', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore', windowsHide: true });
let ws;
try {
  let page;
  for (let i = 0; i < 50 && !page; i++) {
    await delay(200);
    try { page = (await (await fetch('http://127.0.0.1:9342/json')).json()).find(p => p.type === 'page'); } catch {}
  }
  if (!page) throw Error('Chrome did not start');
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); } });
  const send = (method, params = {}) => new Promise(resolve => { const next = ++id; pending.set(next, resolve); ws.send(JSON.stringify({ id: next, method, params })); });
  const evaluate = async expression => {
    const reply = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (reply.result.exceptionDetails) throw Error(JSON.stringify(reply.result.exceptionDetails));
    return reply.result.result.value;
  };
  const version = (await send('Browser.getVersion')).result;
  await send('Page.navigate', { url: 'http://127.0.0.1:8782/' });
  const start = Date.now(); let last = '';
  while (Date.now() - start < 15 * 60 * 1000) {
    await delay(1000);
    const status = await evaluate('window.statusData');
    if (!status) continue;
    if (status.error) throw Error(status.error);
    if (status.progress && last !== status.progress) { console.log(status.progress); last = status.progress; }
    if (status.result) {
      const result = { date: new Date().toISOString(), environment: { cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, platform: os.platform(), browser: version.product, worker: true, animation: false, gpu: false }, ...status.result, uiTimerTicks: await evaluate('window.ticks') };
      await mkdir(path.join(root, 'results'), { recursive: true });
      await writeFile(path.join(root, 'results', 'browser.json'), JSON.stringify(result, null, 2) + '\n');
      console.log(JSON.stringify(result, null, 2)); break;
    }
  }
  if (!(await evaluate('window.statusData?.result'))) throw Error('Benchmark timed out');
} finally { ws?.close(); chrome.kill(); server.close(); }
