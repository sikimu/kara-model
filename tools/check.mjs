// 動作確認。ヘッドレス Chrome でゲームを通しで動かし、画面写真を tools/out/ に保存する。
// 使い方: node tools/check.mjs            （PC の画面 1600x900）
//         node tools/check.mjs --slow     （ふつうの速度で動かす。演出を画面写真で見たいとき）
// 依存なし（Node 22 以上と Chrome が要る）。Chrome の場所は環境変数 CHROME で変えられる。
// 終了コード: 画面のエラーや期待外れがあれば 1。

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools', 'out');
const PORT = 8766;
const DEBUG_PORT = 9334;
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SLOW = process.argv.includes('--slow');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// リポジトリをそのまま配る小さなサーバー
const server = createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORT, '127.0.0.1');

const profile = path.join(os.tmpdir(), `kara-check-${process.pid}`);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });

const problems = [];
const logs = [];
try {
  await mkdir(OUT, { recursive: true });
  let page;
  for (let i = 0; i < 50 && !page; i++) {
    await sleep(200);
    try {
      page = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()).find((t) => t.type === 'page');
    } catch { /* まだ起動中 */ }
  }
  if (!page) throw new Error('Chrome に接続できない');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') logs.push(`例外: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') logs.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) logs.push(`HTTP ${msg.params.response.status} ${msg.params.response.url}`);
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate に失敗');
    return r.result.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
  };
  const expect = (label, ok, detail = '') => {
    console.log(`${ok ? 'OK ' : 'NG '} ${label}${detail ? `: ${detail}` : ''}`);
    if (!ok) problems.push(label);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  const url = `http://127.0.0.1:${PORT}/index.html`;
  const load = async () => { await send('Page.navigate', { url }); await sleep(3500); };

  // まっさらな状態から始める。速度は --slow でなければ一番はやく
  await load();
  await evaluate(`localStorage.clear(); localStorage.setItem('kara-model-ui', JSON.stringify({ speedIndex: ${SLOW ? 5 : 9}, skip: false }))`);
  await load();

  const busy = () => evaluate(`document.querySelector('.bottom').disabled`);
  const done = async (limit = 240000) => {
    const t0 = Date.now();
    await sleep(200);
    while (await busy()) {
      if (Date.now() - t0 > limit) throw new Error('演出が終わらない');
      await sleep(150);
    }
  };
  const tab = (name) => evaluate(`[...document.querySelectorAll('.tabs button')].find((b) => b.textContent.includes(${JSON.stringify(name)})).click()`);
  const state = () => evaluate(`JSON.stringify({ rows: Object.keys(kara.store).length, mem: kara.shortMemory, sleeps: kara.stats.sleeps })`).then(JSON.parse);

  expect('起動して操作できる', (await busy()) === false);
  await shot('1-home.png');

  // 会話（空の状態）
  await tab('会話');
  await evaluate(`(() => { const i = document.querySelector('.talk-form input'); i.value = 'やあ'; document.querySelector('.talk-form').requestSubmit(); })()`);
  await sleep(SLOW ? 2600 : 1500);
  await shot('2-thinking.png');
  await done();
  expect('空の状態では「……」を返す', (await evaluate(`document.querySelector('.log-line:last-child').textContent`)).includes('……'));

  // 盗み聞き（お手本を入れて、まちの ひろば へ）
  await tab('盗み聞き');
  await evaluate(`document.querySelector('.listen-sample').click(); document.querySelector('.listen-go').click()`);
  await sleep(SLOW ? 9000 : 4000);
  await shot('3-plaza.png');
  await done();
  let s = await state();
  expect('聞いた文が短期記憶にたまる', s.mem.length > 0, s.mem.join(' / '));
  expect('眠る前は集計表が変わらない', s.rows === 0);

  // 睡眠（夢の中で学習）
  await tab('睡眠');
  await evaluate(`document.querySelector('.sleep-button').click()`);
  await sleep(SLOW ? 9000 : 4500);
  await shot('4-dream.png');
  await done();
  s = await state();
  expect('眠ると集計表が増え、短期記憶が空になる', s.rows > 0 && s.mem.length === 0 && s.sleeps === 1, `行 ${s.rows}`);
  await shot('5-woke.png');

  // 会話（学習後）
  await tab('会話');
  await evaluate(`(() => { const i = document.querySelector('.talk-form input'); i.value = 'こんにちは'; document.querySelector('.talk-form').requestSubmit(); })()`);
  await sleep(SLOW ? 6000 : 3000);
  await shot('6-infer.png');
  await done();
  const reply = await evaluate(`document.querySelector('.log-line:last-child').textContent`);
  expect('学習後は言葉を返す', !reply.includes('……'), reply);
  await shot('7-replied.png');

  // 頭の中を見る
  await evaluate(`[...document.querySelectorAll('.settings-button')].find((b) => b.textContent.includes('頭の中を見る')).click()`);
  await sleep(2000);
  await shot('8-explore.png');
  await evaluate(`[...document.querySelectorAll('.settings-button')].find((b) => b.textContent.includes('家にもどる')).click()`);
  await sleep(1200);
  expect('頭の中から戻ると操作できる', (await busy()) === false);

  // 本物のマウス操作: 一時停止、コマ送り、なでる
  const click = async (x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
  };
  const center = (selector) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const clickOn = async (selector) => { const p = await center(selector); await click(p.x, p.y); };
  await clickOn('.talk-form input');
  await send('Input.insertText', { text: 'おはよう' });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(300);
  expect('キーボードで入力して Enter で話しかけられる', (await busy()) === true);
  await clickOn('.pause-button');
  expect('一時停止ボタンが押された状態になる', (await evaluate(`document.querySelector('.pause-button').getAttribute('aria-pressed')`)) === 'true');
  await sleep(6000);
  expect('一時停止中は演出が終わらない', (await busy()) === true);
  await shot('9-paused.png');
  expect('一時停止中はコマ送りを押せる', (await evaluate(`document.querySelector('.step-button').disabled`)) === false);
  await clickOn('.step-button');
  await sleep(1500);
  expect('コマ送りのあとも一時停止のまま', (await busy()) === true);
  await clickOn('.pause-button');
  await done();
  expect('再開すると最後まで進む', (await evaluate(`document.querySelector('.log-line:last-child').classList.contains('kara')`)) === true);
  // なでる: 画面上のキャラクターの位置を探してクリックする（3D なので、白い体の色の点を探す）
  await shot('10-before-pet.png');
  const stage = await evaluate(`(() => { const r = document.querySelector('.stage3d').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  await click(stage.x + stage.w * 0.57, stage.y + stage.h * 0.6);
  await sleep(350);
  await shot('11-pet.png');
  await sleep(1200);

  // セーブ
  await load();
  s = await state();
  expect('読み込み直しても育てた状態が残る', s.rows > 0 && s.sleeps === 1);

  expect('画面のエラーがない', logs.length === 0, logs.join(' | '));
  ws.close();
} catch (e) {
  problems.push(String(e));
  console.log(`NG  ${e}`);
  if (logs.length) console.log(logs.join('\n'));
} finally {
  chrome.kill();
  server.close();
  await sleep(500);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
console.log(problems.length ? `\n問題 ${problems.length} 件` : `\nすべて OK。画面写真: tools/out/`);
process.exit(problems.length ? 1 : 0);
