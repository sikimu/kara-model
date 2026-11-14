import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const labels = { '<bos>': 'はじまり', '<eos>': 'おしまい', '<user>': 'あなた', '<assistant>': 'コト', '<turn>': '交代', '<unk>': '？', '<speaker2>': '話者3', '<speaker3>': '話者4', '■': 'おしまい' };
export const tokenLabel = token => labels[token] ?? token;
const ease = k => k * k * (3 - 2 * k);
const clamp = k => Math.max(0, Math.min(1, k));
// World coordinates are independent of the viewport. New workstations can extend this space.
export function neuralPoint({ lane, index = 0 }) {
  if (lane === 'work') return new THREE.Vector3(-6 + (index % 3) * 6, .85, -5 - Math.floor(index / 3) * 5);
  if (lane === 'attention') return new THREE.Vector3(-3.5 + index % 8, .9, 0 - Math.floor(index / 8) * 1.1);
  if (lane === 'candidates') return new THREE.Vector3(8, .85, -4 + index * 1.3);
  if (lane === 'output') return new THREE.Vector3(4 + index % 8 * .8, .85, 5 + Math.floor(index / 8) * 1.1);
  return new THREE.Vector3(-8 + index % 8, .85, 6);
}

export function createNeuralView(room, canvas) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#243749');
  scene.fog = new THREE.Fog('#243749', 45, 100);
  const camera = new THREE.PerspectiveCamera(42, 1, .1, 160);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false; controls.minDistance = 4; controls.maxDistance = 65;
  controls.maxPolarAngle = Math.PI * .47; controls.minPolarAngle = .12;
  controls.screenSpacePanning = false;
  let following = true, lastW = 0, lastH = 0;
  controls.addEventListener('start', () => { following = false; follow.setAttribute('aria-pressed', 'false'); });
  const toolbar = document.createElement('div'); toolbar.className = 'mind-camera'; toolbar.hidden = true;
  const follow = document.createElement('button'); follow.textContent = 'コトを追う'; follow.type = 'button'; follow.setAttribute('aria-pressed', 'true');
  const overview = document.createElement('button'); overview.textContent = '見渡す'; overview.type = 'button';
  const help = document.createElement('span'); help.textContent = 'ドラッグで回転 · 右ドラッグで移動 · ホイールでズーム';
  toolbar.append(follow, overview, help); canvas.parentElement.append(toolbar);
  function home() { controls.target.set(0, 0, -2); camera.position.set(17, 23, 28); controls.update(); }
  home();
  follow.onclick = () => { following = true; follow.setAttribute('aria-pressed', 'true'); camera.position.copy(koto.position).add(new THREE.Vector3(6, 8, 10)); controls.target.copy(koto.position); previousTarget.copy(koto.position); controls.update(); };
  overview.onclick = () => { following = false; follow.setAttribute('aria-pressed', 'false'); home(); };
  scene.add(new THREE.HemisphereLight(0xfff5df, 0x607d8b, 2.6));
  const sun = new THREE.DirectionalLight(0xffedcc, 3); sun.position.set(-10, 20, 12); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22 }); sun.shadow.normalBias = .035;
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: '#435c60', roughness: .95 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.03; floor.receiveShadow = true; scene.add(floor);
  const grid = new THREE.GridHelper(120, 60, '#71908b', '#506e70'); grid.position.y = .005; scene.add(grid);
  const koto = room.character.clone(true); koto.position.set(-8, 0, 7.1); koto.rotation.set(0, 0, 0); koto.scale.setScalar(1.15); koto.add(room.courierBag.clone(true)); scene.add(koto);
  const feet = ['footL', 'footR'].map(n => koto.getObjectByName(n)), bases = feet.map(f => f.position.clone());
  const arms = ['armL', 'armR'].map(n => koto.getObjectByName(n));
  const deskSource = room.object('journal_desk');
  const desks = [];
  for (let i = 0; i < 6; i++) {
    const desk = deskSource.clone(true); desk.getObjectByName('journal')?.removeFromParent();
    const p = neuralPoint({ lane: 'work', index: i }); desk.position.set(p.x, 0, p.z); desk.scale.set(2.5, 1.25, 1.8); scene.add(desk); desks.push(desk);
  }
  const items = new THREE.Group(); scene.add(items);
  const cache = new Map(), pool = []; let used = 0;
  function label(text, p, width = 1, color = '#fff0ce') {
    const isCard = width <= 1.2, key = `${text}|${color}|${isCard}`;
    if (!cache.has(key)) {
      const c = document.createElement('canvas'); c.width = isCard ? 128 : 512; c.height = 128; const g = c.getContext('2d');
      g.fillStyle = isCard ? '#fff0ce' : '#283b43'; g.beginPath(); g.roundRect(3, 3, c.width - 6, 122, 18); g.fill();
      g.strokeStyle = color; g.lineWidth = 4; g.stroke(); g.fillStyle = isCard ? '#40533f' : color; g.font = `bold ${isCard ? 64 : 42}px "Yu Gothic UI", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(text), c.width / 2, 64, c.width - 18);
      const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
      cache.set(key, new THREE.SpriteMaterial({ map: texture, depthTest: true }));
    }
    let sprite = pool[used]; if (!sprite) { sprite = new THREE.Sprite(); pool.push(sprite); items.add(sprite); }
    used++; sprite.material = cache.get(key); sprite.visible = true; sprite.position.copy(p); sprite.scale.set(width, isCard ? width * .7 : width / 4, 1); return sprite;
  }
  const bars = [];
  for (let i = 0; i < 6 * 24; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(.11, 1, .16), new THREE.MeshStandardMaterial({ color: '#efc77f' })); bar.castShadow = true; scene.add(bar); bars.push(bar);
  }
  const lever = new THREE.Mesh(new THREE.CylinderGeometry(.065, .065, .7, 24), new THREE.MeshStandardMaterial({ color: '#efc77f', metalness: .45, roughness: .3 })); scene.add(lever);
  const packet = Array.from({ length: 24 }, () => {
    const bead = new THREE.Mesh(new THREE.SphereGeometry(.085, 12, 8), new THREE.MeshStandardMaterial({ color: '#efc77f' }));
    scene.add(bead); return bead;
  });
  let previousTarget = koto.position.clone();
  function draw(g, v, W, H, clock) {
    toolbar.hidden = false; controls.enabled = true;
    if (W !== lastW || H !== lastH) { renderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix(); lastW = W; lastH = H; }
    used = 0;
    const travel = v.courier, work = v.operation;
    const dock = a => neuralPoint(a).add(new THREE.Vector3(0, -.85, 1.15));
    const from = travel ? dock(travel.from) : koto.position.clone(), to = travel ? dock(travel.to) : from;
    const k = travel?.k ?? 1, walk = clamp((k - .2) / .6);
    if (travel) koto.position.lerpVectors(from, to, ease(walk));
    const moving = travel && k > .2 && k < .8;
    if (moving) koto.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    else koto.rotation.y = Math.PI;
    feet.forEach((f, i) => { const a = walk * Math.PI * 12 + i * Math.PI; f.position.copy(bases[i]); if (moving) { f.position.z += Math.sin(a) * .16; f.position.y += Math.max(0, Math.cos(a)) * .1; } });
    arms.forEach((a, i) => { a.rotation.x = work ? -.9 - Math.sin((work.k ?? 0) * Math.PI * 4) * .5 : moving ? Math.sin(walk * Math.PI * 12 + i * Math.PI) * .5 : -.5; });
    packet.forEach((bead, i) => {
      bead.visible = !!v.packet && i < v.packet.length && !!travel && (k < .2 || k > .8);
      if (!bead.visible) return;
      const offset = new THREE.Vector3(-1.3 + i % 12 * .23, .2, -.35 + Math.floor(i / 12) * .5);
      const bag = koto.position.clone().add(new THREE.Vector3(0, .65, -.45));
      const a = neuralPoint(travel.from).add(offset), b = neuralPoint(travel.to).add(offset);
      bead.position.copy(k < .2 ? a.lerp(bag, ease(k / .2)) : bag.lerp(b, ease((k - .8) / .2)));
      bead.material.color.set(v.packet[i] < 0 ? '#73bdd1' : '#efc77f');
    });
    const hidden = (lane, index) => travel?.token != null && travel.from.lane === lane && travel.from.index === index && k > 0;
    const source = v.source ?? v.heard ?? v.seq ?? [];
    const start = Math.max(0, (v.sourceAt ?? 0) - 7);
    label(v.mode === 'learn' ? '聞いた会話' : '届いたことば', new THREE.Vector3(-4.5, 1.8, 4.5), 3);
    source.slice(start, start + 8).forEach((token, i) => { if (!hidden('heard', i)) label(tokenLabel(token), neuralPoint({ lane: 'heard', index: i }), .95); });
    if (source.length > 8) label(`${start + 1}–${Math.min(start + 8, source.length)} / ${source.length}`, new THREE.Vector3(-4.5, .35, 7.8), 2);
    label('文脈', new THREE.Vector3(0, 2, 0), 2);
    (v.contextCards ?? []).forEach((token, i) => {
      const p = neuralPoint({ lane: 'attention', index: i });
      if (!hidden('attention', i)) label(tokenLabel(token), p, .95, v.attentionFocus === i ? '#ffd878' : '#fff0ce');
      if (v.attentionFocus === i && v.attention?.weights[i] != null) label(`${(v.attention.weights[i] * 100).toFixed(1)}%`, p.clone().add(new THREE.Vector3(0, 1, 0)), 1.6);
    });
    const stages = v.stages ?? [];
    for (let i = 0; i < 6; i++) {
      const p = neuralPoint({ lane: 'work', index: i });
      const stage = stages[i]; label(stage?.label ?? ['埋め込み・位置', 'Q・K・V', '注意の合成', '投影・残差', 'MLP・GELU', '出力'][i], p.clone().add(new THREE.Vector3(0, work?.index === i ? 2.6 : 1.2, -1)), work?.index === i ? 3.2 : 2.6, work?.index === i ? '#ffd878' : '#c9ddd9');
      const vals = stage?.values ?? [];
      for (let j = 0; j < 24; j++) {
        const bar = bars[i * 24 + j]; bar.visible = j < vals.length;
        if (!bar.visible) continue;
        const progress = work?.index === i ? work.k : 1;
        const old = stage.before?.[j] ?? 0, value = old + (vals[j] - old) * progress;
        const height = .07 + Math.min(1.1, Math.abs(value) * .55);
        bar.position.set(p.x - 1.3 + j % 12 * .23, p.y + height / 2, p.z - .35 + Math.floor(j / 12) * .5); bar.scale.y = height;
        bar.material.color.set(value < 0 ? '#73bdd1' : '#efc77f');
      }
      if (stage && i <= (v.completedStage ?? -1)) label('✓', p.clone().add(new THREE.Vector3(1.7, .2, 0)), .5);
      if (work?.index === i) { label(`${work.k < 1 ? '↻' : '✓'} ${vals.slice(0, 3).map(n => n.toFixed(2)).join('  ')}`, p.clone().add(W <= 640 ? new THREE.Vector3(0, 1.8, -1) : new THREE.Vector3(2.8, 1.1, 0)), 2.6); }
    }
    lever.visible = !!work;
    if (work) { const p = neuralPoint({ lane: 'work', index: work.index }); lever.position.copy(p).add(new THREE.Vector3(.45, .25, .75)); lever.rotation.x = Math.sin(work.k * Math.PI * 4) * .7; }
    if (v.workToken != null && !hidden('work', v.workAt ?? 0)) label(tokenLabel(v.workToken), neuralPoint({ lane: 'work', index: v.workAt ?? 0 }), 1);
    const rows = v.visibleRows ?? [];
    label('候補', new THREE.Vector3(8, 2.1, -4), 2);
    rows.forEach((r, i) => { if (!hidden('candidates', i)) label(`${tokenLabel(r.token)}  ${(r.p * 100).toFixed(1)}%`, neuralPoint({ lane: 'candidates', index: i }), 2.4, r.token === v.picked || i === v.rollIndex ? '#ffd878' : '#fff0ce'); });
    label('返事', new THREE.Vector3(6, 2, 5), 2);
    (v.out ?? []).forEach((t, i) => label(tokenLabel(t), neuralPoint({ lane: 'output', index: i }), .9));
    if (travel?.token != null) {
      const a = neuralPoint(travel.from), b = neuralPoint(travel.to), bag = koto.position.clone().add(new THREE.Vector3(0, .65, -.45));
      if (k < .2) label(tokenLabel(travel.token), a.lerp(bag, ease(k / .2)), .95 * (1 - k * 3));
      else if (k > .8) label(tokenLabel(travel.token), bag.lerp(b, ease((k - .8) / .2)), .4 + (k - .8) * 2.75);
    }
    if (v.endText) label(v.endText, new THREE.Vector3(6, 2.8, 5), 4);
    if (v.losses?.length) { const h = v.losses.at(-1); label(`練習 ${h.epoch}/12 · 損失 ${h.loss.toFixed(3)}`, new THREE.Vector3(0, 3.5, -12), 5); }
    for (let i = used; i < pool.length; i++) pool[i].visible = false;
    // Remove textures no longer used in this frame; long conversations must not grow GPU memory forever.
    const live = new Set(pool.slice(0, used).map(s => s.material));
    for (const [key, material] of cache) if (!live.has(material)) { material.map.dispose(); material.dispose(); cache.delete(key); }
    if (following) {
      const target = koto.position.clone().add(new THREE.Vector3(0, .8, -1));
      const delta = target.clone().sub(previousTarget); camera.position.add(delta); controls.target.copy(target); controls.update(); previousTarget.copy(target);
    } else previousTarget.copy(controls.target);
    renderer.render(scene, camera); g.drawImage(renderer.domElement, 0, 0, W, H);
  }
  return { draw, open() { toolbar.hidden = false; controls.enabled = true; canvas.style.touchAction = 'none'; following = true; follow.setAttribute('aria-pressed', 'true'); previousTarget.copy(koto.position); camera.position.copy(koto.position).add(new THREE.Vector3(6, 8, 10)); }, close() { toolbar.hidden = true; controls.enabled = false; canvas.style.touchAction = ''; } };
}
