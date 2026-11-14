// 動作確認。ヘッドレス Chrome でゲームを通しで動かし、画面写真を tools/out/ に保存する。
// 使い方: node tools/check.mjs            （PC の画面 1600x900）
//         node tools/check.mjs --slow     （ふつうの速度で動かす。演出を画面写真で見たいとき）
//         node tools/check.mjs --mobile   （スマホの縦長画面 390x844）
//         node tools/check.mjs --published （GitHub Pages の公開サイトを確認）
//         node tools/check.mjs --appearance （タイトルと部屋の外観を短時間で確認）
// 依存なし（Node 22 以上と Chrome が要る）。Chrome の場所は環境変数 CHROME で変えられる。
// 終了コード: 画面のエラーや期待外れがあれば 1。

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLISHED = process.argv.includes('--published');
const OUT = path.join(ROOT, 'tools', 'out', ...(PUBLISHED ? ['published'] : []));
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
});
if (!PUBLISHED) server.listen(PORT, '127.0.0.1');

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
  const release = (await readFile(path.join(ROOT, 'index.html'), 'utf8')).match(/name="app-version" content="([^"]+)"/)[1];
  const url = PUBLISHED ? `https://sikimu.github.io/kara-model/?v=${release}` : `http://127.0.0.1:${PORT}/index.html`;
  console.log(`確認先: ${url} (${MOBILE ? '390x844 / touch' : '1600x900 / mouse'})`);
  const load = async () => {
    await send('Page.navigate', { url });
    await sleep(3500);
    const started = Date.now();
    while (!await evaluate(`!!window.kara && !!window.karaPoint`)) {
      if (Date.now() - started > 30000) throw new Error('起動が完了しない');
      await sleep(250);
    }
  };

  // まっさらな状態から始める。速度は --slow でなければ一番はやく
  await load();
  await evaluate(`localStorage.clear(); localStorage.setItem('kara-model-ui', JSON.stringify({ speedIndex: ${SLOW ? 5 : 9}, skip: false }))`);
  await load();

  const busy = () => evaluate(`document.querySelector('#app').dataset.busy === 'true'`);
  let capturedReturn = false;
  const done = async (limit = 240000) => {
    const t0 = Date.now();
    await sleep(200);
    while (await busy()) {
      if (!capturedReturn && await evaluate(`!!document.querySelector('.journey-cut.is-visible[data-destination="home"]')`)) {
        await sleep(550);
        await shot('3-return-cutin.png');
        capturedReturn = true;
      }
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
    if (id !== 'explore') expect(`${id} を部屋から開ける`, await evaluate(`!document.querySelector('.part.${id}').hidden && (${JSON.stringify(id)} === 'chips' || !document.querySelector('.dock').hidden)`));
  };
  const state = () => evaluate(`JSON.stringify({ rows: Object.keys(kara.store).length, updates: kara.network.updates, mem: kara.shortMemory, sleeps: kara.stats.sleeps })`).then(JSON.parse);

  expect('初回はタイトル画面とはじめるを表示する', await evaluate(`!document.querySelector('.title-screen').hidden && document.querySelector('.title-start').textContent === 'はじめる'`));
  expect('検証対象の最新版を読み込んでいる', await evaluate(`document.querySelector('meta[name="app-version"]').content === ${JSON.stringify(release)}`));
  expect('コード・スタイル・3D素材のURLに版番号が付いている', await evaluate(`performance.getEntriesByType('resource').filter(e => { const u = new URL(e.name); return u.origin === location.origin && /\\.(js|css|glb)$/.test(u.pathname); }).every(e => new URL(e.name).searchParams.get('v') === ${JSON.stringify(release)})`));
  expect('タイトルの描き下ろし画像を読み込める', await evaluate(`document.querySelector('.title-art').complete && document.querySelector('.title-art').naturalWidth > 0`));
  expect('絵のタイトルと庭が動く', await evaluate("document.querySelector('.title-logo').naturalWidth > 0 && document.querySelector('.title-art').getAnimations().length > 0"));
  await shot('0-title.png');
  await clickOn('.title-start');
  expect('開始ボタンで部屋に入れる', await evaluate(`document.querySelector('.title-screen').hidden`));
  expect('起動して操作できる', (await busy()) === false);
  expect('ゲームタイトルを表示する', await evaluate(`document.title.startsWith('からっぽのコト') && document.querySelector('.logo').textContent.includes('からっぽのコト')`));
  expect('初日は会話から案内する', await evaluate(`kara.tutorial.step === 0 && !document.querySelector('.tutorial-target').hidden`));
  expect('操作の目的で案内する', await evaluate(`document.querySelector('.tutorial-target').getAttribute('aria-label') === 'コトと話す' && !document.querySelector('.tutorial-target').hidden`));
  expect('常設の文章パネルを置かない', await evaluate(`!document.querySelector('.tutorial')`));
  await shot('1-home.png');
  await clickOn('.settings-button');
  expect('設定を開ける', await evaluate(`document.querySelector('.settings').open`));
  await shot('0-settings.png');
  await clickOn('.settings-close');

  if (process.argv.includes('--mind-preview')) {
    await evaluate(`(() => { kara.hear('やあ'); kara.sleep(); const slider = document.querySelector('.speed-slider'); slider.value = '5'; slider.dispatchEvent(new Event('input')); })()`);
    await action('talk');
    await evaluate(`(() => { document.querySelector('.talk-form input').value = 'やあ'; document.querySelector('.talk-form').requestSubmit(); })()`);
    for (const phase of ['packing', 'walking', 'unpacking']) {
      let found = false;
      for (let i = 0; i < 150; i++) {
        if (await evaluate(`document.querySelector('.mind-view').dataset.carry === '${phase}'`)) { found = true; break; }
        await sleep(100);
      }
      expect(`ことばを ${phase} する`, found);
      if (found) await shot(`16-mind-${phase}.png`);
    }
    expect('考えごとの間は部屋の字幕を前面に出さない', await evaluate(`getComputedStyle(document.querySelector('.caption')).visibility === 'hidden'`));
    for (let i = 0; i < 150; i++) {
      if (await evaluate(`document.querySelector('.mind-view').dataset.phase === 'attention'`)) break;
      await sleep(100);
    }
    await shot('17-mind-attention.png');
    await clickOn('.skip-button'); await done();
  } else if (process.argv.includes('--sleep-preview')) {
    await evaluate(`(() => { kara.hear('おやすみ'); const slider = document.querySelector('.speed-slider'); slider.value = '0'; slider.dispatchEvent(new Event('input')); })()`);
    await action('sleep');
    await clickOn('.sleep-button');
    await sleep(6000);
    await shot('15-sleep-mobile.png');
    await clickOn('.skip-button');
    await done();
    expect('ゆっくりの入眠から飛ばして起床できる', await evaluate(`kara.stats.sleeps === 1 && !document.querySelector('.skip-box').checked && JSON.parse(localStorage.getItem('kara-model-ui')).speedIndex === 0`));
  } else if (process.argv.includes('--appearance')) {
    await action('talk');
    await sleep(400);
    await shot('1-character.png');
  } else {
  // 会話（空の状態）
  await action('talk');
  await shot('1-talk.png');
  await evaluate(`(() => { const i = document.querySelector('.talk-form input'); i.value = 'やあ'; document.querySelector('.talk-form').requestSubmit(); })()`);
  await sleep(SLOW ? 2600 : 1500);
  await shot('2-thinking.png');
  await done();
  expect('空の状態では「……」を返す', (await evaluate(`document.querySelector('.log-line:last-child').textContent`)).includes('……'));
  expect('会話後はお出掛けを案内する', await evaluate(`kara.tutorial.step === 1`));
  expect('無言を体験したあとで理由を説明する', await evaluate(`kara.tutorial.reflection === 'first-talk' && document.querySelector('.tutorial-target').getAttribute('aria-label').includes('観察ノート')`));
  await action('journal');
  expect('体験したページだけを開く', await evaluate(`document.querySelectorAll('.journal-tabs button:disabled').length === 3 && document.querySelector('.journal-note').textContent.includes('まだ、ことばを知らない')`));
  await shot('2-first-reflection.png');
  await clickOn('.journal .item-close');
  expect('閉じるだけでは未読を残す', await evaluate(`kara.tutorial.reflection === 'first-talk'`));
  await load();
  await clickOn('.title-start');
  expect('体験後の説明も再読み込みで失われない', await evaluate(`kara.tutorial.reflection === 'first-talk'`));
  await action('journal');
  await clickOn('.journal-finish');
  expect('説明を読んだあと出掛ける案内が出る', await evaluate(`!kara.tutorial.reflection && document.querySelector('.tutorial-target').getAttribute('aria-label').includes('まちへ出かける') && !document.querySelector('.tutorial-target').hidden`));

  // お出掛け（お手本を入れて、まちの ひろば へ）
  await action('listen');
  expect('お出掛けという名前で案内する', await evaluate(`document.querySelector('.listen-sign').textContent === 'お出掛けのしおり' && document.querySelector('.listen-go').textContent.includes('お出掛けする')`));
  await clickOn('.listen-sample');
  await shot('2-listen-input.png');
  await clickOn('.listen-go');
  const cutStart = Date.now();
  while (!await evaluate(`!!document.querySelector('.journey-cut.is-visible[data-destination="plaza"]')`)) {
    if (Date.now() - cutStart > 20000) throw new Error('お出掛けのカットインが出ない');
    await sleep(80);
  }
  await sleep(550);
  await shot('3-departure-cutin.png');
  expect('外への移動に行き先のカットインが出る', await evaluate(`document.querySelector('.journey-to').textContent === 'まちの ひろば'`));
  expect('カットインの描き下ろし画像を読み込める', await evaluate(`[...document.querySelectorAll('.journey-art')].every(i => i.complete && i.naturalWidth > 0)`));
  await sleep(SLOW ? 3000 : 600);
  await shot('3-plaza.png');
  await done();
  let s = await state();
  expect('帰宅のカットインも出る', capturedReturn);
  expect('聞いた文が短期記憶にたまる', s.mem.length > 0, JSON.stringify(s.mem));
  expect('眠る前は集計表が変わらない', s.rows === 0);
  expect('お出掛け後は睡眠を案内する', await evaluate(`kara.tutorial.step === 2`));
  expect('お出掛け後にかごの意味を説明する', await evaluate(`kara.tutorial.reflection === 'heard'`));
  await action('journal');
  await clickOn('.journal-finish');

  await action('memory');
  expect('かごの紙に保存したことばを表示する', await evaluate(`[...document.querySelectorAll('.word-slip')].every((e, i) => kara.shortMemory[i].turns.every(t => e.textContent.includes(t.text))) && document.querySelectorAll('.word-slip').length === kara.shortMemory.length`));
  await shot('3-memory.png');
  await clickOn('.memory .item-close');

  // 睡眠（夢の中で学習）
  await action('sleep');
  await shot('3-sleep-input.png');
  await evaluate(`document.querySelector('.sleep-button').click()`);
  await sleep(SLOW ? 9000 : 4500);
  await shot('4-dream.png');
  await done();
  s = await state();
  expect('眠るとニューラルネットが学習し、短期記憶が空になる', s.updates > 0 && s.mem.length === 0 && s.sleeps === 1, `更新 ${s.updates}`);
  await shot('5-woke.png');
  expect('起床後は再度会話を案内する', await evaluate(`kara.tutorial.step === 3`));
  expect('睡眠後に学習を説明する', await evaluate(`kara.tutorial.reflection === 'slept'`));
  await action('journal');
  await clickOn('.journal-finish');

  // 会話（学習後）
  await action('talk');
  await evaluate(`(() => { const i = document.querySelector('.talk-form input'); i.value = 'こんにちは'; document.querySelector('.talk-form').requestSubmit(); })()`);
  await sleep(SLOW ? 6000 : 3000);
  await shot('6-infer.png');
  await done();
  const reply = await evaluate(`document.querySelector('.log-line:last-child').textContent`);
  expect('学習後の返事を表示する', reply.length > 0, reply);
  expect('最後の会話後に振り返りを表示する', await evaluate(`kara.tutorial.step === 4 && ['replied', 'quiet'].includes(kara.tutorial.reflection)`));
  await action('journal');
  await clickOn('.journal-finish');
  expect('振り返りを閉じると初日の案内が完了する', await evaluate(`document.querySelector('.tutorial-target').hidden && document.querySelector('.tutorial-target').hidden`));
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
  await clickOn('.skip-button');
  await done();
  expect('一時停止中から今回だけ飛ばせる', await evaluate(`!document.querySelector('.skip-box').checked && JSON.parse(localStorage.getItem('kara-model-ui')).speedIndex === ${SLOW ? 5 : 9}`));
  expect('再開すると最後まで進む', (await evaluate(`document.querySelector('.log-line:last-child').classList.contains('kara')`)) === true);
  // なでる操作は、実際のキャラクターを押して会話の入力が開閉することでも確認する
  await shot('10-before-pet.png');
  const petPoint = await evaluate(`karaPoint('talk')`);
  await click(petPoint.x, petPoint.y);
  expect('キャラクターをもう一度押すと入力が閉じる', await evaluate(`document.querySelector('.dock').hidden`));
  await sleep(350);
  await shot('11-pet.png');
  await sleep(1200);

  // 小物のチップ箱から交換して保存
  await action('chips');
  await sleep(1200);
  expect('チップは専用画面の立体作業台で開く', await evaluate(`!!document.querySelector('.workshop-view canvas') && document.querySelector('.dock').hidden`));
  await clickOn('[data-chip="sampler-temperature"]');
  await evaluate(`(() => { const t = document.querySelector('[aria-label="温度"]'); t.value = '0.5'; t.dispatchEvent(new Event('input')); })()`);
  expect('木箱で温度チップを付け替えられる', await evaluate(`kara.chips.sampler.id === 'sampler-temperature' && kara.options.temperature === 0.5`));
  await shot('12-chips.png');
  await clickOn('[data-slot="predictor"]');
  await clickOn('[data-architecture="count"]');
  expect('実験用モデルを明示して切り替える', await evaluate(`kara.chips.predictor.id === 'predictor-table' && document.querySelector('.chip-method').textContent.includes('実験用')`));
  await clickOn('[data-architecture="transformer"]');
  expect('ニューラルモデルの重みは残る', await evaluate(`kara.network.updates > 0 && kara.chips.predictor.id === 'predictor-transformer'`));
  await shot('12-transformer.png');
  await clickOn('.chips .item-close');
  await load();
  expect('保存後はタイトル画面につづきからを表示する', await evaluate(`!document.querySelector('.title-screen').hidden && document.querySelector('.title-start').textContent === 'つづきから'`));
  await shot('13-continue.png');
  await clickOn('.title-start');
  s = await state();
  expect('読み込み直しても育てた状態が残る', s.updates > 0 && s.sleeps === 1);
  expect('チップと温度、初日の完了が保存される', await evaluate(`kara.chips.sampler.id === 'sampler-temperature' && kara.options.temperature === 0.5 && kara.tutorial.step === 4`));
  }

  if (!process.argv.includes('--appearance') && !process.argv.includes('--sleep-preview') && !process.argv.includes('--mind-preview')) {
    await action('sleep');
    await clickOn('.sleep-button');
    await sleep(350);
    await clickOn('.skip-button');
    await done();
    expect('学習中も飛ばして保存される', await evaluate(`kara.stats.sleeps === 2 && kara.shortMemory.length === 0 && document.querySelector('.skip-button').hidden`));
    await shot('14-skipped-sleep.png');
  }
  expect('画面のエラーがない', logs.length === 0, logs.join(' | '));
  ws.close();
} catch (e) {
  problems.push(String(e));
  console.log(`NG  ${e}`);
  if (logs.length) console.log(logs.join('\n'));
} finally {
  chrome.kill();
  if (server.listening) server.close();
  await sleep(500);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
console.log(problems.length ? `\n問題 ${problems.length} 件` : `\nすべて OK。画面写真: ${OUT}`);
process.exit(problems.length ? 1 : 0);
