import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { applySurface, boxUV } from './textures.js';
import { explainNeural, workFrame, readout, rouletteTurn, rouletteSector } from './neural-explanation.js';

const labels = { '<bos>': 'はじまり', '<eos>': 'おしまい', '<user>': 'あなた', '<assistant>': 'コト', '<turn>': '交代', '<unk>': '？', '<speaker2>': '話者3', '<speaker3>': '話者4', '■': 'おしまい' };
export const tokenLabel = token => labels[token] ?? token;
const V3 = THREE.Vector3;
const ease = k => k * k * (3 - 2 * k);
const clamp = k => Math.max(0, Math.min(1, k));
const between = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const TOP = .72; // 机の天板の高さ
const GOLD = '#f2c14e', BLUE = '#62aede', GOLD_PALE = '#eadfb4', BLUE_PALE = '#bfd9e6', HOT = '#ff9f55', MARK = '#8d8672';

// 頭の中の部屋。blender/build_assets.py の MIND_ROOMS と同じ並び。
export const ROOMS = {
  heard: { x: -11, z: 9, depth: 1.6, sign: 'とどいた ことば' },
  context: { x: 0, z: 9, depth: 2.0, sign: 'じゅんばんに ならべる' },
  work0: { x: -11, z: 0, depth: 1.8, sign: '① 数に する' },
  work1: { x: 0, z: 0, depth: 1.8, sign: '② 見くらべる' },
  work2: { x: 11, z: 0, depth: 1.8, sign: '③ まぜる' },
  work3: { x: 11, z: -9, depth: 1.8, sign: '④ たしなおす' },
  work4: { x: 0, z: -9, depth: 1.8, sign: '⑤ しぼる' },
  work5: { x: -11, z: -9, depth: 1.8, sign: '⑥ 点を つける' },
  candidates: { x: -22, z: -9, depth: 1.6, sign: 'こうほ' },
  roulette: { x: -22, z: 0, depth: 3.4, sign: 'ルーレット' },
  output: { x: -22, z: 9, depth: 2.6, sign: 'へんじ' },
};
const LANES = [-27.5, -16.5, -5.5, 5.5, 16.5];
const roomOf = a => ROOMS[a.lane === 'work' ? `work${a.index ?? 0}` : a.lane === 'attention' ? 'context' : a.lane] ?? ROOMS.heard;
const tableOf = r => ({ x: r.x + .3, z: r.z + (r.depth >= 3 ? .5 : .7), w: r.depth >= 3 ? 4.4 : 6.4, d: r.depth });
const grid12 = (t, i, dz) => new V3(t.x - 2.75 + (i % 12) * .5, 1.2, t.z - dz + Math.floor(i / 12) * dz * 2);

// 札を置く場所。World coordinates are independent of the viewport.
export function neuralPoint(a) {
  const t = tableOf(roomOf(a)), index = a.index ?? 0;
  if (a.lane === 'roulette') return new V3(t.x, 1.75, t.z);
  if (a.lane === 'work') return a.slot == null ? new V3(t.x - 2.55, 1.25, t.z + .3) : new V3(t.x + .65 + (a.slot - ((a.count ?? 5) - 1) / 2) * .95, 1.6, t.z + .4);
  if (a.lane === 'attention') return grid12(t, index, .45);
  if (a.lane === 'candidates') return new V3(t.x - 2.4 + index * 1.2, 1.25, t.z + .1);
  if (a.lane === 'output') return new V3(t.x - 2.9 + (index % 10) * .64, 1.2, t.z - .8 + Math.min(2, Math.floor(index / 10)) * .8);
  return grid12(t, index % 24, .35);
}
// コトが立つ場所。机の奥に立って、手前（見る人のほう）を向く。
function dock(a) {
  const t = tableOf(roomOf(a)), p = neuralPoint(a);
  return new V3(between(p.x, t.x - t.w / 2 + .5, t.x + t.w / 2 - .5), 0, t.z - t.d / 2 - .62);
}
// 部屋から部屋へは、入口を出て道を通る。
function route(a, b) {
  const ra = roomOf(a), rb = roomOf(b), A = dock(a), B = dock(b);
  if (ra === rb) return [A, B];
  const exit = (r, d) => [new V3(r.x - 3.75, 0, d.z), new V3(r.x - 3.7, 0, r.z + 3.1), new V3(r.x - 3.7, 0, r.z + 4.5)];
  const out = exit(ra, A), into = exit(rb, B).reverse(), mid = [];
  if (ra.z !== rb.z) {
    const lane = LANES.reduce((best, x) => Math.abs(out[2].x - x) + Math.abs(into[0].x - x) < Math.abs(out[2].x - best) + Math.abs(into[0].x - best) ? x : best);
    mid.push(new V3(lane, 0, ra.z + 4.5), new V3(lane, 0, rb.z + 4.5));
  }
  return [A, ...out, ...mid, ...into, B];
}
const lengthOf = points => points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(points[i]), 0);
export const travelLength = (from, to) => lengthOf(route(from, to));
function along(points, k) {
  let rest = lengthOf(points) * clamp(k);
  for (let i = 1; i < points.length; i++) {
    const d = points[i].distanceTo(points[i - 1]);
    if (rest <= d || i === points.length - 1) return { position: points[i - 1].clone().lerp(points[i], d ? Math.min(1, rest / d) : 1), direction: points[i].clone().sub(points[i - 1]) };
    rest -= d;
  }
  return { position: points[0].clone(), direction: new V3(0, 0, 1) };
}

