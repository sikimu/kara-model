// 動作確認。ヘッドレス Chrome でゲームを通しで動かし、画面写真を tools/out/ に保存する。
// 使い方: node tools/check.mjs            （PC の画面 1600x900）
//         node tools/check.mjs --slow     （ふつうの速度で動かす。演出を画面写真で見たいとき）
//         node tools/check.mjs --mobile   （スマホの縦長画面 390x844）
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
const PORT = process.argv.includes('--mobile') ? 8767 : 8766;
const DEBUG_PORT = process.argv.includes('--mobile') ? 9335 : 9334;
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SLOW = process.argv.includes('--slow');
const MOBILE = process.argv.includes('--mobile');
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
    await writeFile(path.join(OUT, `${MOBILE ? 'mobile-' : ''}${name}`), Buffer.from(r.result.data, 'base64'));
  };
  const expect = (label, ok, detail = '') => {
    console.log(`${ok ? 'OK ' : 'NG '} ${label}${detail ? `: ${detail}` : ''}`);
    if (!ok) problems.push(label);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: MOBILE ? 390 : 1600, height: MOBILE ? 844 : 900, deviceScaleFactor: 1, mobile: MOBILE });
  if (MOBILE) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const url = `http://127.0.0.1:${PORT}/index.html`;
  const load = async () => { await send('Page.navigate', { url }); await sleep(3500); };

  // まっさらな状態から始める。速度は --slow でなければ一番はやく
  await load();
  await evaluate(`localStorage.clear(); localStorage.setItem('kara-model-ui', JSON.stringify({ speedIndex: ${SLOW ? 5 : 9}, skip: false }))`);
  await load();

  const busy = () => evaluate(`document.querySelector('#app').dataset.busy === 'true'`);
  const done = async (limit = 240000) => {
    const t0 = Date.now();
    await sleep(200);
    while (await busy()) {
      if (Date.now() - t0 > limit) throw new Error('演出が終わらない');
      await sleep(150);
    }
  };
  const click = async (x, y) => {
    if (MOBILE) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      return;
    }
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
  };
  const center = (selector) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const clickOn = async (selector) => { const p = await center(selector); await click(p.x, p.y); };
  const action = async (id) => {
    const p = await evaluate(`karaPoint(${JSON.stringify(id)})`);
    await click(p.x, p.y);
    await sleep(250);
    if (id !== 'explore') expect(`${id} を部屋から開ける`, await evaluate(`!document.querySelector('.part.${id}').hidden && !document.querySelector('.dock').hidden`));
  };
  const state = () => evaluate(`JSON.stringify({ rows: Object.keys(kara.store).length, mem: kara.shortMemory, sleeps: kara.stats.sleeps })`).then(JSON.parse);

  expect('起動して操作できる', (await busy()) === false);
  expect('初日は会話から案内する', await evaluate(`kara.tutorial.step === 0 && !document.querySelector('.tutorial').hidden`));
  await shot('1-home.png');
  await clickOn('.settings-button');
  expect('設定を開ける', await evaluate(`document.querySelector('.settings').open`));
  await shot('0-settings.png');
  await clickOn('.settings-close');

  // 会話（空の状態）
  await action('talk');
  await shot('1-talk.png');
  await evaluate(`(() => { const i = document.querySelector('.talk-form input'); i.value = 'やあ'; document.querySelector('.talk-form').requestSubmit(); })()`);
  await sleep(SLOW ? 2600 : 1500);
  await shot('2-thinking.png');
  await done();
  expect('空の状態では「……」を返す', (await evaluate(`document.querySelector('.log-line:last-child').textContent`)).includes('……'));
  expect('会話後は盗み聞きを案内する', await evaluate(`kara.tutorial.step === 1`));

  // 盗み聞き（お手本を入れて、まちの ひろば へ）
  await action('listen');
  await clickOn('.listen-sample');
  await shot('2-listen-input.png');
  await clickOn('.listen-go');
  await sleep(SLOW ? 9000 : 4000);
  await shot('3-plaza.png');
  await done();
  let s = await state();
  expect('聞いた文が短期記憶にたまる', s.mem.length > 0, s.mem.join(' / '));
  expect('眠る前は集計表が変わらない', s.rows === 0);
  expect('盗み聞き後は睡眠を案内する', await evaluate(`kara.tutorial.step === 2`));

  // 睡眠（夢の中で学習）
  await action('sleep');
  await shot('3-sleep-input.png');
  await evaluate(`document.querySelector('.sleep-button').click()`);
  await sleep(SLOW ? 9000 : 4500);
  await shot('4-dream.png');
  await done();
  s = await state();
  expect('眠ると集計表が増え、短期記憶が空になる', s.rows > 0 && s.mem.length === 0 && s.sleeps === 1, `行 ${s.rows}`);
  await shot('5-woke.png');
  expect('起床後は再度会話を案内する', await evaluate(`kara.tutorial.step === 3`));

  // 会話（学習後）
  await action('talk');
  await evaluate(`(() => { const i = document.querySelector('.talk-form input'); i.value = 'こんにちは'; document.querySelector('.talk-form').requestSubmit(); })()`);
  await sleep(SLOW ? 6000 : 3000);
  await shot('6-infer.png');
  await done();
  const reply = await evaluate(`document.querySelector('.log-line:last-child').textContent`);
  expect('学習後は言葉を返す', !reply.includes('……'), reply);
  expect('初日の案内が完了する', await evaluate(`kara.tutorial.step === 4 && document.querySelector('.tutorial').hidden`));
  await shot('7-replied.png');

  // 頭の中を見る
  await action('explore');
  await sleep(2000);
  await shot('8-explore.png');
  if (MOBILE) {
    await evaluate(`document.querySelector('.stage3d').scrollTop = 1000`);
    await sleep(300);
    await shot('8-explore-bottom.png');
    expect('頭の中を縦にスクロールできる', await evaluate(`document.querySelector('.stage3d').scrollTop > 0`));
  }
  await clickOn('.home-button');
  await sleep(1200);
  expect('頭の中から戻ると操作できる', (await busy()) === false);

  // 本物のマウス操作: 一時停止、コマ送り、なでる
  await action('talk');
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
  // なでる操作は、実際のキャラクターを押して会話の入力が開閉することでも確認する
  await shot('10-before-pet.png');
  const petPoint = await evaluate(`karaPoint('talk')`);
  await click(petPoint.x, petPoint.y);
  expect('キャラクターをもう一度押すと入力が閉じる', await evaluate(`document.querySelector('.dock').hidden`));
  await sleep(350);
  await shot('11-pet.png');
  await sleep(1200);

  // セーブ
  await clickOn('.settings-button');
  await evaluate(`(() => { const s = document.querySelector('.chip-settings select'); s.value = 'sampler-temperature'; s.dispatchEvent(new Event('change')); const t = document.querySelector('[aria-label="温度"]'); t.value = '0.5'; t.dispatchEvent(new Event('input')); })()`);
  expect('設定で温度チップを付け替えられる', await evaluate(`kara.chips.sampler.id === 'sampler-temperature' && kara.options.temperature === 0.5`));
  await shot('12-chips.png');
  await clickOn('.settings-close');
  await load();
  s = await state();
  expect('読み込み直しても育てた状態が残る', s.rows > 0 && s.sleeps === 1);
  expect('チップと温度、初日の完了が保存される', await evaluate(`kara.chips.sampler.id === 'sampler-temperature' && kara.options.temperature === 0.5 && kara.tutorial.step === 4`));

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
