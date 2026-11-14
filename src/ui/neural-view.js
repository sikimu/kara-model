import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { applySurface, boxUV } from './textures.js';
import { explainNeural, rouletteTurn, rouletteSector } from './neural-explanation.js';
import { simpleGuide, guidePicture, glossary } from './neural-guide.js';
import { tokenLabel } from '../model/vocabulary.js';

export { tokenLabel };
const V3 = THREE.Vector3;
const ease = k => k * k * (3 - 2 * k);
const clamp = k => Math.max(0, Math.min(1, k));
const between = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const TOP = .72; // 机の天板の高さ
const GOLD = '#f2c14e', BLUE = '#62aede', GOLD_PALE = '#eadfb4', BLUE_PALE = '#bfd9e6', HOT = '#ff9f55', MARK = '#8d8672';
const COVERS = ['#9e5c4d', '#54809e', '#709466', '#bd944d', '#8c709e', '#5c8c8c'];
const CARDS_PER_ROW = 24;

// 頭の中の部屋。blender/build_assets.py の MIND_ROOMS と同じ並び。
export const ROOMS = {
  context: { x: 0, z: 9, depth: 2.0, sign: 'じゅんばんに ならべる' },
  work0: { x: -11, z: 0, depth: 2.8, sign: '① 数に する' },
  work1: { x: 0, z: 0, depth: 2.8, sign: '② 見くらべる' },
  work2: { x: 11, z: 0, depth: 2.8, sign: '③ まぜる' },
  work3: { x: 11, z: -9, depth: 2.8, sign: '④ たしなおす' },
  work4: { x: 0, z: -9, depth: 2.8, sign: '⑤ しぼる' },
  work5: { x: -11, z: -9, depth: 2.8, sign: '⑥ 点を つける' },
  roulette: { x: -22, z: 0, depth: 3.4, sign: 'ルーレット' },
  output: { x: -22, z: 9, depth: 2.6, sign: 'へんじ' },
};
export const BOOK_TITLES = ['文字の本・順番の本', '②の本', '③の本', '（原本なし）', '⑤の本', '出力の本'];
const LANES = [-27.5, -16.5, -5.5, 5.5, 16.5];
const roomOf = a => ROOMS[a.lane === 'work' ? `work${a.index ?? 0}` : ['candidates', 'box'].includes(a.lane) ? 'roulette' : ['attention', 'sorting'].includes(a.lane) ? 'context' : a.lane] ?? ROOMS.context;
const tableOf = r => ({ x: r.x + .3, z: r.z + (r.depth >= 3 ? .5 : .7), w: r.depth >= 3 ? 4.4 : 6.4, d: r.depth });
const grid12 = (t, i, dz) => new V3(t.x - 2.75 + (i % 12) * .5, 1.2, t.z - dz + Math.floor(i / 12) * dz * 2);