export function createNeuralView(room, canvas) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = .95;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#9fc4d8');
  scene.fog = new THREE.Fog('#9fc4d8', 60, 150);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = .3;
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(42, 1, .1, 220);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false; controls.minDistance = 4; controls.maxDistance = 85;
  controls.maxPolarAngle = Math.PI * .47; controls.minPolarAngle = .12;
  controls.screenSpacePanning = false;
  let following = true, lastW = 0, lastH = 0;
  // 「コトを追う」を押した直後の同じタップで、自由視点に戻ってしまわないようにする
  let followAt = -1e9;
  controls.addEventListener('start', () => { if (performance.now() - followAt < 400) return; following = false; follow.setAttribute('aria-pressed', 'false'); });
  const toolbar = document.createElement('div'); toolbar.className = 'mind-camera'; toolbar.hidden = true;
  const follow = document.createElement('button'); follow.textContent = 'コトを追う'; follow.type = 'button'; follow.setAttribute('aria-pressed', 'true');
  const overview = document.createElement('button'); overview.textContent = '見渡す'; overview.type = 'button';
  let explanations = false;
  try { explanations = localStorage.getItem('kara-mind-explanations') === 'true'; } catch { /* Storage can be unavailable. */ }
  const explain = document.createElement('button'); explain.type = 'button'; explain.className = 'mind-explain-toggle';
  const notes = document.createElement('section'); notes.className = 'mind-explanation'; notes.hidden = true; notes.setAttribute('aria-label', 'いまの作業の説明');
  const heading = document.createElement('h2'), body = document.createElement('p'), detail = document.createElement('p'); detail.className = 'mind-explanation-detail'; notes.append(heading, body, detail);
  canvas.parentElement.append(notes);
  const updateMode = () => { explain.textContent = explanations ? '説明あり' : '説明なし'; explain.setAttribute('aria-pressed', String(explanations)); };
  updateMode();
  explain.onclick = () => { explanations = !explanations; updateMode(); notes.hidden = !explanations; try { localStorage.setItem('kara-mind-explanations', String(explanations)); } catch { /* Keep the current mode in memory. */ } };
  const help = document.createElement('span'); help.textContent = 'ドラッグで回転 · 右ドラッグで移動 · ホイールでズーム';
  toolbar.append(follow, overview, explain, help); canvas.parentElement.append(toolbar);
  const narrow = () => lastW <= 640;
  function home() { controls.target.set(-5.5, 0, 1); camera.position.copy(controls.target).add(narrow() ? new V3(6, 62, 48) : new V3(5, 30, 33)); controls.update(); }
  const followOffset = () => narrow() ? new V3(3, 11, 12) : new V3(4.5, 8, 10.5);
  // 視点を動かした直後のタップでも確実に効くよう、指を離した時点でも受け付ける（何度呼んでも同じ結果）
  follow.onclick = follow.onpointerup = () => { following = true; followAt = performance.now(); lastViewKey = ''; follow.setAttribute('aria-pressed', 'true'); };
  overview.onclick = overview.onpointerup = () => { following = false; follow.setAttribute('aria-pressed', 'false'); home(); };
  scene.add(new THREE.HemisphereLight(0xfff5df, 0x7f9a84, 1.1));
  const sun = new THREE.DirectionalLight(0xffe6bf, 2.6); sun.position.set(-17, 26, 16); sun.target.position.set(-5.5, 0, 0); sun.castShadow = true;
  sun.shadow.mapSize.set(matchMedia('(pointer: coarse)').matches ? 2048 : 4096, matchMedia('(pointer: coarse)').matches ? 2048 : 4096); Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 26, bottom: -26, near: 1, far: 80 }); sun.shadow.normalBias = .04; sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), applySurface(new THREE.MeshStandardMaterial({ color: '#8fbb80', roughness: .95 }), 'grass', { bump: .6, repeat: 70 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.07; floor.receiveShadow = true; scene.add(floor);

  const koto = room.character.clone(true); koto.position.copy(dock({ lane: 'heard' })); koto.rotation.set(0, 0, 0); koto.scale.setScalar(1.15); koto.add(room.courierBag.clone(true)); scene.add(koto);
  const feet = ['footL', 'footR'].map(n => koto.getObjectByName(n)), bases = feet.map(f => f.position.clone());
  const arms = ['armL', 'armR'].map(n => koto.getObjectByName(n));
  const armBases = arms.map(a => ({ position: a.position.clone(), quaternion: a.quaternion.clone(), scale: a.scale.clone() }));

  // 部屋の建物。動かない部品は材質ごとに 1 つへまとめて、描く回数を減らす。
  const space = room.mindSpace.clone(true); space.updateMatrixWorld(true);
  const tools = Object.fromEntries(['mind_lens', 'mind_gate', 'mind_scoop', 'mind_stick'].map(n => [n, space.getObjectByName(n)]));
  const doors = Object.entries(ROOMS).map(([name, r]) => ({ leaf: space.getObjectByName(`${name}_door`), at: new V3(r.x - 3.7, 0, r.z + 3.06), open: 0 })).filter(d => d.leaf);
  const loose = [...Object.values(tools), ...doors.map(d => d.leaf)];
  const byMaterial = new Map();
  space.traverse(o => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (loose.includes(p)) return;
    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const key of Object.keys(geometry.attributes)) if (!['position', 'normal'].includes(key)) geometry.deleteAttribute(key);
    if (!byMaterial.has(o.material)) byMaterial.set(o.material, []);
    byMaterial.get(o.material).push(geometry);
  });
  // 材質の名前で手ざわりを決める: [模様, 凹凸, 1 単位あたりの繰り返し, 木目を横向きにするか]
  const surfaces = [[/^mind_hall/, 'tile', .35, .5, false], [/^mind_wall_hall/, 'wood', .4, .6, false], [/^mind_plank/, 'wood', .5, .45, false], [/^mind_oak/, 'wood', .4, .6, true], [/^mind_(plaster|trim|paper)/, 'plaster', .35, .5, false],
    [/^mind_rug/, 'fabric', .6, 1.6, false], [/^mind_wall/, 'plaster', .25, .7, false], [/^mind_(path|stone)/, 'sand', .5, .4, false], [/^mind_(crown|leaf)/, 'grass', .7, .9, false]];
  for (const [material, list] of byMaterial) {
    const geometry = mergeGeometries(list), surface = surfaces.find(([pattern]) => pattern.test(material.name));
    if (surface) { boxUV(geometry, surface[3], surface[4]); applySurface(material, surface[1], { bump: surface[2] }); }
    const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
    list.forEach(geometry => geometry.dispose());
  }
  for (const tool of Object.values(tools)) { if (!tool) continue; scene.add(tool); tool.traverse(o => { if (o.isMesh) o.castShadow = true; }); tool.visible = false; tool.rotation.set(0, 0, 0); }
  for (const door of doors) { scene.add(door.leaf); door.leaf.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); }
  const { mind_lens: lens, mind_gate: gate, mind_scoop: scoop, mind_stick: stick } = tools;

  // ルーレット
  const wheelAt = tableOf(ROOMS.roulette);
  const wheelCanvas = document.createElement('canvas'); wheelCanvas.width = wheelCanvas.height = 1024;
  const wheelTexture = new THREE.CanvasTexture(wheelCanvas); wheelTexture.colorSpace = THREE.SRGBColorSpace;
  const wheel = new THREE.Mesh(new THREE.CircleGeometry(1.43, 128), new THREE.MeshStandardMaterial({ map: wheelTexture, roughness: .8 }));
  wheel.rotation.x = -Math.PI / 2; wheel.position.set(wheelAt.x, .86, wheelAt.z); scene.add(wheel);
  const needle = new THREE.Group(); needle.position.set(wheelAt.x, 1.06, wheelAt.z); scene.add(needle);
  const needleMaterial = new THREE.MeshStandardMaterial({ color: '#c4654c', roughness: .4 });
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(.065, .05, 1.22), needleMaterial); shaft.position.z = -.61; needle.add(shaft);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.13, .27, 24), needleMaterial); tip.rotation.x = -Math.PI / 2; tip.position.z = -1.24; needle.add(tip);
  let wheelRows = null;
  function paintWheel(rows) {
    if (rows === wheelRows) return;
    wheelRows = rows;
    const c = wheelCanvas.getContext('2d'); c.clearRect(0, 0, 1024, 1024);
    c.fillStyle = '#eee5c7'; c.beginPath(); c.arc(512, 512, 510, 0, Math.PI * 2); c.fill();
    let start = -Math.PI / 2;
    const colors = ['#edb96f', '#7dbbad', '#b4a5d5', '#dc947f', '#98ba77', '#81b1d2'];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i], end = start + row.p * Math.PI * 2;
      c.beginPath(); c.moveTo(512, 512); c.arc(512, 512, 505, start, end); c.closePath(); c.fillStyle = colors[i % colors.length]; c.fill(); c.strokeStyle = '#f9efcf'; c.lineWidth = 3; c.stroke();
      if (row.p > .025) {
        const angle = (start + end) / 2;
        c.save(); c.translate(512 + Math.cos(angle) * 330, 512 + Math.sin(angle) * 330); c.rotate(angle + Math.PI / 2);
        c.fillStyle = '#263d3b'; c.font = 'bold 62px "Yu Gothic UI", sans-serif'; c.textAlign = 'center'; c.fillText(tokenLabel(row.token), 0, 0, 200);
        c.font = 'bold 36px "Yu Gothic UI", sans-serif'; c.fillText(`${(row.p * 100).toFixed(1)}%`, 0, 48); c.restore();
      }
      start = end;
    }
    wheelTexture.needsUpdate = true;
  }

  // 空き地の掲示板: れんしゅうの きろく
  const boardCanvas = document.createElement('canvas'); boardCanvas.width = 1020; boardCanvas.height = 540;
  const boardTexture = new THREE.CanvasTexture(boardCanvas); boardTexture.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(5.1, 2.7), new THREE.MeshStandardMaterial({ map: boardTexture, roughness: .9 }));
  board.position.set(11, 2.3, 7.69); scene.add(board);
  let boardKey = null;
  function paintBoard(v) {
    const losses = v.losses ?? [], quiz = losses.at(-1)?.quiz, key = `${v.mode}|${losses.length}`;
    if (key === boardKey) return;
    boardKey = key;
    const c = boardCanvas.getContext('2d'); c.fillStyle = '#f1ead0'; c.fillRect(0, 0, 1020, 540);
    c.fillStyle = '#4a3a2a'; c.textAlign = 'center'; c.font = 'bold 54px "Yu Gothic UI", sans-serif'; c.fillText('れんしゅうの きろく', 510, 70);
    c.font = '30px "Yu Gothic UI", sans-serif';
    if (!losses.length) {
      c.fillStyle = '#7a6a55';
      c.fillText('ねむると、聞いた会話で', 510, 230); c.fillText('「次の文字 当て」を 12回 れんしゅうします。', 510, 280);
      c.fillText('はずれの 大きさが ここに ならびます。', 510, 350);
    } else {
      const max = Math.max(...losses.map(h => h.loss), 1e-6);
      c.fillStyle = '#7a6a55'; c.fillText(`はずれの 大きさ（小さいほど よく当たる）  ${losses.length} / 12 回め`, 510, 120);
      for (let i = 0; i < 12; i++) {
        const x = 80 + i * 73;
        c.fillStyle = '#d9cfae'; c.fillRect(x, 400, 54, 4);
        if (!losses[i]) continue;
        const h = Math.max(4, losses[i].loss / max * 230);
        c.fillStyle = i === losses.length - 1 ? '#e07a4f' : '#e6b65a'; c.fillRect(x, 400 - h, 54, h);
        c.fillStyle = '#4a3a2a'; c.font = '22px "Yu Gothic UI", sans-serif'; c.fillText(losses[i].loss.toFixed(2), x + 27, 392 - h);
        c.fillText(String(i + 1), x + 27, 432);
      }
      if (quiz) {
        c.font = 'bold 32px "Yu Gothic UI", sans-serif'; c.fillStyle = '#35604f';
        c.fillText(`「${quiz.context.map(tokenLabel).join('')}」の 次は「${tokenLabel(quiz.answer)}」 → 当たる確率 ${(quiz.p * 100).toFixed(1)}%`, 510, 500, 960);
      }
    }
    boardTexture.needsUpdate = true;
  }

  // 部屋の看板。奥の壁の上の板に貼る（作業中の部屋は赤い字にする）
  const signs = Object.entries(ROOMS).map(([name, r]) => {
    const textures = ['#4a3a2a', '#c4472d'].map(color => {
      const c = document.createElement('canvas'); c.width = 1024; c.height = 208; const g = c.getContext('2d');
      g.fillStyle = color; g.font = 'bold 132px "Yu Gothic UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(r.sign, 512, 112, 980);
      const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8; return texture;
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, .69), new THREE.MeshBasicMaterial({ map: textures[0], transparent: true, toneMapped: false }));
    mesh.position.set(r.x, 3.05, r.z - 2.975); scene.add(mesh);
    return { name, mesh, textures };
  });

  // 文字の札と立て札
  const items = new THREE.Group(); scene.add(items);
  const cache = new Map(), pool = []; let used = 0;
  function label(text, p, width = 1, color = '#fff0ce', style = width <= 1.2 ? 'card' : 'board') {
    const key = `${text}|${color}|${style}`;
    if (!cache.has(key)) {
      const isCard = style === 'card';
      const c = document.createElement('canvas'); c.width = isCard || style === 'num' ? 128 : 512; c.height = style === 'num' ? 64 : 128; const g = c.getContext('2d');
      if (style === 'num') {
        // 数そのものを書いた札。色は符号（金色 = プラス、青 = マイナス）
        g.fillStyle = color; g.beginPath(); g.roundRect(2, 2, 124, 60, 12); g.fill(); g.strokeStyle = '#5b5340'; g.lineWidth = 3; g.stroke();
        g.fillStyle = '#2f3b33'; g.font = 'bold 40px "Yu Gothic UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(text), 64, 35, 116);
      } else {
      if (style !== 'sign') {
        g.fillStyle = isCard ? color : '#283b43'; g.beginPath(); g.roundRect(3, 3, c.width - 6, 122, 18); g.fill();
        g.strokeStyle = isCard ? '#b9a475' : color; g.lineWidth = 4; g.stroke();
      }
      g.fillStyle = isCard ? '#40533f' : color; g.font = `bold ${isCard ? 64 : style === 'sign' ? 76 : 50}px "Yu Gothic UI", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(text), c.width / 2, 68, c.width - 22);
      }
      const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
      cache.set(key, new THREE.SpriteMaterial({ map: texture, depthTest: true }));
    }
    let sprite = pool[used]; if (!sprite) { sprite = new THREE.Sprite(); pool.push(sprite); items.add(sprite); }
    used++; sprite.material = cache.get(key); sprite.visible = true; sprite.position.copy(p); sprite.scale.set(width, style === 'card' ? width * .7 : style === 'num' ? width * .5 : width / 4, 1); return sprite;
  }
  // 数を表す棒と粒
  const barGeometry = new THREE.BoxGeometry(1, 1, 1), beadGeometry = new THREE.SphereGeometry(1, 12, 8);
  const materials = new Map(), barPool = [], beadPool = []; let barUsed = 0, beadUsed = 0;
  const paint = color => { if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .6 })); return materials.get(color); };
  function bar(x, z, h, color, w = .16, d = .2, y0 = TOP) {
    let mesh = barPool[barUsed]; if (!mesh) { mesh = new THREE.Mesh(barGeometry, paint(color)); mesh.castShadow = true; scene.add(mesh); barPool.push(mesh); }
    barUsed++; h = Math.max(.012, h); mesh.material = paint(color); mesh.visible = true; mesh.rotation.set(0, 0, 0); mesh.scale.set(w, h, d); mesh.position.set(x, y0 + h / 2, z); return mesh;
  }
  function bead(p, r, color) {
    let mesh = beadPool[beadUsed]; if (!mesh) { mesh = new THREE.Mesh(beadGeometry, paint(color)); scene.add(mesh); beadPool.push(mesh); }
    beadUsed++; mesh.material = paint(color); mesh.visible = true; mesh.scale.setScalar(r); mesh.position.copy(p); return mesh;
  }
  const tone = (value, pale) => value < 0 ? (pale ? BLUE_PALE : BLUE) : (pale ? GOLD_PALE : GOLD);
  const scaleOf = (...lists) => .4 / Math.max(1e-6, ...lists.flatMap(list => (list ?? []).map(Math.abs)));
  const arc = (a, b, k, lift) => a.clone().lerp(b, k).setY(lerp(a.y, b.y, k) + Math.sin(k * Math.PI) * lift);

  // 部屋ごとの机の上。f は作業中の手順（終わった部屋は null）。手を伸ばす先を返す。
  const signed = value => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(2)}`;
  function drawStage(i, stage, f, clock, numbers) {
    const t = tableOf(ROOMS[`work${i}`]), kind = stage.kind ?? 'tune';
    const X0 = t.x - 1.7, WIDTH = 4.7, mid = X0 + WIDTH / 2;
    const colX = (n, j) => X0 + (j + .5) * WIDTH / n;
    const caption = (text, z) => label(text, new V3(t.x - 2.45, .92, z), 1.3, '#fff0ce', 'board');
    const state = j => !f ? 1 : j < f.index ? 1 : j > f.index ? 0 : f.phase;
    // 棒の上に、その数を書いた札を立てる。棒の高さ = 数の大きさ、色 = 符号
    const num = (x, z, top, value) => { if (numbers) label(signed(value), new V3(x, top + .14, z), .37, value < 0 ? '#a9d4ee' : '#f7d98a', 'num'); };
    const post = (x, z, height, value, pale, w = .2) => { bar(x, z, height, tone(value, pale), w); num(x, z, TOP + height, value); };
    let hand = null;
    if (kind === 'add') {
      const za = t.z - .58, zb = t.z - .12, zr = t.z + .52, n = stage.values.length, s = scaleOf(stage.a, stage.b, stage.values), w = .2;
      const h = value => .04 + Math.abs(value) * s;
      caption(i === 0 ? `文字「${tokenLabel(stage.token)}」の数` : 'もとの 数', za); caption(i === 0 ? `${stage.position + 1}番めの 数` : 'まぜた 手がかり', zb); caption('たした 数', zr);
      for (let j = 0; j < n; j++) {
        const x = colX(n, j), st = state(j), a = stage.a[j], b = stage.b[j];
        post(x, za, h(a), a, st > 0); post(x, zb, h(b), b, st > 0);
        if (st >= 1) post(x, zr, h(stage.values[j]), stage.values[j]);
        else if (st > 0) {
          // 2 本を持ち上げて手前で重ね、1 本の合計にする
          const ma = ease(clamp((st - .08) / .3)), mb = ease(clamp((st - .32) / .3)), join = ease(clamp((st - .7) / .22));
          if (join <= 0) {
            if (ma > 0) bar(x, lerp(za, zr, ma), h(a), tone(a), w, .2, TOP + Math.sin(ma * Math.PI) * .5);
            if (mb > 0) bar(x, lerp(zb, zr, mb), h(b), tone(b), w, .2, TOP + lerp(Math.sin(mb * Math.PI) * .5, h(a), mb));
          } else bar(x, zr, lerp(h(a) + h(b), h(stage.values[j]), join), tone(stage.values[j]), w * (1 + Math.sin(join * Math.PI) * .35));
          const carrying = mb > 0 && mb < 1 ? [zb, mb, h(b)] : [za, ma, h(a)];
          hand = join > 0 ? new V3(x, TOP + h(stage.values[j]) + .1, zr) : new V3(x, TOP + Math.sin(carrying[1] * Math.PI) * .5 + carrying[2] + .05, lerp(carrying[0], zr, carrying[1]));
        }
      }
    } else if (kind === 'match' || kind === 'mix') {
      const n = stage.tokens.length, top = Math.max(...stage.weights, 1e-9), rows = n > 12 ? 2 : 1, per = Math.min(n, 12);
      const gap = Math.min(.8, WIDTH / per), size = Math.min(.55, gap * .9), zr = t.z + .55;
      const zs = kind === 'match' ? (rows > 1 ? [t.z - .4, t.z + .4] : [t.z]) : (rows > 1 ? [t.z - .68, t.z - .22] : [t.z - .45]);
      const slot = j => new V3(mid + ((j % 12) - (Math.min(n - Math.floor(j / 12) * 12, 12) - 1) / 2) * gap, TOP, zs[Math.floor(j / 12)]);
      const best = [...stage.weights.keys()].sort((a, b) => stage.weights[b] - stage.weights[a]).slice(0, 3);
      const cards = [];
      for (let j = 0; j < n; j++) {
        const p = slot(j), st = kind === 'match' ? state(j) : 1, active = f && j === f.index;
        const height = (.05 + stage.weights[j] / top * .75) * ease(clamp((st - .4) / .45));
        if (height > .01) bar(p.x, p.z, height, active ? HOT : GOLD, size * .8, size * .55);
        const card = p.clone().setY(TOP + height + size * .35 + .03); cards.push(card);
        label(tokenLabel(stage.tokens[j]), card, size, active ? '#ffe2a6' : '#fff0ce');
        if (st >= 1 && best.includes(j) && !active) label(`${(stage.weights[j] * 100).toFixed(0)}%`, card.clone().add(new V3(0, size * .35 + .16, 0)), .62, '#ffd878', 'board');
        if (active && kind === 'match') {
          // 虫めがねで 1 文字ずつ見くらべる
          const look = clamp(st / .45), hover = new V3(p.x + Math.cos(clock * 7) * .07 * (1 - look), card.y + .42 - look * .12, p.z + Math.sin(clock * 7) * .07 * (1 - look));
          lens.visible = true; lens.position.copy(hover); hand = hover.clone().add(new V3(0, 0, -.62));
        }
      }
      if (kind === 'mix') {
        caption('まぜた 手がかり', zr);
        const m = stage.values.length, s = scaleOf(stage.values), pour = f ? ease(clamp((f.phase - .5) / .4)) : 1;
        const sum = Array(m).fill(0);
        for (let j = 0; j < n; j++) { const k = !f ? 1 : j < f.index ? 1 : j === f.index ? pour : 0; if (k) for (let d = 0; d < m; d++) sum[d] += stage.weights[j] * stage.parts[j][d] * k; }
        const settled = !f || pour <= 0 || pour >= 1;
        for (let d = 0; d < m; d++) { const height = .04 + Math.min(.5, Math.abs(sum[d]) * s); bar(colX(m, d), zr, height, tone(sum[d]), .2); if (settled) num(colX(m, d), zr, TOP + height, sum[d]); }
        if (f && f.phase < .92) {
          // 見る割合のぶんだけ、すくって手前にまぜる
          const j = f.index, from = cards[j].clone().add(new V3(0, .25, 0)), go = ease(clamp((f.phase - .12) / .45)), share = stage.weights[j] / top;
          const center = arc(from, new V3(mid, TOP + .75, zr - .1), go, .5);
          scoop.visible = true; scoop.position.copy(center); scoop.rotation.x = pour * .9; hand = center.clone().add(new V3(0, .08, -.5));
          if (f.phase > .12) for (let d = 0; d < m; d++) {
            const drop = clamp((f.phase - .5) / .35 - d / m * .3);
            const p = drop > 0 ? center.clone().lerp(new V3(colX(m, d), TOP + .1, zr), ease(clamp(drop * 1.6))) : center.clone().add(new V3(Math.cos(d * 2.4) * .07, .08 + (d % 3) * .03, Math.sin(d * 2.4) * .07));
            if (drop < .62) bead(p, .03 + .05 * Math.sqrt(share), tone(stage.parts[j][d]));
          }
        }
      }
    } else if (kind === 'gate') {
      // 24 個を 12 個ずつ 2 列に並べ、まん中のしぼり機をくぐらせる
      const n = stage.values.length, s = scaleOf(stage.before, stage.values), zg = t.z;
      const zb = j => t.z - .76 + Math.floor(j / 12) * .34, zr = j => t.z + .42 + Math.floor(j / 12) * .34;
      const h = value => .04 + Math.abs(value) * s;
      caption('しぼる 前', t.z - .6); caption('しぼった 後', t.z + .6);
      const at = f ? f.index : n - 1;
      gate.visible = true; gate.position.set(colX(12, at % 12), TOP, zg);
      for (let j = 0; j < n; j++) {
        const x = colX(12, j % 12), st = state(j), before = stage.before[j], after = stage.values[j];
        if (st <= 0) post(x, zb(j), h(before), before);
        else if (st >= 1) post(x, zr(j), h(after), after);
        else {
          // しぼり機をくぐると、マイナスの数は小さくつぶれる
          const go = ease(clamp((st - .12) / .7)), squeeze = ease(clamp((go - .38) / .24));
          const height = lerp(h(before), h(after), squeeze), z = lerp(zb(j), zr(j), go);
          bar(x, z, height, squeeze < .5 ? tone(before) : tone(after), .2, .2, TOP + Math.sin(go * Math.PI) * .03);
          num(x, z, TOP + height + .03, squeeze < .5 ? before : after);
          hand = new V3(x, TOP + height + .06, z - .14);
        }
      }
    } else if (kind === 'score') {
      const zb = t.z - .5, zc = t.z + .4, m = stage.values.length, n = stage.candidates.length, s = scaleOf(stage.values) * .8;
      caption('こたえの 手がかり', zb); caption('文字ごとの 点', zc);
      const sources = stage.values.map((value, d) => { const x = colX(m, d), height = .04 + Math.abs(value) * s; post(x, zb, height, value); return new V3(x, TOP + height, zb); });
      const scores = stage.candidates.map(c => c.score), low = Math.min(...scores), span = Math.max(1e-6, Math.max(...scores) - low);
      for (let j = 0; j < n; j++) {
        const c = stage.candidates[j], st = state(j), active = f && j === f.index, p = neuralPoint({ lane: 'work', index: i, slot: j, count: n });
        const height = (.1 + (c.score - low) / span * .68) * ease(clamp((st - .5) / .4));
        if (height > .01) bar(p.x, zc, height, active ? HOT : GOLD, .5, .34);
        const card = new V3(p.x, TOP + height + .27, zc);
        label(tokenLabel(c.token), card, .68, active ? '#ffe2a6' : '#fff0ce');
        if (st >= 1) label(`${c.score.toFixed(1)}点`, card.clone().add(new V3(0, .42, 0)), .8, '#ffd878', 'board');
        if (active) {
          // 手がかりを 1 文字ずつ照らし合わせて点にする
          hand = card.clone().add(new V3(0, .05, -.3));
          if (st < .62) sources.forEach((from, d) => bead(arc(from, card, ease(clamp(st / .5 - d / m * .25)), .5), .045, tone(stage.values[d])));
        }
      }
    } else {
      // 重み（道具の目もり）。学習では、調整の前の高さに印を残して動かす
      const n = stage.values.length, s = scaleOf(stage.values, stage.before), w = .2;
      const zr = j => t.z - .2 + Math.floor(j / 12) * .6;
      caption(`「${stage.label}」の`, t.z - .2); caption('目もり（重み）', t.z + .4);
      for (let j = 0; j < n; j++) {
        const x = colX(12, j % 12), unit = Math.floor(j / 4), st = !stage.before ? 1 : state(unit), go = ease(clamp((st - .25) / .55));
        const before = stage.before?.[j] ?? stage.values[j], value = lerp(before, stage.values[j], go), active = f && unit === f.index;
        const height = .04 + Math.abs(value) * s;
        const mesh = bar(x, zr(j), height, active ? (value < 0 ? '#7fc4ee' : '#ffd166') : tone(value), w);
        if (active && st < 1) mesh.rotation.z = Math.sin(clock * 30 + j) * .1 * Math.sin(st * Math.PI);
        if (go <= 0 || go >= 1) num(x, zr(j), TOP + height, value);
        if (stage.before) bar(x, zr(j) - .15, .02, MARK, w + .06, .04, TOP + .04 + Math.abs(before) * s);
      }
      if (f) { const j = Math.min(n - 1, f.index * 4 + 1); hand = new V3(colX(12, j % 12) + WIDTH / 24, TOP + .6 + Math.sin(f.phase * Math.PI * 4) * .05, zr(j) - .05); }
    }
    return hand;
  }

  let lastTravel = null, path = [], lastViewKey = '', facing = 0, doorCount = 0, blend = 1;
  let lastTime = 0, slowFrames = 0, light = false;
  function draw(g, v, W, H, clock) {
    toolbar.hidden = false; controls.enabled = true;
    // 動きの速さはコマ数に左右されないよう、前のコマからの時間で決める
    const now = performance.now(), dt = Math.min(.25, lastTime ? (now - lastTime) / 1000 : .016); lastTime = now;
    const toward1 = rate => 1 - Math.exp(-rate * dt);
    // 描くのに時間がかかる端末では、解像度と影を軽くする
    slowFrames = dt > .05 ? slowFrames + 1 : Math.max(0, slowFrames - 2);
    if (!light && slowFrames > 40) {
      light = true; renderer.setPixelRatio(1); renderer.setSize(W, H);
      sun.shadow.mapSize.set(1024, 1024); sun.shadow.map?.dispose(); sun.shadow.map = null;
      canvas.dataset.quality = 'light';
    }
    if (W !== lastW || H !== lastH) { renderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix(); lastW = W; lastH = H; }
    used = barUsed = beadUsed = 0;
    for (const tool of [lens, gate, scoop, stick]) if (tool) tool.visible = false;
    const raw = v.courier, work = v.operation;
    const travel = raw && { k: raw.k, tokens: raw.tokens ?? (raw.token != null ? [raw.token] : []), froms: raw.froms ?? [raw.from], tos: raw.tos ?? [raw.to] };
    const count = travel?.tokens.length ?? 0, pack = count > 1 ? .3 : .2;
    const k = travel?.k ?? 1, walk = travel ? clamp((k - pack) / (1 - pack * 2)) : 1;
    const lottery = v.phase === 'pick' && v.lottery && !count ? v.lottery : null;
    paintWheel(v.rows); paintBoard(v);
    const turn = v.lottery ? rouletteTurn(v.lottery.k, v.lottery.r) : 0;
    needle.rotation.y = -Math.PI * 2 * turn;
    if (v.lottery) {
      canvas.dataset.roulette = v.lottery.k < 1 ? 'spinning' : 'landed';
      canvas.dataset.rouletteMatch = String(rouletteSector(v.rows, v.lottery.r)?.token === v.lottery.token);
    } else { delete canvas.dataset.roulette; delete canvas.dataset.rouletteMatch; }

    // 札と数
    const stages = v.stages ?? [];
    const activeStage = work ? stages[work.index] : null;
    const active = activeStage ? workFrame(activeStage, work.k) : null;
    let hand = null;
    for (let i = 0; i < 6; i++) if (stages[i]) { const reach = drawStage(i, stages[i], work?.index === i ? active : null, clock, !work || work.index === i); if (work?.index === i) hand = reach; }
    for (const sign of signs) {
      const here = work ? sign.name === `work${work.index}` : lottery ? sign.name === 'roulette' : false;
      sign.mesh.material.map = sign.textures[here ? 1 : 0];
    }
    const moving = (lane, index) => count && k > 0 && travel.froms.some((a, n) => a.lane === lane && a.index === index && lane !== 'output' && lane !== 'work' && (count === 1 || k >= pack * n / count));
    const source = v.source ?? v.heard ?? v.seq ?? [];
    const start = Math.floor((v.sourceAt ?? 0) / 24) * 24;
    source.slice(start, start + 24).forEach((token, i) => { if (!moving('heard', i)) label(tokenLabel(token), neuralPoint({ lane: 'heard', index: i }), .46); });
    if (source.length > 24) label(`${start + 1}–${Math.min(start + 24, source.length)} / ${source.length}`, neuralPoint({ lane: 'heard', index: 5 }).add(new V3(.25, 1, -.3)), 1.6);
    (v.contextCards ?? []).forEach((token, i) => {
      const p = neuralPoint({ lane: 'attention', index: i });
      if (token != null && !moving('attention', i)) label(tokenLabel(token), p, .46, v.attentionFocus === i ? '#ffd878' : '#fff0ce');
    });
    if (v.workToken != null && !stages[v.workAt ?? 0] && !moving('work', v.workAt ?? 0)) label(tokenLabel(v.workToken), neuralPoint({ lane: 'work', index: v.workAt ?? 0 }), .9);
    (v.visibleRows ?? []).forEach((r, i) => {
      if (!r) return;
      const grow = ease(v.share ?? 1), shown = grow < 1 ? Math.round(r.p * grow * 100) : (r.p * 100).toFixed(1);
      const p = neuralPoint({ lane: 'candidates', index: i }), chosen = r.token === v.picked, height = .05 + r.p * 1.1 * grow;
      bar(p.x, p.z - .5, height, chosen ? HOT : GOLD, .5, .3);
      label(`${shown}%`, new V3(p.x, TOP + height + .2, p.z - .5), 1.0, chosen ? '#ffd878' : '#fff0ce', 'board');
      if (!moving('candidates', i)) label(tokenLabel(r.token), p, .9, chosen ? '#ffd878' : '#fff0ce');
    });
    if (v.lottery?.k === 1 && !(count && travel.froms[0].lane === 'roulette' && k > 0)) label(tokenLabel(v.lottery.token), neuralPoint({ lane: 'roulette' }), 1);
    (v.out ?? []).forEach((token, i) => label(tokenLabel(token), neuralPoint({ lane: 'output', index: i }), .58));
    if (v.endText) label(v.endText, neuralPoint({ lane: 'output', index: 4 }).add(new V3(.3, 1.3, -.4)), 4);

    // コトの移動
    let target, toward = null;
    if (work && active) {
      const t = tableOf(ROOMS[`work${work.index}`]);
      target = new V3(between(hand?.x ?? koto.position.x, t.x - 2.4, t.x + 2.9), 0, t.z - t.d / 2 - .62);
    } else if (travel) {
      if (raw !== lastTravel) { lastTravel = raw; path = route(travel.froms.at(-1), travel.tos[0]); }
      if (k <= pack) target = dock(travel.froms[count ? Math.min(count - 1, Math.floor(k / pack * count)) : 0]);
      else if (k >= 1 - pack) target = dock(travel.tos[count ? Math.min(count - 1, Math.floor((k - 1 + pack) / pack * count)) : 0]);
      else { const step = along(path, ease(walk)); target = step.position; toward = step.direction; }
    } else target = koto.position.clone();
    const walking = !!toward && toward.lengthSq() > 1e-6;
    if (walking || koto.position.distanceTo(target) > 4) koto.position.copy(target); else koto.position.lerp(target, toward1(14));
    const want = walking ? Math.atan2(toward.x, toward.z) : 0;
    facing += Math.atan2(Math.sin(want - facing), Math.cos(want - facing)) * toward1(walking ? 18 : 10);
    koto.rotation.y = facing;
    const stride = walk * lengthOf(path) * 2.6;
    feet.forEach((f, i) => { const a = stride + i * Math.PI; f.position.copy(bases[i]); if (walking) { f.position.z += Math.sin(a) * .16; f.position.y += Math.max(0, Math.cos(a)) * .1; } });
    arms.forEach((a, i) => { a.position.copy(armBases[i].position); a.quaternion.copy(armBases[i].quaternion); a.scale.copy(armBases[i].scale); a.rotation.x = walking ? Math.sin(stride + i * Math.PI) * .5 : -.5; });
    if (lottery && lottery.k < .15) hand = new V3(wheelAt.x + .35, 1.0, wheelAt.z - 1.3);
    if (hand) {
      // 腕を向け、その先は長い柄でつなぐ（腕は伸ばさない）
      const arm = arms[hand.x < koto.position.x ? 1 : 0]; koto.updateMatrixWorld(true);
      const local = arm.parent.worldToLocal(hand.clone()).sub(arm.position).normalize();
      arm.quaternion.setFromUnitVectors(new V3(0, -1, 0), local); arm.updateMatrixWorld(true);
      const grip = arm.localToWorld(new V3(0, -.2, 0));
      if (stick) { stick.visible = true; stick.position.copy(grip); stick.lookAt(hand); stick.scale.set(1, 1, Math.max(.05, grip.distanceTo(hand))); }
    }

    // 近づくとドアが開き、通りすぎると閉まる
    for (const door of doors) {
      const near = koto.position.distanceTo(door.at) < 3;
      if (near && !door.near) { doorCount++; canvas.dataset.doors = String(doorCount); }
      door.near = near;
      door.open = lerp(door.open, near ? 1 : 0, toward1(near ? 12 : 3));
      door.leaf.rotation.y = -door.open * 1.75;
    }

    // かばんへ出し入れする札と数
    const bag = koto.position.clone().add(new V3(0, .8, 0));
    travel?.tokens.forEach((token, n) => {
      const a = neuralPoint(travel.froms[n]), b = neuralPoint(travel.tos[n]);
      const size = travel.froms[n].lane === 'candidates' || travel.froms[n].lane === 'work' ? .8 : .55;
      const put = clamp((k - pack * n / count) / (pack / count)), take = clamp((k - 1 + pack - pack * n / count) / (pack / count));
      if (put <= 0) return;
      if (put < 1) label(tokenLabel(token), arc(a, bag, ease(put), .5), size * (1 - put * .6));
      else if (take > 0 && take < 1) label(tokenLabel(token), arc(bag, b, ease(take), .5), size * (.4 + take * .6));
    });
    if (v.packet && travel && !count && (k < .2 || k > .8)) {
      const spread = (address, i) => { const t = tableOf(roomOf(address)); return new V3(t.x - 1.5 + i * (4.3 / v.packet.length), TOP + .3, t.z + .5); };
      v.packet.slice(0, 24).forEach((value, i) => bead(k < .2 ? spread(travel.froms[0], i).lerp(bag, ease(k / .2)) : bag.clone().lerp(spread(travel.tos[0], i), ease((k - .8) / .2)), .075, tone(value)));
    }
    if (active && activeStage) {
      const text = readout(activeStage, active), t = tableOf(ROOMS[`work${work.index}`]);
      // 色と高さの読み方
      [['金色 ＝ プラス', '#f7d98a'], ['青 ＝ マイナス', '#a9d4ee'], ['高さ ＝ 大きさ', '#fff0ce']].forEach(([line, color], n) => label(line, new V3(t.x + (narrow() ? -1.1 + n * 1.25 : 2.85), narrow() ? .08 : .95 - n * .4, t.z + t.d / 2 + (narrow() ? .9 : .45)), narrow() ? 1.2 : 1.15, color, 'board'));
      if (text) label(text, new V3(narrow() && hand ? between(hand.x, t.x - 1.6, t.x + 1.6) : t.x + .3, .52, t.z + t.d / 2 + .45), narrow() ? 3.0 : 3.2, '#fff0ce', 'board');
    }
    for (let i = used; i < pool.length; i++) pool[i].visible = false;
    for (let i = barUsed; i < barPool.length; i++) barPool[i].visible = false;
    for (let i = beadUsed; i < beadPool.length; i++) beadPool[i].visible = false;

    notes.hidden = !explanations;
    if (explanations) {
      const info = explainNeural(v);
      for (const [element, text] of [[heading, info.title], [body, info.body], [detail, info.detail]]) if (element.textContent !== text) element.textContent = text;
    }
    canvas.dataset.view = following && lottery ? 'roulette-closeup' : following && work ? 'work-closeup' : following ? 'follow' : 'free';
    if (work && active) canvas.dataset.manipulating = String(active.index); else delete canvas.dataset.manipulating;
    if (work && active) canvas.dataset.hand = active.phase > .35 && active.phase < .8 ? 'holding' : 'ready'; else delete canvas.dataset.hand;
    // Remove textures no longer used in this frame; long conversations must not grow GPU memory forever.
    const live = new Set(pool.slice(0, used).map(s => s.material));
    for (const [key, material] of cache) if (!live.has(material)) { material.map.dispose(); material.dispose(); cache.delete(key); }
    if (following) {
      let look, offset, key;
      if (lottery) { look = new V3(wheelAt.x, .9, wheelAt.z); offset = new V3(.6, 5.4, 4.8).multiplyScalar(narrow() ? 1.25 : 1); key = 'roulette'; }
      else if (work) {
        const t = tableOf(ROOMS[`work${work.index}`]);
        look = new V3(narrow() ? between(hand?.x ?? t.x, t.x - 2, t.x + 2.4) : t.x + .1, .8, t.z - .1);
        offset = narrow() ? new V3(0, 6.6, 7.6) : new V3(0, 5.3, 6.1); key = `work-${work.index}`;
      } else { look = koto.position.clone().add(new V3(0, .8, 0)); offset = followOffset(); key = 'follow'; }
      if (lastViewKey === '') blend = 1; else if (key !== lastViewKey) blend = 0;
      lastViewKey = key; blend = Math.min(1, blend + dt * 1.6);
      const amount = toward1(lerp(3.5, 16, blend));
      camera.position.lerp(look.clone().add(offset), amount); controls.target.lerp(look, amount); controls.update();
    }
    renderer.render(scene, camera); g.drawImage(renderer.domElement, 0, 0, W, H);
  }
  return {
    draw,
    open() { toolbar.hidden = false; controls.enabled = true; canvas.style.touchAction = 'none'; following = true; lastViewKey = ''; lastTravel = null; follow.setAttribute('aria-pressed', 'true'); koto.position.copy(dock({ lane: 'heard' })); facing = 0; },
    close() { toolbar.hidden = true; notes.hidden = true; controls.enabled = false; canvas.style.touchAction = ''; },
  };
}
