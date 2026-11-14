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
// --guide-preview は入室ごとの説明だけを確認して飛ばす（続きの部屋めぐりは --mind-preview で確認する）
const GUIDE_ONLY = process.argv.includes('--guide-only') || process.argv.includes('--guide-preview');
const GUIDE = GUIDE_ONLY;
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
  '--no-first-run', ...(process.argv.includes('--software') ? ['--disable-gpu'] : ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu']), '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });

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
  await evaluate(`localStorage.clear(); ${GUIDE ? '' : "localStorage.setItem('kara-mind-guide', 'false');"} localStorage.setItem('kara-model-ui', JSON.stringify({ speedIndex: ${SLOW ? 5 : 9}, skip: false }))`);
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
  let checkedDice = false;
  const action = async (id) => {
    const p = await evaluate(`karaPoint(${JSON.stringify(id)})`);
    await click(p.x, p.y);
    await sleep(250);
    if (id !== 'explore') expect(`${id} を部屋から開ける`, await evaluate(`!document.querySelector('.part.${id}').hidden && (${JSON.stringify(id)} === 'chips' || !document.querySelector('.dock').hidden)`));
    if (id === 'talk' && !checkedDice) {
      checkedDice = true;
      expect('話す欄は例文も入力値もない空欄で開く', await evaluate(`!document.querySelector('.talk-form input').value && !document.querySelector('.talk-form input').placeholder`));
      await clickOn('.talk-sample');
      const first = await evaluate(`document.querySelector('.talk-form input').value`);
      await clickOn('.talk-sample');
      expect('さいころで別の文章を入れ、送信はしない', !!first && first !== await evaluate(`document.querySelector('.talk-form input').value`) && !await busy());
      await shot('29-random-text.png');
      await evaluate(`document.querySelector('.talk-form input').value = ''`);
    }
    if (id === 'listen') expect('お出掛けの入力欄にも例文を薄く表示しない', await evaluate(`[...document.querySelectorAll('.listen textarea')].every(area => !area.placeholder)`));
  };
  const state = () => evaluate(`JSON.stringify({ updates: kara.stats().updates, mem: kara.pending, sleeps: kara.stats().sleeps, merges: kara.stats().merges, chars: kara.stats().chars })`).then(JSON.parse);
  // タイトルから部屋へ。保存がなければ「コトを つくる」で初期値のまま始める
  const startGame = async () => {
    await clickOn('.title-start');
    await sleep(200);
    if (await evaluate(`!!document.querySelector('.birth[open]')`)) {
      expect('新規作成は初期値（文脈128・48次元・3層3ヘッド）を表示し、詳しい設定は閉じている', await evaluate(`document.querySelector('.birth-summary').textContent.includes('128') && document.querySelector('.birth-summary').textContent.includes('48') && !document.querySelector('.birth details').open`));
      await shot('0-birth.png');
      await clickOn('.birth-go');
      await sleep(300);
    }
  };

  expect('初回はタイトル画面とはじめるを表示する', await evaluate(`!document.querySelector('.title-screen').hidden && document.querySelector('.title-start').textContent === 'はじめる'`));
  expect('検証対象の最新版を読み込んでいる', await evaluate(`document.querySelector('meta[name="app-version"]').content === ${JSON.stringify(release)}`));
  expect('コード・スタイル・3D素材のURLに版番号が付いている', await evaluate(`performance.getEntriesByType('resource').filter(e => { const u = new URL(e.name); return u.origin === location.origin && /\\.(js|css|glb)$/.test(u.pathname); }).every(e => new URL(e.name).searchParams.get('v') === ${JSON.stringify(release)})`));
  expect('タイトルの描き下ろし画像を読み込める', await evaluate(`document.querySelector('.title-art').complete && document.querySelector('.title-art').naturalWidth > 0`));
  expect('絵のタイトルと庭が動く', await evaluate("document.querySelector('.title-logo').naturalWidth > 0 && document.querySelector('.title-art').getAnimations().length > 0"));
  await shot('0-title.png');
  await startGame();
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

  if (process.argv.includes('--mind-preview') || GUIDE) {
    await evaluate(`(async () => { kara.hear('やあ'); await kara.sleepAsync(); const slider = document.querySelector('.speed-slider'); slider.value = '5'; slider.dispatchEvent(new Event('input')); })()`);
    await action('talk');
    await evaluate(`(() => { document.querySelector('.talk-form input').value = 'やあ'; document.querySelector('.talk-form').requestSubmit(); })()`);
    if (GUIDE) {
      const waitGuide = async () => {
        for (let i = 0; i < 1200; i++) {
          if (await evaluate(`document.querySelector('.mind-view').dataset.hold === 'waiting'`)) { await evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`); return; }
          await sleep(50);
        }
        throw new Error('説明待ちにならない');
      };
      await waitGuide();
      expect('初期設定は中央で止めて説明する', await evaluate(`document.querySelector('.mind-explain-toggle').textContent === '止めて説明' && document.querySelector('.mind-explanation h2').textContent.includes('玄関')`));
      expect('説明カードは画面中央に収まる', await evaluate(`(() => { const r = document.querySelector('.mind-explanation').getBoundingClientRect(); return Math.abs((r.left + r.right)/2 - innerWidth/2) < 3 && r.top > 110 && r.bottom < innerHeight; })()`));
      await shot('20-entrance-guide.png');
      expect('図と短い説明があり、詳しい仕組みは閉じている', await evaluate(`!!document.querySelector('.mind-guide-picture svg[role="img"]') && !document.querySelector('.mind-explanation details').open && document.querySelector('.mind-explanation p').textContent.length < 160`));
      await clickOn('.mind-word');
      expect('重要なことばから追加説明を開いても停止したまま', await evaluate(`!document.querySelector('.mind-word-note').hidden && document.querySelector('.mind-word-note').textContent.includes('トークン') && document.querySelector('.mind-view').dataset.hold === 'waiting'`));
      await shot('26-word-help.png');
      await clickOn('.mind-word-note button');
      await clickOn('.mind-next'); await sleep(100);
      expect('再生中に説明を残さない', await evaluate(`document.querySelector('.mind-explanation').hidden`));
      let cargoVisible = false;
      for (let i = 0; i < 500; i++) {
        if (await evaluate(`!!document.querySelector('.mind-view').dataset.cargo && document.querySelector('.mind-view').dataset.carry === 'walking'`)) { cargoVisible = true; break; }
        await sleep(50);
      }
      expect('歩いている間も持っていることばが見える', cargoVisible && await evaluate(`!document.querySelector('.mind-cargo').hidden && document.querySelector('.mind-cargo').textContent.includes('や ・ あ')`));
      await shot('20-carry-visible.png');
      await waitGuide();
      expect('運んだ後に並べる目的を説明する', await evaluate(`document.querySelector('.mind-explanation h2').textContent.includes('ならべる')`));
      await shot('21-arrange-intro.png');
      await evaluate(`(() => { const slider = document.querySelector('.speed-slider'); slider.value = '9'; slider.dispatchEvent(new Event('input')); })()`);
      await clickOn('.mind-next'); await sleep(100); await waitGuide();
      expect('札ごとに止まらず①の部屋まで進む', await evaluate(`document.querySelector('.mind-view').dataset.operation === '0'`));
      expect('写しを並べても元のことばが残る', await evaluate(`Number(document.querySelector('.mind-view').dataset.sourceCount) === 6 && Number(document.querySelector('.mind-view').dataset.contextCount) === 6`));
      expect('①の説明は文字の本と次元数で始まる', await evaluate(`document.querySelector('.mind-explanation h2').textContent.includes('文字の本') && document.querySelector('.mind-explanation p').textContent.includes('48個')`));
      await shot('22-room-entry-guide.png');
      await clickOn('.mind-next'); await sleep(150);
      expect('作業中は説明を隠し、黒い札を置かない', await evaluate(`document.querySelector('.mind-explanation').hidden && document.querySelector('.mind-view').dataset.boardCount === '0'`));
      await shot('28-work-without-labels.png');
      await waitGuide();
      expect('同じ部屋では説明を繰り返さず②の入室で説明する', await evaluate(`document.querySelector('.mind-view').dataset.operation === '1'`));
      const text = await evaluate(`document.querySelector('.mind-explanation h2').textContent`);
      await sleep(800);
      expect('説明を読んでいる間は進まない', text === await evaluate(`document.querySelector('.mind-explanation h2').textContent`));
      await clickOn('.mind-explain-toggle');
    }
    if (GUIDE_ONLY) {
      await clickOn('.skip-button'); await done();
    } else {
    for (const phase of ['packing', 'walking', 'unpacking']) {
      let found = false;
      for (let i = 0; i < 300; i++) {
        if (await evaluate(`(document.querySelector('.mind-view').dataset.carrySeen ?? '').includes('${phase}')`)) { found = true; break; }
        await sleep(50);
      }
      expect(`ことばを ${phase} する`, found);
      if (found) await shot(`16-mind-${phase}.png`);
    }
    expect('考えごとの間は部屋の字幕を前面に出さない', await evaluate(`getComputedStyle(document.querySelector('.caption')).visibility === 'hidden'`));
    await shot('17-mind-attention.png');
    expect('初期状態は説明なし', await evaluate(`document.querySelector('.mind-explain-toggle').getAttribute('aria-pressed') === 'false' && document.querySelector('.mind-explanation').hidden`));
    for (let i = 0; i < 900; i++) {
      if (await evaluate(`document.querySelector('.mind-view').dataset.operation === '0'`)) break;
      await sleep(100);
    }
    await sleep(550);
    expect('作業中は手元へ寄り、説明が作業に対応する', await evaluate(`document.querySelector('.mind-view').dataset.view === 'work-closeup'`));
    await clickOn('.pause-button');
    await sleep(900);
    const pausedValue = await evaluate(`document.querySelector('.mind-view').dataset.manipulating`);
    await sleep(700);
    expect('机上の作業も一時停止する', pausedValue !== undefined && pausedValue === await evaluate(`document.querySelector('.mind-view').dataset.manipulating`));
    await clickOn('.step-button');
    await sleep(900);
    expect('コマ送りで次の手順まで進む', await evaluate(`document.querySelector('.mind-view').dataset.manipulating`) !== pausedValue);
    await clickOn('.mind-camera button:nth-child(2)');
    await sleep(300);
    expect('作業中も自由視点を維持できる', await evaluate(`document.querySelector('.mind-view').dataset.view === 'free'`));
    await clickOn('.mind-camera button');
    await shot('18-work-explained.png');
    // 説明は入室時だけ止まり、「つぎへ」で次の部屋まで進む
    await clickOn('.mind-explain-toggle');
    await clickOn('.pause-button');
    const waitHold = async () => { for (let i = 0; i < 200; i++) { if (await evaluate(`document.querySelector('.mind-view').dataset.hold === 'waiting'`)) { await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`); return true; } await sleep(50); } return false; };
    expect('次の入室で説明して止まる', await waitHold() && await evaluate(`document.querySelector('.mind-explain-toggle').textContent === '止めて説明' && !document.querySelector('.mind-next').hidden`));
    const heldValue = Number(await evaluate(`document.querySelector('.mind-view').dataset.manipulating`));
    const heldRoom = Number(await evaluate(`document.querySelector('.mind-view').dataset.operation`));
    await sleep(900);
    expect('読んでいる間は先へ進まない', heldValue === Number(await evaluate(`document.querySelector('.mind-view').dataset.manipulating`)));
    await shot('18-work-detail.png');
    await clickOn('.mind-next');
    await sleep(150);
    const again = await waitHold(), nextValue = await evaluate(`document.querySelector('.mind-view').dataset.manipulating + ' op=' + document.querySelector('.mind-view').dataset.operation`);
    expect('つぎへで次の部屋まで進む', again && Number(await evaluate(`document.querySelector('.mind-view').dataset.operation`)) === heldRoom + 1, `${heldValue} → ${nextValue} hold=${again}`);
    await clickOn('.mind-explain-toggle');
    expect('説明を隠しても手元の作業が続く', await evaluate(`document.querySelector('.mind-explanation').hidden && document.querySelector('.mind-view').dataset.manipulating !== undefined`));
    await shot('18-work-quiet.png');
    let holding = false;
    for (let i = 0; i < 600; i++) {
      if (await evaluate(`document.querySelector('.mind-view').dataset.hand === 'holding'`)) { holding = true; break; }
      await sleep(50);
    }
    console.log(`    描画の質: ${await evaluate(`document.querySelector('.mind-view').dataset.quality ?? 'full'`)}`);
    expect('コトがデータを持ち上げて扱う時間が見える', holding);
    expect('棚と机で原本が重複せず、閉じた本が残らない', await evaluate(`document.querySelector('.mind-view').dataset.bookDuplicate === 'false' && document.querySelector('.mind-view').dataset.deskBooks === '0'`));
    await shot('18-work-hand.png');
    // ②〜⑤は層の数だけ巡回し、最後に⑥へ着く
    let toured = false, shotRooms = new Set();
    for (let i = 0; i < 1800; i++) {
      const room = await evaluate(`document.querySelector('.mind-view').dataset.operation ?? ''`);
      if (room && !shotRooms.has(room)) { shotRooms.add(room); await sleep(600); await shot(`18-room-${Number(room) + 1}.png`); }
      if (await evaluate(`(document.querySelector('.mind-view').dataset.roomsSeen ?? '').includes('5')`)) { toured = true; break; }
      await sleep(100);
    }
    await sleep(800);
    expect('推論の実ベクトルを6つの部屋で再生する（②〜⑤は層ごとに巡回）', toured && await evaluate(`document.querySelector('.mind-view').dataset.roomsSeen === '012345'`));
    expect('部屋を出入りするときにドアが開く', await evaluate(`Number(document.querySelector('.mind-view').dataset.doors) >= 9`));
    await shot('18-mind-operation.png');
    let spinning = false;
    for (let i = 0; i < 600; i++) {
      if (await evaluate(`document.querySelector('.mind-view').dataset.roulette === 'spinning'`)) { spinning = true; break; }
      await sleep(100);
    }
    expect('抽選の部屋でルーレットが回る', spinning);
    await shot('19-roulette-spinning.png');
    let landed = false;
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`document.querySelector('.mind-view').dataset.roulette === 'landed'`)) { landed = true; break; }
      await sleep(100);
    }
    expect('確率区間・乱数・実際の抽選結果が一致する', landed && await evaluate(`document.querySelector('.mind-view').dataset.rouletteMatch === 'true'`));
    await shot('19-roulette-landed.png');
    // 移動中に詳細モードを選んで直ちに飛ばしても、次の説明待ちで止まらない。
    await evaluate(`document.querySelector('.mind-explain-toggle').click(); document.querySelector('.skip-button').click()`);
    await done();
    expect('説明待ちになる前でも演出を最後まで飛ばせる', await evaluate(`!document.querySelector('.mind-view').dataset.hold && document.querySelector('.skip-button').hidden`));
    await action('explore'); await sleep(1200);
    expect('開き直しても元のことばと並べた札が残る', await evaluate(`Number(document.querySelector('.mind-view').dataset.sourceCount) > 0 && Number(document.querySelector('.mind-view').dataset.contextCount) > 0`));
    await clickOn('.mind-camera button:nth-child(2)'); await sleep(300);
    await shot('25-revisit-cards.png');
    await clickOn('.home-button'); await sleep(1000);
    }
  } else if (process.argv.includes('--stack-preview')) {
    await evaluate(`kara.hear('あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ')`);
    await action('sleep'); await clickOn('.sleep-button');
    let previous = 0, stacked = false, preserved = true;
    for (let i = 0; i < 1200; i++) {
      const count = Number(await evaluate(`document.querySelector('.mind-view').dataset.contextCount ?? 0`));
      if (count < previous) preserved = false;
      previous = count;
      if (count >= 25) { stacked = true; break; }
      await sleep(50);
    }
    await clickOn('.pause-button'); await sleep(300);
    expect('25枚目を置いても先の24枚を消さずに保持する', stacked && preserved);
    await shot('27-stack-closeup.png');
    await clickOn('.skip-button'); await done();
  } else if (process.argv.includes('--sleep-preview')) {
    await evaluate(`(() => { kara.hear('おやすみ'); const slider = document.querySelector('.speed-slider'); slider.value = '0'; slider.dispatchEvent(new Event('input')); })()`);
    await action('sleep');
    await clickOn('.sleep-button');
    await sleep(6000);
    await shot('15-sleep-mobile.png');
    await clickOn('.skip-button');
    await done();
    expect('ゆっくりの入眠から飛ばして起床できる', await evaluate(`kara.stats().sleeps === 1 && !document.querySelector('.skip-box').checked && JSON.parse(localStorage.getItem('kara-model-ui')).speedIndex === 0`));
  } else if (process.argv.includes('--appearance')) {
    const beforeStroll = await evaluate(`karaPoint('talk')`);
    await sleep(10000);
    const afterStroll = await evaluate(`karaPoint('talk')`);
    expect('待機中にコトが家を散歩する', Math.hypot(afterStroll.x - beforeStroll.x, afterStroll.y - beforeStroll.y) > 5);
    await shot('1-strolling.png');
    await action('talk');
    await sleep(1400);
    const stopped = await evaluate(`karaPoint('talk')`);
    await sleep(2500);
    const stillStopped = await evaluate(`karaPoint('talk')`);
    expect('入力を開くと散歩が止まる', Math.hypot(stopped.x - stillStopped.x, stopped.y - stillStopped.y) < 2);
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
  await startGame();
  expect('体験後の説明も再読み込みで失われない', await evaluate(`kara.tutorial.reflection === 'first-talk'`));
  await action('journal');
  await clickOn('.journal-finish');
  expect('説明を読んだあと出掛ける案内が出る', await evaluate(`!kara.tutorial.reflection && document.querySelector('.tutorial-target').getAttribute('aria-label').includes('まちへ出かける') && !document.querySelector('.tutorial-target').hidden`));

  // お出掛け（お手本を入れて、まちの ひろば へ）
  await action('listen');
  expect('お出掛けという名前で案内する', await evaluate(`document.querySelector('.listen-sign').textContent === 'お出掛けのしおり' && document.querySelector('.listen-go').textContent.includes('お出掛けする')`));
  await clickOn('.listen-sample');
  await shot('2-listen-input.png');
  await evaluate(`(() => {
    window.karaJourneySeen = [];
    const cut = document.querySelector('.journey-cut');
    const record = () => { if (cut.classList.contains('is-visible')) window.karaJourneySeen.push(cut.dataset.destination); };
    new MutationObserver(record).observe(cut, { attributes: true });
  })()`);
  await clickOn('.listen-go');
  const cutStart = Date.now();
  while (!await evaluate(`!!document.querySelector('.journey-cut.is-visible[data-destination="plaza"]')`)) {
    if (Date.now() - cutStart > 20000) throw new Error('お出掛けのカットインが出ない');
    await sleep(80);
  }
  expect('外への移動に行き先のカットインが出る', await evaluate(`window.karaJourneySeen.includes('plaza')`));
  await sleep(550);
  await shot('3-departure-cutin.png');
  expect('カットインの描き下ろし画像を読み込める', await evaluate(`[...document.querySelectorAll('.journey-art')].every(i => i.complete && i.naturalWidth > 0)`));
  await sleep(SLOW ? 3000 : 600);
  await shot('3-plaza.png');
  await done();
  let s = await state();
  expect('帰宅のカットインも出る', await evaluate(`window.karaJourneySeen.includes('home')`));
  expect('聞いた文が短期記憶にたまる', s.mem.length > 0, JSON.stringify(s.mem));
  expect('眠る前は原本を更新しない', s.updates === 0);
  expect('聞いた文字は登録され、対応表と原本の形が一致する', s.chars > 0 && await evaluate(`kara.vocab.size === kara.net.vocabSize`));
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
  if (!SLOW) {
    let asked = false;
    for (let i = 0; i < 1200; i++) {
      if (await evaluate(`document.querySelector('.mind-view').dataset.quiz === 'asking'`)) { asked = true; break; }
      await sleep(50);
    }
    expect('学習は、次の札の当てっこから始まる', asked);
    // 当てっこの直後に説明を入れると、1 周めの入室ごとに止まる
    await clickOn('.mind-explain-toggle');
    await sleep(300);
    await shot('4-dream-quiz.png');
    const waitLearningNote = async () => {
      const seen = [];
      for (let i = 0; i < 300; i++) {
        if (await evaluate(`document.querySelector('.mind-view').dataset.hold === 'waiting'`)) { await evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`); return; }
        const now = await evaluate(`JSON.stringify({ ...document.querySelector('.mind-view').dataset, explain: document.querySelector('.mind-explain-toggle').textContent, busy: document.querySelector('#app').dataset.busy })`);
        if (seen.at(-1) !== now) seen.push(now);
        await sleep(50);
      }
      throw new Error(`重みの説明待ちにならない: ${seen.slice(-6).join('\n')}`);
    };
    await waitLearningNote();
    expect('当てっこの結果を説明して止まる', await evaluate(`document.querySelector('.mind-explanation h2').textContent.includes('当ててみる')`));
    await clickOn('.mind-next'); await sleep(150);
    await waitLearningNote();
    expect('⑥の部屋で原本を書き直す作業を説明する', await evaluate(`document.querySelector('.mind-view').dataset.operation === '5' && document.querySelector('.mind-explanation p').textContent.includes('原本') && document.querySelector('.mind-explanation h2').textContent.includes('棚へ戻す')`));
    const explainedRoom = Number(await evaluate(`document.querySelector('.mind-view').dataset.operation`));
    await shot('23-weight-entry.png');
    await clickOn('.mind-next'); await sleep(150);
    expect('黒い説明札を常設しない', await evaluate(`document.querySelector('.mind-view').dataset.boardCount === '0'`));
    await sleep(600);
    await shot('4-dream-operation.png');
    await waitLearningNote();
    expect('同じ部屋の原本では止まらず次の部屋（層ごと）で説明する', Number(await evaluate(`document.querySelector('.mind-view').dataset.operation`)) === explainedRoom - 1 && await evaluate(`document.querySelector('.mind-view').dataset.layer === '2'`));
    await shot('24-next-room.png');
    await clickOn('.skip-button');
    // スキップで画面が閉じる速度に左右されず、後続テスト用に説明を無効化。
    await evaluate(`if (document.querySelector('.mind-view').dataset.explain === 'detail') document.querySelector('.mind-explain-toggle').click()`);
  }
  await done();
  s = await state();
  expect('眠ると原本を更新し、学習待ちが空になる。会話の本は残る', s.updates > 0 && s.mem.length === 0 && s.sleeps === 1 && await evaluate(`kara.book.conversations.length > 0`), `更新 ${s.updates}`);
  await action('explore');
  await sleep(1200);
  expect('学習で並べた24枚を超える札を消さずに重ねて残す', await evaluate(`Number(document.querySelector('.mind-view').dataset.contextCount) > 24`));
  await shot('24-stacked-cards.png');
  await clickOn('.home-button');
  await sleep(1200);
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
  if (!SLOW) await clickOn('.skip-button');
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
  expect('頭の中を開き直しても受け取ったことばと並びが残る', await evaluate(`Number(document.querySelector('.mind-view').dataset.sourceCount) > 0 && Number(document.querySelector('.mind-view').dataset.contextCount) > 0`));
  await shot('8-explore.png');
  if (MOBILE) {
    expect('3Dの頭の中が画面の高さに収まる', await evaluate(`document.querySelector('.mind-view').clientHeight === document.querySelector('.stage3d').clientHeight`));
  }
  await clickOn('.mind-camera button:nth-child(2)');
  expect('全景へ切り替えて自由に見渡せる', await evaluate(`document.querySelector('.mind-camera button').getAttribute('aria-pressed') === 'false'`));
  await shot('8-mind-overview.png');
  if (MOBILE) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 400 }] });
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 230, y: 440 }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 600, y: 400, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 800, y: 480, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 800, y: 480, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 800, y: 450, deltaX: 0, deltaY: -300 });
  }
  await shot('8-mind-orbit.png');
  await sleep(700);
  await clickOn('.mind-camera button');
  await sleep(400);
  expect('自由視点からコト追従に戻せる', await evaluate(`document.querySelector('.mind-camera button').getAttribute('aria-pressed') === 'true'`));
  await clickOn('.mind-explain-toggle');
  expect('説明モードを切り替えて保存する', await evaluate(`localStorage.getItem('kara-mind-guide') === 'detail' && document.querySelector('.mind-explanation').hidden`));
  await clickOn('.mind-explain-toggle');
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

  // 机の勉強用の本: ことばのまとまり探し。ノートとは別に開く
  const beforeStudy = await state();
  const sizeBefore = await evaluate(`kara.vocab.size`);
  await action('study');
  expect('勉強用の本は観察ノートと別に開く', await evaluate(`!document.querySelector('.part.study').hidden && document.querySelector('.part.journal').hidden`));
  await shot('12-study-book.png');
  await clickOn('.study-start');
  await sleep(SLOW ? 4000 : 2500);
  await shot('12-study.png');
  await done();
  expect('勉強の結果を本の中身として表示する', await evaluate(`!!document.querySelector('.inspect-view[open]') && document.querySelector('.inspect-view h2').textContent.includes('まとまり探し')`));
  await shot('12-study-result.png');
  s = await state();
  const studyCode = await evaluate(`kara.progress.lastStudy?.code`);
  expect('勉強の結果コードを記録する（追加あり／候補なし／上限）', ['added', 'no-candidate', 'full'].includes(studyCode), String(studyCode));
  expect('まとまりを足しても対応表と原本の形が一致し、旧番号は保たれる', await evaluate(`kara.vocab.size === kara.net.vocabSize && kara.vocab.size >= ${sizeBefore}`) && s.merges >= beforeStudy.merges);
  if (studyCode === 'added') expect('追加したまとまりを文字の本で読める', await evaluate(`document.querySelector('.inspect-view').textContent.includes(kara.progress.lastStudy.added[0].text)`));
  await clickOn('.inspect-view .item-close');
  expect('本を閉じると操作に戻れる', (await busy()) === false && await evaluate(`!document.querySelector('.inspect-view[open]')`));

  // 原本とバインダーの中身
  await action('explore');
  await sleep(1500);
  await clickOn('.mind-item-binder');
  await sleep(300);
  expect('右下のアイテム欄から作業用バインダーを見開きで開く', await evaluate(`!!document.querySelector('.inspect-view[open]') && document.querySelector('.inspect-view h2').textContent.includes('バインダー') && document.querySelectorAll('.binder-spread .inspect-section').length === 2`));
  await shot('12-binder.png');
  await clickOn('.inspect-view .num-cell');
  expect('数値はタップ／マウスオーバーで出す', await evaluate(`!!document.querySelector('.num-cell.show') && /[+−]\\d/.test(document.querySelector('.num-cell.show').dataset.value)`));
  await clickOn('.inspect-view .item-close');
  await clickOn('.mind-camera button:nth-child(2)');
  await sleep(500);
  const bookPoint = await evaluate(`JSON.parse(document.querySelector('.mind-view').dataset.bookPoint)`);
  await click(bookPoint.x, bookPoint.y);
  await sleep(300);
  expect('原本の本を層ごとに開ける', await evaluate(`document.querySelector('.inspect-view h2').textContent.includes('②の本') && document.querySelectorAll('.inspect-tabs button').length === 3 && document.querySelectorAll('.book-row').length > 0`));
  await shot('12-book.png');
  await clickOn('.inspect-view .item-close');
  await clickOn('.home-button');
  await sleep(1200);

  await load();
  expect('保存後はタイトル画面につづきからを表示する', await evaluate(`!document.querySelector('.title-screen').hidden && document.querySelector('.title-start').textContent === 'つづきから'`));
  expect('説明モードも再読み込み後に残る', await evaluate(`document.querySelector('.mind-explain-toggle').getAttribute('aria-pressed') === 'false'`));
  await shot('13-continue.png');
  await startGame();
  const restoredState = await state();
  expect('読み込み直しても育てた状態が残る', restoredState.updates > 0 && restoredState.sleeps === 1);
  expect('構成・まとまり・初日の完了が保存される', restoredState.merges === s.merges && await evaluate(`kara.config.dim === 48 && kara.config.layers === 3 && kara.limits.conversations === 30 && kara.tutorial.step === 4 && kara.book.conversations.length > 0`));
  }

  if (!process.argv.includes('--appearance') && !process.argv.includes('--sleep-preview') && !process.argv.includes('--stack-preview') && !process.argv.includes('--mind-preview') && !GUIDE) {
    await action('sleep');
    await clickOn('.sleep-button');
    await sleep(350);
    await clickOn('.skip-button');
    await done();
    expect('学習中も飛ばして保存される', await evaluate(`kara.stats().sleeps === 2 && kara.pending.length === 0 && document.querySelector('.skip-button').hidden`));
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