// 札を置く場所。World coordinates are independent of the viewport.
export function neuralPoint(a) {
  const t = tableOf(roomOf(a)), index = a.index ?? 0;
  if (['entrance', 'heard'].includes(a.lane)) return new V3(12.9, 1.65, 14.8);
  if (a.lane === 'sorting') return new V3(t.x - 2.4 + index * .6, 1.15, t.z - .8);
  if (a.lane === 'box') return new V3(t.x + 1.65, 1.25, t.z - .65);
  if (a.lane === 'roulette') return new V3(t.x, 1.75, t.z);
  if (a.lane === 'work') return a.slot == null ? new V3(t.x + .4, 1.3, t.z + .3) : new V3(t.x + .65 + (a.slot - ((a.count ?? 5) - 1) / 2) * .95, 1.6, t.z + .4);
  if (a.lane === 'attention') return grid12(t, index % CARDS_PER_ROW, .45).add(new V3(Math.min(8, Math.floor(index / CARDS_PER_ROW)) * .07, Math.floor(index / CARDS_PER_ROW) * .16, Math.min(8, Math.floor(index / CARDS_PER_ROW)) * .09));
  if (a.lane === 'candidates') { const angle = Math.PI * index / 4; return new V3(t.x - Math.cos(angle) * 1.85, 1.25, t.z - Math.sin(angle) * 1.65); }
  if (a.lane === 'output') return new V3(t.x - 2.9 + (index % 10) * .64, 1.2, t.z - .8 + Math.min(2, Math.floor(index / 10)) * .8);
  return grid12(t, index % CARDS_PER_ROW, .35);
}
// コトが立つ場所。机の奥に立って、手前（見る人のほう）を向く。
function dock(a) {
  if (['entrance', 'heard'].includes(a.lane)) return new V3(12.9, 0, 13.8);
  const t = tableOf(roomOf(a)), p = neuralPoint(a);
  return new V3(between(p.x, t.x - t.w / 2 + .5, t.x + t.w / 2 - .5), 0, t.z - t.d / 2 - .85);
}
// 部屋から部屋へは、入口を出て道を通る。
function route(a, b) {
  const mail = a => ['entrance', 'heard'].includes(a.lane);
  if (mail(a) && mail(b)) return [dock(a), dock(b)];
  if (mail(b)) return route(b, a).reverse();
  // 部屋の中は、左の本棚と机の間（x = 部屋の中心 − 3.55）を通って机の奥へ回る
  if (mail(a)) { const r = roomOf(b); return [dock(a), new V3(12.9, 0, 13.5), new V3(r.x - 3.7, 0, 13.5), new V3(r.x - 3.55, 0, r.z + 3.1), new V3(r.x - 3.55, 0, dock(b).z), dock(b)]; }
  const ra = roomOf(a), rb = roomOf(b), A = dock(a), B = dock(b);
  if (ra === rb) return [A, B];
  const exit = (r, d) => [new V3(r.x - 3.55, 0, d.z), new V3(r.x - 3.55, 0, r.z + 3.1), new V3(r.x - 3.7, 0, r.z + 4.5)];
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

export function createNeuralView(room, canvas, model, inspector) {
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
  let followAt = -1e9;
  controls.addEventListener('start', () => { if (performance.now() - followAt < 400) return; following = false; follow.setAttribute('aria-pressed', 'false'); });
  const toolbar = document.createElement('div'); toolbar.className = 'mind-camera'; toolbar.hidden = true;
  const follow = document.createElement('button'); follow.textContent = 'コトを追う'; follow.type = 'button'; follow.setAttribute('aria-pressed', 'true');
  const overview = document.createElement('button'); overview.textContent = '見渡す'; overview.type = 'button';
  const headButton = document.createElement('button'); headButton.type = 'button'; headButton.className = 'mind-head-toggle'; headButton.hidden = true;
  const layerChip = document.createElement('span'); layerChip.className = 'mind-layer-chip'; layerChip.hidden = true;
  let level = 'detail', explanations = true;
  try { const saved = localStorage.getItem('kara-mind-guide'); if (saved === 'false') level = 'false'; } catch { /* Storage can be unavailable. */ }
  explanations = level !== 'false';
  const explain = document.createElement('button'); explain.type = 'button'; explain.className = 'mind-explain-toggle';
  const notes = document.createElement('section'); notes.className = 'mind-explanation'; notes.hidden = true; notes.setAttribute('role', 'dialog'); notes.setAttribute('aria-label', '一時停止して作業を説明');
  const heading = document.createElement('h2'), body = document.createElement('p'), detail = document.createElement('p'); detail.className = 'mind-explanation-detail';
  const picture = document.createElement('div'); picture.className = 'mind-guide-picture';
  const more = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'くわしい仕組みと数字'; more.append(summary, detail);
  const wordNote = document.createElement('aside'); wordNote.className = 'mind-word-note'; wordNote.hidden = true;
  const wordText = document.createElement('p'), wordClose = document.createElement('button'); wordClose.type = 'button'; wordClose.textContent = '説明を閉じる';
  let wordButton = null;
  wordClose.onclick = () => { wordNote.hidden = true; wordButton?.setAttribute('aria-expanded', 'false'); wordButton?.focus(); };
  wordNote.append(wordText, wordClose);
  notes.append(heading, picture, body, wordNote, more);
  const words = new RegExp(`(${Object.keys(glossary).join('|')})`, 'g');
  function showGuideBody(text) {
    if (body.textContent === text) return;
    wordNote.hidden = true; wordButton = null;
    body.replaceChildren(...text.split(words).map(part => {
      if (!Object.hasOwn(glossary, part)) return document.createTextNode(part);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'mind-word'; button.textContent = part; button.setAttribute('aria-expanded', 'false');
      button.onclick = () => { wordButton?.setAttribute('aria-expanded', 'false'); wordButton = button; button.setAttribute('aria-expanded', 'true'); wordText.textContent = glossary[part]; wordNote.hidden = false; wordNote.scrollIntoView({ block: 'nearest' }); };
      return button;
    }));
  }
  const next = document.createElement('button'); next.type = 'button'; next.className = 'mind-next'; next.textContent = 'つぎへ ▶'; next.hidden = true; notes.append(next);
  let waiting = null, skipDetails = false;
  const proceed = reason => { const done = waiting; waiting = null; next.hidden = true; notes.hidden = true; delete canvas.dataset.hold; done?.(reason); };
  next.onclick = () => proceed('next');
  document.addEventListener('click', event => { if (!toolbar.hidden && event.target.closest?.('.skip-button')) { skipDetails = true; proceed('skip'); } }, true);
  document.addEventListener('keydown', event => { if (waiting && (event.key === 'Enter' || event.key === ' ') && !event.target.closest?.('input, textarea, button, dialog')) { event.preventDefault(); proceed('next'); } });
  const cargo = document.createElement('div'); cargo.className = 'mind-cargo'; cargo.hidden = true; cargo.setAttribute('aria-label', 'いま持っているもの');
  // 右下のアイテム欄: 今持っている作業用バインダーを開く
  const items = document.createElement('div'); items.className = 'mind-items'; items.hidden = true;
  const binderButton = document.createElement('button'); binderButton.type = 'button'; binderButton.className = 'mind-item-binder';
  binderButton.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="7" y="5" width="26" height="30" rx="3" fill="#3f6677" stroke="#243d47" stroke-width="2"/><rect x="12" y="8" width="18" height="24" rx="1.5" fill="#fff5dc"/><circle cx="9.5" cy="13" r="2.2" fill="#e8e8e0"/><circle cx="9.5" cy="20" r="2.2" fill="#e8e8e0"/><circle cx="9.5" cy="27" r="2.2" fill="#e8e8e0"/><path d="M15 14h11M15 19h11M15 24h8" stroke="#8aa2a9" stroke-width="1.6"/></svg>';
  binderButton.setAttribute('aria-label', '作業用バインダーを開く');
  items.append(binderButton);
  canvas.parentElement.append(notes, cargo, items);
  let current = null; // 直近の v（アイテム欄・本棚から開くため）
  binderButton.onclick = () => { if (current) inspector.openBinder(current); };
  const updateMode = () => { explanations = level !== 'false'; explain.textContent = level === 'detail' ? '止めて説明' : '説明なし'; explain.setAttribute('aria-pressed', String(explanations)); notes.classList.toggle('detail', level === 'detail'); canvas.dataset.explain = level; };
  updateMode();
  explain.onclick = () => { level = level === 'false' ? 'detail' : 'false'; updateMode(); notes.hidden = !waiting; if (level !== 'detail') proceed('mode'); try { localStorage.setItem('kara-mind-guide', level); } catch { /* Keep the current mode in memory. */ } };
  const help = document.createElement('details'); help.className = 'mind-camera-help';
  const helpTab = document.createElement('summary'); helpTab.setAttribute('aria-label', '見まわし方を開く'); helpTab.title = '見まわし方';
  helpTab.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 8q6-3 11 0 5-3 11 0v18q-6-3-11 0-5-3-11 0Z" fill="#e9d8b3" stroke="currentColor" stroke-width="2"/><path d="M16 8v18M9 12h3m-3 5h3m8-5h3m-3 5h3" stroke="currentColor" stroke-width="1.5"/></svg>';
  const helpText = document.createElement('p'); helpText.textContent = '見まわす：ドラッグ／指1本\n場所をずらす：右ドラッグ／指2本\n近づく：ホイール／指2本で広げる\n本棚を押す：原本を開く';
  help.append(helpTab, helpText);
  toolbar.append(follow, overview, explain, layerChip, headButton, help); canvas.parentElement.append(toolbar);
  const narrow = () => lastW <= 640;
  function home() { controls.target.set(-5.5, 0, 1); camera.position.copy(controls.target).add(narrow() ? new V3(6, 62, 48) : new V3(5, 30, 33)); controls.update(); }
  const followOffset = () => narrow() ? new V3(3, 11, 12) : new V3(4.5, 8, 10.5);
  follow.onclick = follow.onpointerup = () => { following = true; followAt = performance.now(); lastViewKey = ''; follow.setAttribute('aria-pressed', 'true'); };
  overview.onclick = overview.onpointerup = () => { following = false; follow.setAttribute('aria-pressed', 'false'); home(); };
  headButton.onclick = () => { if (current) { current.head = ((current.head ?? 0) + 1) % (model.config.heads); } };
  scene.add(new THREE.HemisphereLight(0xfff5df, 0x7f9a84, 1.1));
  const sun = new THREE.DirectionalLight(0xffe6bf, 2.6); sun.position.set(-17, 26, 16); sun.target.position.set(-5.5, 0, 0); sun.castShadow = true;
  const coarse = matchMedia('(pointer: coarse)').matches;
  sun.shadow.mapSize.set(coarse ? 2048 : 4096, coarse ? 2048 : 4096); Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 26, bottom: -26, near: 1, far: 80 }); sun.shadow.normalBias = .04; sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), applySurface(new THREE.MeshStandardMaterial({ color: '#8fbb80', roughness: .95 }), 'grass', { bump: .6, repeat: 70 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.07; floor.receiveShadow = true; scene.add(floor);

  const koto = room.character.clone(true); koto.position.copy(dock({ lane: 'heard' })); koto.rotation.set(0, 0, 0); koto.scale.setScalar(1.15); scene.add(koto);
  const feet = ['footL', 'footR'].map(n => koto.getObjectByName(n)), bases = feet.map(f => f.position.clone());
  const arms = ['armL', 'armR'].map(n => koto.getObjectByName(n));
  const armBases = arms.map(a => ({ position: a.position.clone(), quaternion: a.quaternion.clone(), scale: a.scale.clone() }));

  // 部屋の建物。動かない部品は材質ごとに 1 つへまとめて、描く回数を減らす。本棚とドアと小物は別に残す
  const space = room.mindSpace.clone(true); space.updateMatrixWorld(true);
  const props = Object.fromEntries(['mind_book', 'mind_book_open', 'mind_binder', 'mind_binder_open'].map(n => [n, space.getObjectByName(n)]));
  const doors = Object.entries(ROOMS).map(([name, r]) => ({ leaf: space.getObjectByName(`${name}_door`), at: new V3(r.x - 3.7, 0, r.z + 3.06), open: 0 })).filter(d => d.leaf);
  const cases = Array.from({ length: 6 }, (_, i) => [...space.children].filter(o => o.name.startsWith(`work${i}_case`) || (i === 0 && o.name.startsWith('mind_drawer'))));
  const loose = [...Object.values(props).filter(Boolean), ...doors.map(d => d.leaf), ...cases.flat()];
  const byMaterial = new Map();
  space.traverse(o => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (loose.includes(p)) return;
    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const key of Object.keys(geometry.attributes)) if (!['position', 'normal'].includes(key)) geometry.deleteAttribute(key);
    if (!byMaterial.has(o.material)) byMaterial.set(o.material, []);
    byMaterial.get(o.material).push(geometry);
  });
  const surfaces = [[/^mind_hall/, 'tile', .35, .5, false], [/^mind_wall_hall/, 'wood', .4, .6, false], [/^mind_plank/, 'wood', .5, .45, false], [/^mind_oak/, 'wood', .4, .6, true], [/^mind_(plaster|trim|paper)/, 'plaster', .35, .5, false],
    [/^mind_rug/, 'fabric', .6, 1.6, false], [/^mind_wall/, 'plaster', .25, .7, false], [/^mind_(path|stone)/, 'sand', .5, .4, false], [/^mind_(crown|leaf)/, 'grass', .7, .9, false]];
  for (const [material, list] of byMaterial) {
    const geometry = mergeGeometries(list), surface = surfaces.find(([pattern]) => pattern.test(material.name));
    if (surface) { boxUV(geometry, surface[3], surface[4]); applySurface(material, surface[1], { bump: surface[2] }); }
    const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
    list.forEach(geometry => geometry.dispose());
  }
  for (const door of doors) { scene.add(door.leaf); door.leaf.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); }
  for (const group of cases) for (const o of group) { scene.add(o); o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); }
  // 小物の写しを使う。本の表紙は部屋ごとの色にする
  const shadowed = o => { o.traverse(m => { if (m.isMesh) { m.castShadow = true; } }); return o; };
  function propCopy(name, cover = null) {
    const copy = shadowed(props[name].clone(true)); copy.visible = false; copy.rotation.set(0, 0, 0); scene.add(copy);
    if (cover) copy.traverse(m => { if (m.isMesh && /cover/.test(m.name)) { m.material = m.material.clone(); m.material.color.set(cover); } });
    return copy;
  }
  // 各部屋の机に置く閉じた原本（④の部屋には原本がない）
  const deskBooks = Array.from({ length: 6 }, (_, i) => i === 3 ? null : propCopy('mind_book', COVERS[i]));
  const openBooks = Array.from({ length: 6 }, (_, i) => i === 3 ? null : propCopy('mind_book_open', COVERS[i]));
  const binderClosed = propCopy('mind_binder'), binderOpen = propCopy('mind_binder_open'), flyingBook = propCopy('mind_book', COVERS[0]);
  // 文字や記録は机に浮かべず、開いた本の紙面に直接描く。
  const pageSurfaces = new Map();
  function writePage(book, headings, progress = 1, values = []) {
    let page = pageSurfaces.get(book);
    if (!page) {
      const paper = document.createElement('canvas'); paper.width = 512; paper.height = 512;
      const texture = new THREE.CanvasTexture(paper); texture.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(.45, .60), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(.28, .105, 0); book.add(mesh);
      page = { paper, texture, key: '' }; pageSurfaces.set(book, page);
    }
    const text = headings.map(tokenLabel).join(' · '), count = Math.floor(clamp(progress) * 24);
    const key = `${text}|${count}|${values.slice(0, 24).join(',')}`;
    if (page.key === key) return;
    page.key = key;
    const g = page.paper.getContext('2d'); g.clearRect(0, 0, 512, 512);
    g.fillStyle = '#344b48'; g.font = 'bold 44px sans-serif';
    g.fillText(text || '…', 20, 64, 470);
    g.strokeStyle = '#6b827b'; g.lineWidth = 5;
    for (let i = 0; i < count; i++) {
      const x = 24 + (i % 4) * 118, y = 120 + Math.floor(i / 4) * 62;
      const value = values[i];
      const width = value == null ? 70 : 24 + Math.min(1, Math.abs(value)) * 66;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + width, y); g.stroke();
    }
    page.texture.needsUpdate = true;
  }
  for (let i = 0; i < 6; i++) if (deskBooks[i]) { const t = tableOf(ROOMS[`work${i}`]); deskBooks[i].position.set(t.x - .9, TOP, t.z - .4); deskBooks[i].scale.setScalar(1.6); deskBooks[i].visible = true; }
  const inspectables = [], raycaster = new THREE.Raycaster();
  const inspect = document.createElement('aside'); inspect.className = 'mind-inspection'; inspect.hidden = true; inspect.setAttribute('role', 'status');
  canvas.parentElement.append(inspect);
  let pointerAt = null, pointerDown = null, pinned = false;
  const dismissInspection = () => { pointerAt = null; pinned = false; inspect.hidden = true; };
  canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !e.buttons && !pinned) pointerAt = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerleave', () => { if (!pinned) dismissInspection(); });
  canvas.addEventListener('pointerdown', e => { pointerDown = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', e => {
    if (pointerDown && Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) < 6) {
      // 本棚か机の本を押したら原本を、バインダーを押したら作業用バインダーを開く。それ以外は値の表示
      const hit = thingAt(e.clientX, e.clientY);
      if (hit?.kind === 'book') { dismissInspection(); inspector.openBook(hit.room, typeof current?.layer === 'number' ? current.layer : 0); }
      else if (hit?.kind === 'binder') { dismissInspection(); if (current) inspector.openBinder(current); }
      else { pointerAt = { x: e.clientX, y: e.clientY }; pinned = e.pointerType !== 'mouse'; }
    } else dismissInspection();
    pointerDown = null;
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') dismissInspection(); });
  function pointerRay(x, y) {
    const box = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((x - box.left) / box.width * 2 - 1, -((y - box.top) / box.height) * 2 + 1), camera);
  }
  // 押せるもの: 各部屋の本棚と机の本（原本）、机の上と手元のバインダー
  function thingAt(x, y) {
    if (toolbar.hidden) return null;
    pointerRay(x, y);
    let best = null;
    const consider = (objects, found) => { const hit = raycaster.intersectObjects(objects.filter(o => o && o.visible), true)[0]; if (hit && (!best || hit.distance < best.distance)) best = { ...found, distance: hit.distance }; };
    cases.forEach((group, i) => consider(group, { kind: 'book', room: i }));
    for (let i = 0; i < 6; i++) consider([deskBooks[i], openBooks[i]], { kind: 'book', room: i });
    consider([binderOpen, binderClosed], { kind: 'binder' });
    return best;
  }
  function inspectable(object, title, values, note = '') {
    if (object) inspectables.push({ object, text: `${title}\n${values.map((x, j) => `${j + 1}: ${signed(x)}`).join('  ')}${note ? `\n${note}` : ''}` });
  }
  function showInspection(W, H) {
    if (!pointerAt) { inspect.hidden = true; canvas.style.cursor = ''; return; }
    pointerRay(pointerAt.x, pointerAt.y);
    const hit = raycaster.intersectObjects(inspectables.map(i => i.object), false)[0];
    const hover = hit ? inspectables.find(i => i.object === hit.object) : null;
    const thing = hover ? null : thingAt(pointerAt.x, pointerAt.y);
    canvas.style.cursor = hover || thing ? 'pointer' : '';
    if (!hover) { inspect.hidden = true; }
    else { inspect.hidden = false; if (inspect.textContent !== hover.text) inspect.textContent = hover.text; }
    if (!inspect.hidden) { const box = canvas.getBoundingClientRect(); inspect.style.left = `${Math.min(W - 20, pointerAt.x - box.left + 14)}px`; inspect.style.top = `${Math.min(H - 20, pointerAt.y - box.top + 14)}px`; }
  }

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
  let wheelRows = null, wheelShare = -1;
  function paintWheel(rows, share = 1) {
    share = Math.round(ease(share) * 60) / 60;
    if (rows === wheelRows && share === wheelShare) return;
    wheelRows = rows; wheelShare = share;
    const c = wheelCanvas.getContext('2d'); c.clearRect(0, 0, 1024, 1024);
    c.fillStyle = '#eee5c7'; c.beginPath(); c.arc(512, 512, 510, 0, Math.PI * 2); c.fill();
    let start = -Math.PI / 2;
    const colors = ['#edb96f', '#7dbbad', '#b4a5d5', '#dc947f', '#98ba77', '#81b1d2'];
    const sorted = [...rows].sort((a, b) => b.p - a.p);
    for (let i = 0; i < sorted.length; i++) {
      const row = sorted[i], end = start + row.p * share * Math.PI * 2;
      if (row.p * share < .0005) { start = end; continue; }
      c.beginPath(); c.moveTo(512, 512); c.arc(512, 512, 505, start, end); c.closePath(); c.fillStyle = colors[i % colors.length]; c.fill(); c.strokeStyle = '#f9efcf'; c.lineWidth = 3; c.stroke();
      if (row.p * share > .025) {
        const angle = (start + end) / 2;
        c.save(); c.translate(512 + Math.cos(angle) * 330, 512 + Math.sin(angle) * 330); c.rotate(angle + Math.PI / 2);
        c.fillStyle = '#263d3b'; c.font = 'bold 62px "Yu Gothic UI", sans-serif'; c.textAlign = 'center'; c.fillText(tokenLabel(row.token), 0, 0, 200);
        c.font = 'bold 36px "Yu Gothic UI", sans-serif'; c.fillText(`${(row.p * 100).toFixed(1)}%`, 0, 48); c.restore();
      }
      start = end;
    }
    wheelTexture.needsUpdate = true;
  }

  // 広間の掲示板: れんしゅうの きろく
  const boardCanvas = document.createElement('canvas'); boardCanvas.width = 1020; boardCanvas.height = 540;
  const boardTexture = new THREE.CanvasTexture(boardCanvas); boardTexture.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(5.1, 2.7), new THREE.MeshStandardMaterial({ map: boardTexture, roughness: .9 }));
  board.position.set(11, 2.3, 7.69); scene.add(board);
  let boardKey = null;
  function paintBoard(v) {
    const losses = v.losses ?? [], quiz = losses.at(-1)?.quiz, epochs = losses[0]?.epochs ?? 12, key = `${v.mode}|${losses.length}`;
    if (key === boardKey) return;
    boardKey = key;
    const c = boardCanvas.getContext('2d'); c.fillStyle = '#f1ead0'; c.fillRect(0, 0, 1020, 540);
    c.fillStyle = '#4a3a2a'; c.textAlign = 'center'; c.font = 'bold 54px "Yu Gothic UI", sans-serif'; c.fillText('れんしゅうの きろく', 510, 70);
    c.font = '30px "Yu Gothic UI", sans-serif';
    if (!losses.length) {
      c.fillStyle = '#7a6a55';
      c.fillText('ねむると、聞いた会話で', 510, 230); c.fillText(`「次の札 当て」を ${epochs}周 れんしゅうします。`, 510, 280);
      c.fillText('はずれの 大きさが ここに ならびます。', 510, 350);
    } else {
      const max = Math.max(...losses.map(h => h.loss), 1e-6);
      c.fillStyle = '#7a6a55'; c.fillText(`はずれの 大きさ（小さいほど よく当たる）  ${losses.length} / ${epochs} 周め`, 510, 120);
      for (let i = 0; i < epochs; i++) {
        const x = 80 + i * (880 / epochs);
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

  // 部屋の看板（作業中の部屋は赤い字にする）
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

  // 札。card: 文字の札、num: 数の札、board: 説明の黒い札（常設しない）、sign: 枠なし
  const itemsGroup = new THREE.Group(); scene.add(itemsGroup);
  const cache = new Map(), pool = []; let used = 0, boardCount = 0;
  function label(text, p, width = 1, color = '#fff0ce', style = width <= 1.2 ? 'card' : 'board') {
    if (style === 'board' || style === 'tag') return null;
    const key = `${text}|${color}|${style}`;
    if (!cache.has(key)) {
      const isCard = style === 'card';
      const c = document.createElement('canvas'); c.width = isCard || style === 'num' ? 128 : 512; c.height = style === 'num' ? 64 : 128; const g = c.getContext('2d');
      if (style === 'num') {
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
      cache.set(key, new THREE.SpriteMaterial({ map: texture, depthTest: style !== 'tag' }));
    }
    let sprite = pool[used]; if (!sprite) { sprite = new THREE.Sprite(); pool.push(sprite); itemsGroup.add(sprite); }
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
  const arc = (a, b, k, lift) => a.clone().lerp(b, k).setY(lerp(a.y, b.y, k) + Math.sin(k * Math.PI) * lift);
  const signed = value => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(3)}`;
  // 数の組を 1 列の棒で置く（ページ 1 枚ぶん）。まとめて現れ、1 本ずつは扱わない
  function vectorRow(values, x0, z, width, title, note = '', grow = 1, pale = false, baseY = TOP) {
    const n = values.length, gap = Math.min(.42, width / n), w = gap * .62;
    const scale = .55 / Math.max(.25, ...values.map(Math.abs));
    values.forEach((value, j) => {
      const h = .02 + Math.abs(value) * scale * grow;
      const mesh = bar(x0 + (j - (n - 1) / 2) * gap, z, h, tone(value, pale), w, Math.min(.2, w), baseY);
      inspectable(mesh, `${title} · ${j + 1}個め`, [value], note);
    });
    return { gap };
  }
  // 位置ごとの札を 1 列に並べる（文脈の札の写し）
  function tokenRow(tokens, t, z, focus = -1, weights = null, grow = 1) {
    const n = tokens.length, per = Math.min(16, n), gap = Math.min(.62, 5.6 / per);
    const points = [];
    tokens.forEach((token, j) => {
      const row = Math.floor(j / 16), p = new V3(t.x - 1.0 + ((j % 16) - (per - 1) / 2) * gap, TOP + .25, z + row * .55);
      const w = weights ? weights[j] : 0;
      if (weights) { const m = bar(p.x, p.z, .04 + w * 1.1 * grow, GOLD, gap * .55, .3); inspectable(m, `「${tokenLabel(token)}」を見る割合`, [w], `${(w * 100).toFixed(2)}%。返事として選ばれる確率とは別です。`); }
      const card = label(tokenLabel(token), p.clone().add(new V3(0, (weights ? .06 + w * 1.1 * grow : 0) + .2, 0)), Math.min(.58, gap * .95), j === focus ? '#ffd878' : '#fff0ce', 'card');
      if (card && weights) inspectable(card, `「${tokenLabel(token)}」を見る割合`, [w], `${(w * 100).toFixed(2)}%`);
      points.push(p);
    });
    return points;
  }

  // 部屋ごとの机の上。stage は記録、f は作業中の進み（終わった部屋は null）。手を伸ばす先を返す
  function drawStage(roomIndex, stage, f, v) {
    const t = tableOf(ROOMS['work' + roomIndex]), kind = stage.kind ?? 'tune';
    const k = f ? f.k : 1, go = ease(clamp((k - .15) / .7)), head = (v.head ?? 0) % Math.max(1, stage.heads?.length ?? 1);
    const point = (x, z = 0) => new V3(t.x + x, TOP, t.z + z);
    const d = model.config.dim;
    // 机の左: 開いた原本（この部屋の本）。右: 開いたバインダー
    if (f && openBooks[roomIndex]) { openBooks[roomIndex].visible = true; openBooks[roomIndex].position.set(t.x - .9, TOP + .01, t.z - .4); openBooks[roomIndex].scale.setScalar(1.6); deskBooks[roomIndex].visible = false; }
    if (f) { binderOpen.visible = true; binderOpen.position.set(t.x + .9, TOP + .01, t.z + .1); binderOpen.scale.setScalar(1.5); }
    // 数は本の中で読む。机上ではページをまとめて写す。
    if (f) {
      const headings = stage.entries?.map(e => e.token) ?? stage.tokens ?? [];
      writePage(binderOpen, headings, go, stage.after ?? stage.values ?? []);
      if (openBooks[roomIndex]) writePage(openBooks[roomIndex], roomIndex === 0 ? headings : [], v.mode === 'learn' ? go : 1);
      const original = point(roomIndex === 3 ? .9 : -.9, -.4).add(new V3(0, .12, 0));
      const working = point(.9, .1).add(new V3(0, .12, 0));
      const source = v.mode === 'learn' ? working : original;
      const destination = v.mode === 'learn' ? original : working;
      for (let i = 0; roomIndex !== 3 && i < 3; i++) {
        const phase = clamp(go * 1.5 - i * .16);
        if (phase > 0 && phase < 1) {
          const page = bar(0, 0, .018, '#fff5dc', .32, .42);
          page.position.copy(arc(source, destination, phase, .55));
          page.rotation.z = Math.sin(phase * Math.PI * 2) * .12;
        }
      }
    }
    return point(0);
  }
  let lastTravel = null, path = [], lastViewKey = '', facing = 0, doorCount = 0, blend = 1;
  let lastTime = 0, slowFrames = 0, light = false, heldClock = null, frozen = false;
  function draw(g, v, W, H, clock) {
    current = v;
    if (waiting || frozen) { heldClock ??= clock; clock = heldClock; } else heldClock = null;
    toolbar.hidden = false; controls.enabled = true;
    const now = performance.now(), dt = Math.min(.25, lastTime ? (now - lastTime) / 1000 : .016); lastTime = now;
    const toward1 = rate => 1 - Math.exp(-rate * dt);
    slowFrames = dt > .05 ? slowFrames + 1 : Math.max(0, slowFrames - 2);
    if (!light && slowFrames > 40) {
      light = true; renderer.setPixelRatio(1); renderer.setSize(W, H);
      sun.shadow.mapSize.set(1024, 1024); sun.shadow.map?.dispose(); sun.shadow.map = null;
      canvas.dataset.quality = 'light';
    }
    if (W !== lastW || H !== lastH) { renderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix(); lastW = W; lastH = H; }
    used = barUsed = beadUsed = boardCount = 0; inspectables.length = 0;
    for (const b of openBooks) if (b) b.visible = false;
    for (let i = 0; i < 6; i++) { if (deskBooks[i]) deskBooks[i].visible = false; for (const o of cases[i]) o.visible = true; }
    binderOpen.visible = false; binderClosed.visible = false; flyingBook.visible = false;
    const raw = v.courier, work = v.operation;
    const travel = raw && { k: raw.k, tokens: raw.tokens ?? (raw.token != null ? [raw.token] : []), froms: raw.froms ?? [raw.from], tos: raw.tos ?? [raw.to] };
    const count = travel?.tokens.length ?? 0, pack = count > 1 ? .3 : .2;
    const k = travel?.k ?? 1, walk = travel ? clamp((k - pack) / (1 - pack * 2)) : 1;
    const lottery = v.phase === 'pick' && v.lottery && !count ? v.lottery : null;
    wheel.visible = needle.visible = v.rows.length > 0;
    paintWheel(v.rows, v.share ?? 1); paintBoard(v);
    const turn = v.lottery ? rouletteTurn(v.lottery.k, v.lottery.r) : 0;
    needle.rotation.y = -Math.PI * 2 * turn;
    if (v.lottery) {
      canvas.dataset.roulette = v.lottery.k < 1 ? 'spinning' : 'landed';
      canvas.dataset.rouletteMatch = String(rouletteSector(v.rows, v.lottery.r)?.token === v.lottery.token);
    } else { delete canvas.dataset.roulette; delete canvas.dataset.rouletteMatch; }

    // 机の上
    const stages = v.stages ?? [];
    const activeStage = work ? stages[work.index] : null;
    let hand = null;
    // 机の上に出すのは作業中の部屋だけ。終わった机は片づけ、中身はバインダー（右下）と原本（本棚・机の本）から見る
    if (activeStage) hand = drawStage(activeStage.room, activeStage, { k: work.k }, v);
    headButton.hidden = !(activeStage && activeStage.heads && activeStage.heads.length > 1);
    if (!headButton.hidden) headButton.textContent = `ヘッド ${((v.head ?? 0) % activeStage.heads.length) + 1} / ${activeStage.heads.length}`;
    layerChip.hidden = !(activeStage && activeStage.layer != null);
    if (!layerChip.hidden) layerChip.textContent = `${activeStage.layer + 1}層め / ${model.config.layers}`;
    items.hidden = !(stages.some(Boolean) || v.carrying || count);
    binderButton.title = count ? `運んでいる札 ${count}枚` : '作業用バインダー';
    if (v.quiz && v.mode === 'learn' && !work) {
      const t = tableOf(ROOMS.work5), q = v.quiz, grow = ease(clamp(q.k ?? 1));
      q.top.forEach((c, n) => {
        const x = t.x + .65 + (n - (q.top.length - 1) / 2) * 1.15, right = c.token === q.answer, height = .05 + c.p * 1.1 * grow;
        const m = bar(x, t.z + .3, height, right ? '#8fcf7a' : '#d9cfae', .55, .36);
        inspectable(m, `「${tokenLabel(c.token)}」に付けた確率`, [c.p], right ? 'これが正解' : '');
        label(tokenLabel(c.token), new V3(x, TOP + height + .3, t.z + .3), .72, right ? '#d8f5c8' : '#fff0ce');
        label(`${Math.round(c.p * grow * 100)}%`, new V3(x, TOP + height + .72, t.z + .3), .7, right ? '#b9f0a0' : '#fff0ce', 'num');
      });
      label(`「${q.context.map(tokenLabel).join('')}」の 次は？`, new V3(t.x + .65, 1.95, t.z - .7), 1.15, '#fff0ce', 'card');
    }
    // 学習: 書き直した本を棚へ戻す
    const bookMove = v.fetching ?? v.returning;
    const bookRoom = bookMove?.room ?? activeStage?.room ?? (v.registering ? 0 : null);
    const shelf = bookRoom != null ? cases[bookRoom].find(o => o.name.includes('_case_book1_2')) : null;
    if (shelf) shelf.visible = false;
    if (bookMove && shelf) {
      const t = tableOf(ROOMS['work' + bookMove.room]);
      openBooks[bookMove.room].visible = false;
      const progress = ease(v.fetching ? bookMove.k : 1 - bookMove.k);
      flyingBook.traverse(m => { if (m.isMesh && /cover/.test(m.name)) m.material.color.set(COVERS[bookMove.room]); });
      flyingBook.visible = true; flyingBook.scale.setScalar(lerp(.5, 1.6, progress));
      flyingBook.rotation.set(0, 0, (1 - progress) * Math.PI / 2);
      flyingBook.position.copy(arc(shelf.position, new V3(t.x - .9, TOP, t.z - .4), progress, .8));
    }
    canvas.dataset.bookMotion = v.fetching ? 'fetching' : v.returning ? 'returning' : activeStage || v.registering ? 'open' : 'shelved';
    canvas.dataset.deskBooks = String(deskBooks.filter(b => b?.visible).length);
    canvas.dataset.bookDuplicate = String(!!(shelf?.visible && (flyingBook.visible || openBooks[bookRoom]?.visible)));
    for (const sign of signs) {
      const here = work ? sign.name === `work${work.room}` : lottery ? sign.name === 'roulette' : false;
      sign.mesh.material.map = sign.textures[here ? 1 : 0];
    }
    const moving = (lane, index) => count && k > 0 && travel.froms.some((a, n) => a.lane === lane && a.index === index && (lane === 'candidates' || lane === 'attention') && (count === 1 || k >= pack * n / count));
    const source = v.source ?? v.heard ?? [];
    const start = Math.floor((v.sourceAt ?? 0) / 24) * 24;
    label('ポスト', new V3(12.9, 2.5, 14.8), 1.5, '#fff0ce', 'board');
    if (v.inboxText) label(v.inboxText, new V3(12.9, 3.15, 14.8), 4.4, '#fff0ce', 'board');
    if (source.length > 24) label(`${start + 1}–${Math.min(start + 24, source.length)} / ${source.length}`, neuralPoint({ lane: 'heard', index: 5 }).add(new V3(.25, 1, -.3)), 1.6);
    // ならべる部屋の札。①へ持っていったあとも、元の札は残す（写しを運んだ）
    (v.contextCards ?? []).forEach((token, i) => {
      const p = neuralPoint({ lane: 'attention', index: i });
      const newest = v.arrange ? v.arrange.offset + v.arrange.index : (v.contextCards?.length ?? 1) - 1;
      const packed = i < Math.floor(newest / CARDS_PER_ROW) * CARDS_PER_ROW;
      const packing = v.stackPacking && i >= v.stackPacking.start && i < v.stackPacking.start + CARDS_PER_ROW ? ease(v.stackPacking.k) : packed ? 1 : 0;
      const ct = tableOf(ROOMS.context), layer = Math.floor(i / CARDS_PER_ROW);
      const pile = new V3(ct.x - 3.0 + (i % 3) * .035, 1.0 + (i % CARDS_PER_ROW) * .018 + layer * .08, ct.z - .8 + (i % 4) * .035);
      p.lerp(pile, packing);
      if (token != null) bar(p.x, p.z, .055, i % 2 ? '#e8d9b7' : '#fff0ce', .46, .32, p.y - .12);
      const learnable = v.mode === 'learn' && v.learnable ? v.learnable[i] !== false : true;
      if (token != null && (packing < 1 || (i + 1) % CARDS_PER_ROW === 0)) label(tokenLabel(token), p, lerp(.46, .4, packing), v.attentionFocus === i ? '#ffd878' : learnable ? '#fff0ce' : '#e3dccf');
      if (token != null && !packed && !v.arrange) label(String(i + 1), p.clone().add(new V3(0, -.3, .2)), .32, '#fff0ce', 'num');
    });
    if (v.contextCards?.length > CARDS_PER_ROW) label(`${v.contextCards.length}まい`, new V3(3.15, .95, 10.6), .8, '#fff0ce', 'num');
    if (v.arrange) {
      const a = v.arrange;
      a.tokens.forEach((token, j) => {
        const to = neuralPoint({ lane: 'attention', index: a.offset + j });
        bar(to.x, to.z, .025, j === a.index ? HOT : '#d2c4a0', .46, .5);
        label(String(a.offset + j + 1), to.clone().add(new V3(0, -.3, .2)), .32, '#fff0ce', 'num');
        if (j >= a.index) {
          const from = neuralPoint({ lane: 'sorting', index: 3 }).add(new V3(j * .025, j * .025, 0));
          const p = arc(from, to, ease(a.k), .65);
          label(tokenLabel(token), p, .48);
          if (j === a.index) hand = p.clone().add(new V3(-.24, 0, 0).applyQuaternion(camera.quaternion));
        }
      });
      canvas.dataset.arrange = `${a.offset + a.index}`;
    } else delete canvas.dataset.arrange;
    // 勉強: ならべる部屋の机で、となり合う札の組を数える
    if (v.studyRound) {
      const ct = tableOf(ROOMS.context), grow = ease(v.studyRound.k);
      v.studyRound.candidates.forEach((c, j) => {
        const x = ct.x - 2.6 + j * .75, z = ct.z + .3;
        label(c.a, new V3(x - .17, 1.15, z), .34); label(c.b, new V3(x + .17, 1.15, z), .34);
        const m = bar(x, z + .35, .04 + c.count * .12 * grow, j === 0 ? GOLD : '#d9cfae', .5, .2);
        inspectable(m, `「${c.a}」の次に「${c.b}」`, [c.count], `${c.count} 回ならんでいた`);
        label(`${Math.round(c.count * grow)}回`, new V3(x, 1.0 + c.count * .12 * grow, z + .35), .5, '#fff0ce', 'num');
      });
    }
    if (v.merging) {
      const ct = tableOf(ROOMS.context), m = v.merging, kk = ease(m.k);
      const center = new V3(ct.x - 2.6, 1.45, ct.z + .3);
      if (kk < 1) { label(m.parts[0], center.clone().add(new V3(-.17 * (1 - kk), .3 * kk, 0)), .34 + .2 * kk); label(m.parts[1], center.clone().add(new V3(.17 * (1 - kk), .3 * kk, 0)), .34 + .2 * kk); }
      else label(m.text, center.clone().add(new V3(0, .3, 0)), .7, '#ffd878');
    }
    // 文字の本に足した新しいページ（登録・まとまり）
    if (v.registering) {
      const t = tableOf(ROOMS.work0), book = openBooks[0];
      deskBooks[0].visible = false; book.visible = true;
      book.position.set(t.x - .9, TOP + .01, t.z - .4); book.scale.setScalar(1.6);
      writePage(book, v.registering.tokens, ease(v.registering.k));
    }
    if (v.workToken != null && !moving('work', v.workAt ?? 0)) label(tokenLabel(v.workToken), neuralPoint({ lane: 'work', index: v.workAt ?? 0 }), .9);
    if (v.lottery?.k === 1 && !(count && travel.froms[0].lane === 'roulette' && k > 0)) label(tokenLabel(v.lottery.token), neuralPoint({ lane: 'roulette' }), 1);
    (v.out ?? []).forEach((token, i) => label(tokenLabel(token), neuralPoint({ lane: 'output', index: i }), .58));
    if (v.endText) label(v.endText, neuralPoint({ lane: 'output', index: 4 }).add(new V3(.3, 1.3, -.4)), 1.2, '#fff0ce', 'card');

    // コトの移動
    let target, toward = null;
    if (v.arrange) target = dock({ lane: 'attention', index: 5 });
    else if (work) { const t = tableOf(ROOMS[`work${work.room}`]); target = new V3(t.x, 0, t.z - t.d / 2 - .85); }
    else if (travel) {
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
    void hand;
    for (const door of doors) {
      const near = koto.position.distanceTo(door.at) < 3;
      if (near && !door.near) { doorCount++; canvas.dataset.doors = String(doorCount); }
      door.near = near;
      door.open = lerp(door.open, near ? 1 : 0, toward1(near ? 12 : 3));
      door.leaf.rotation.y = -door.open * 1.75;
    }

    // 手元: 運んでいる札と、部屋から部屋へ持ち歩くバインダー
    const heldAt = koto.position.clone().add(new V3(.55, 1.05, .35));
    const heldTokens = [];
    travel?.tokens.forEach((token, n) => {
      const a = neuralPoint(travel.froms[n]), b = neuralPoint(travel.tos[n]);
      const size = travel.froms[n].lane === 'candidates' || travel.froms[n].lane === 'work' ? .8 : .55;
      const landed = { attention: .46, output: .58, candidates: .9, work: .5 }[travel.tos[n].lane] ?? .6;
      const put = clamp((k - pack * n / count) / (pack / count)), take = clamp((k - 1 + pack - pack * n / count) / (pack / count));
      if (put <= 0) return;
      const held = heldAt.clone().add(new V3((n % 4) * .12, Math.floor(n / 4) * .13, n * .025));
      if (take < 1) heldTokens.push(tokenLabel(token));
      if (put < 1) label(tokenLabel(token), arc(a, held, ease(put), .5), size);
      else if (take > 0 && take < 1) label(tokenLabel(token), arc(held, b, ease(take), .5), lerp(size, landed, take));
      else if (take >= 1 && travel.tos[n].lane !== 'work') label(tokenLabel(token), b, landed);

    });
    if (v.carrying && travel && !count && (k < pack || k > 1 - pack)) {
      binderClosed.visible = true; binderClosed.scale.setScalar(1.1);
      const endpoint = k < pack ? travel.froms[0] : travel.tos[0];
      const t = tableOf(roomOf(endpoint));
      const desk = endpoint.lane === 'box' ? neuralPoint(endpoint) : new V3(t.x + .9, TOP + .1, t.z + .1);
      const progress = ease(k < pack ? k / pack : (k - 1 + pack) / pack);
      binderClosed.position.copy(k < pack ? arc(desk, heldAt, progress, .6) : arc(heldAt, desk, progress, .6)); binderClosed.rotation.set(0, 0, 0);
    }
    const payload = heldTokens.length ? `持っている札 · ${heldTokens.length}枚\n${heldTokens.join(' ・ ')}` : v.carrying && travel && k < 1 ? (v.carrying === 'note' ? '持っているもの\nはずれの知らせ（どの数をどちらへ直すか）' : `持っているもの\n作業用バインダー（${v.binderPages ?? 0}ページ）`) : '';
    cargo.hidden = true; if (cargo.textContent !== payload) cargo.textContent = payload;
    canvas.dataset.cargo = heldTokens.join('|');
    canvas.dataset.koto = `${koto.position.x.toFixed(2)},${koto.position.z.toFixed(2)}`;
    canvas.dataset.sourceCount = String(source.length);
    canvas.dataset.contextCount = String((v.contextCards ?? []).filter(t => t != null).length);
    for (let i = used; i < pool.length; i++) pool[i].visible = false;
    canvas.dataset.boardCount = String(boardCount);
    for (let i = barUsed; i < barPool.length; i++) barPool[i].visible = false;
    for (let i = beadUsed; i < beadPool.length; i++) beadPool[i].visible = false;

    notes.hidden = !explanations || !waiting;
    if (explanations) {
      const info = explainNeural(v, model.config), guide = simpleGuide(v, info, model.config);
      if (heading.textContent !== guide.title || body.textContent !== guide.body) more.open = false;
      for (const [element, text] of [[heading, guide.title], [detail, `${info.body}\n${info.detail}`]]) if (element.textContent !== text) element.textContent = text;
      showGuideBody(guide.body);
      const art = guidePicture(guide);
      if (picture.dataset.key !== art) { picture.innerHTML = art; picture.dataset.key = art; }
    }
    canvas.dataset.view = following && lottery ? 'roulette-closeup' : following && work ? 'work-closeup' : following ? 'follow' : 'free';
    if (work) canvas.dataset.manipulating = String(Math.floor(work.k * 10)); else delete canvas.dataset.manipulating;
    if (work) canvas.dataset.hand = work.k > .15 && work.k < .85 ? 'holding' : 'ready'; else delete canvas.dataset.hand;
    const live = new Set(pool.slice(0, used).map(s => s.material));
    for (const [key, material] of cache) if (!live.has(material)) { material.map.dispose(); material.dispose(); cache.delete(key); }
    if (following) {
      let look, offset, key;
      if (v.arrange || v.studyRound || v.merging) { look = neuralPoint({ lane: 'attention', index: 5 }); offset = narrow() ? new V3(0, 6, 7) : new V3(0, 4.8, 6); key = 'arrange'; }
      else if (lottery) { look = new V3(wheelAt.x, .9, wheelAt.z); offset = new V3(.6, 5.4, 4.8).multiplyScalar(narrow() ? 1.25 : 1); key = 'roulette'; }
      else if (work || v.registering || bookMove) { const roomIndex = bookMove?.room ?? work?.room ?? 0, t = tableOf(ROOMS[`work${roomIndex}`]); look = new V3(t.x, .8, t.z - .1); offset = narrow() ? new V3(0, 10.5, 10) : new V3(0, 6.7, 6.1); key = `work-${roomIndex}`; }
      else { look = koto.position.clone().add(new V3(0, .8, 0)); offset = followOffset(); key = 'follow'; }
      if (lastViewKey === '') blend = 1; else if (key !== lastViewKey) blend = 0;
      lastViewKey = key; blend = Math.min(1, blend + dt * 1.6);
      const amount = toward1(lerp(3.5, 16, blend));
      camera.position.lerp(look.clone().add(offset), amount); controls.target.lerp(look, amount); controls.update();
    }
    showInspection(W, H);
    // 実際のクリック検証にも使う、表示中の本の画面座標。
    const shelfBook = cases[1].find(o => o.name.includes('_case_book1_2'));
    const bookPoint = new V3().setFromMatrixPosition((shelfBook ?? deskBooks[1]).matrixWorld).project(camera);
    const bounds = canvas.getBoundingClientRect();
    canvas.dataset.bookPoint = JSON.stringify({ x: bounds.left + (bookPoint.x + 1) * bounds.width / 2, y: bounds.top + (1 - bookPoint.y) * bounds.height / 2 });
    renderer.render(scene, camera); g.drawImage(renderer.domElement, 0, 0, W, H);
  }
  return {
    draw,
    cardsPerRow: CARDS_PER_ROW,
    get detail() { return level === 'detail'; },
    // 置き終えたところで止まり、読み終わって「つぎへ」が押されるのを待つ
    waitNext() { if (skipDetails) return Promise.resolve('skip'); proceed('replaced'); next.hidden = false; canvas.dataset.hold = 'waiting'; return new Promise(resolve => { waiting = resolve; }); },
    // 閲覧中は時計も止める（閉じたら元の状態から続く）
    set frozen(value) { frozen = value; },
    open(mode) { skipDetails = false; toolbar.hidden = false; controls.enabled = true; canvas.style.touchAction = 'none'; following = true; lastViewKey = ''; lastTravel = null; follow.setAttribute('aria-pressed', 'true'); koto.position.copy(dock({ lane: mode === 'study' ? 'attention' : 'entrance' })); facing = 0; },
    close() { dismissInspection(); proceed('close'); toolbar.hidden = true; notes.hidden = true; cargo.hidden = true; items.hidden = true; controls.enabled = false; canvas.style.touchAction = ''; },
  };
}
