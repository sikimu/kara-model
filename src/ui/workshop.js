import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { iconButton } from './icons.js';

const SLOTS = [
  ['tokenizer', 'トークンの切り方'], ['context', '文脈の持ち方'],
  ['predictor', '次のトークンの予測'], ['sampler', 'ことばの選び方'], ['learner', '学び方'],
];

export function createWorkshop(root, { model, close, changed }) {
  root.classList.add('workshop');
  root.setAttribute('aria-label', 'チップの作業台');
  const title = document.createElement('h2'); title.textContent = 'コトのチップ工房';
  const back = iconButton('home', '部屋にもどる', 'item-close');
  back.addEventListener('click', close);
  const view = document.createElement('div'); view.className = 'workshop-view';
  const tabs = document.createElement('nav'); tabs.className = 'workshop-slots'; tabs.setAttribute('aria-label', 'チップの差し込み口');
  const detail = document.createElement('section'); detail.className = 'workshop-detail';
  root.append(title, back, view, tabs, detail);
  let selected = 'sampler', scene, renderer, camera, asset, running = false;
  let boot;
  const slotButtons = SLOTS.map(([id, name]) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = name;
    button.dataset.slot = id; button.addEventListener('click', () => select(id)); tabs.append(button);
    return button;
  });
  function select(id) {
    selected = id;
    slotButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.slot === id)));
    detail.replaceChildren();
    const label = document.createElement('small'); label.textContent = SLOTS.find(s => s[0] === id)[1];
    const name = document.createElement('h3'); name.textContent = model.chips[id].name;
    const description = document.createElement('p'); description.textContent = model.chips[id].description;
    detail.append(label, name, description);
    if (['context', 'predictor', 'learner'].includes(id)) {
      const badge = document.createElement('p'); badge.className = 'chip-method';
      badge.textContent = model.chips.predictor.id === 'predictor-transformer' ? 'ニューラル言語モデル・小さなTransformer' : '実験用の集計モデル'; detail.append(badge);
      const architectures = document.createElement('div'); architectures.className = 'chip-choices';
      for (const [key, text] of [['transformer', '小さなTransformer'], ['count', '実験用：集計モデル']]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'chip-piece'; button.textContent = text; button.dataset.architecture = key;
        button.setAttribute('aria-pressed', String((model.chips.predictor.id === 'predictor-transformer') === (key === 'transformer')));
        button.addEventListener('click', () => { model.setArchitecture(key); changed(); select(id); }); architectures.append(button);
      }
      detail.append(architectures);
      const note = document.createElement('p'); note.textContent = '文脈・予測・学び方は、組み合わせて差し替える。覚えた中身は、それぞれの箱に残る。'; detail.append(note);
    }
    if (id === 'sampler') {
      const choices = document.createElement('div'); choices.className = 'chip-choices';
      for (const chip of model.samplers) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'chip-piece';
        button.dataset.chip = chip.id; button.textContent = chip.name;
        button.setAttribute('aria-pressed', String(model.chips.sampler === chip));
        button.addEventListener('click', () => { model.setSampler(chip.id); changed(); select(id); });
        choices.append(button);
      }
      detail.append(choices);
      if (model.chips.sampler.id === 'sampler-temperature') {
        const label = document.createElement('label'); label.className = 'chip-heat';
        const output = document.createElement('span'); output.textContent = `温度 ${model.options.temperature}`;
        const input = document.createElement('input'); input.type = 'range'; input.min = '.25'; input.max = '2'; input.step = '.25';
        input.value = String(model.options.temperature); input.setAttribute('aria-label', '温度');
        input.addEventListener('input', () => { model.setSampler(model.chips.sampler.id, Number(input.value)); output.textContent = `温度 ${input.value}`; changed(); });
        label.append(output, input); detail.append(label);
      }
    }
  }
  function resize() {
    if (!renderer || !view.clientWidth || !view.clientHeight) return;
    renderer.setSize(view.clientWidth, view.clientHeight);
    camera.aspect = view.clientWidth / view.clientHeight;
    const distance = Math.max(6.6, 4.2 / camera.aspect);
    camera.position.set(0, distance * .9, distance * .65);
    camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
  }
  async function prepare() {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    view.append(renderer.domElement);
    scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(40, 1, .1, 100);
    scene.add(new THREE.HemisphereLight(0xfff7de, 0x6b7057, 2.5));
    const light = new THREE.DirectionalLight(0xffefcd, 3); light.position.set(-3, 8, 4); light.castShadow = true; scene.add(light);
    light.shadow.bias = -.001; light.shadow.normalBias = .025; light.shadow.mapSize.set(2048, 2048);
    const version = document.querySelector('meta[name="app-version"]').content;
    asset = (await new GLTFLoader().loadAsync(`./assets/workshop.glb?v=${version}`)).scene;
    asset.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); scene.add(asset);
    const ray = new THREE.Raycaster();
    renderer.domElement.addEventListener('click', e => {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2), camera);
      const hit = ray.intersectObjects(SLOTS.map(([id]) => asset.getObjectByName(`chip_${id}`)), true)[0];
      let object = hit?.object;
      while (object && !SLOTS.some(([id]) => object.name === `chip_${id}`)) object = object.parent;
      if (object) select(object.name.slice(5));
    });
    new ResizeObserver(resize).observe(view); resize();
  }
  function animate() {
    renderer.setAnimationLoop(t => {
      if (!running) return;
      SLOTS.forEach(([id]) => {
        const chip = asset.getObjectByName(`chip_${id}`);
        chip.position.y = id === selected ? .48 + Math.sin(t / 700) * .035 : .18;
      });
      renderer.render(scene, camera);
    });
  }
  root.addEventListener('open', async () => {
    running = true; select(selected);
    try { await (boot ??= prepare()); if (running) { resize(); animate(); } }
    catch { view.textContent = '作業台を読み込めませんでした。もう一度お部屋から開いてください。'; boot = null; }
  });
  root.addEventListener('close', () => { running = false; renderer?.setAnimationLoop(null); });
}
