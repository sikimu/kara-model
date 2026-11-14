// 3D の世界（家と外の広場）。three.js の場面、読み込み、時間で動かす仕組み、札と黒板。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { applySurface, boxUV } from './textures.js';

const DAY = { hemi: 0.75, sun: 2.5, lamp: 0, environment: 0.4 };
const NIGHT = { hemi: 0.16, sun: 0.16, lamp: 14, environment: 0.08 };
export const FONT = '"Yu Gothic UI", "Hiragino Sans", "Noto Sans JP", sans-serif';

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// 文字の札（いつもカメラを向く）
export function makeLabel(text, { size = 0.36, color = '#333', bg = '#fff', border = '#cfc8b8' } = {}) {
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d');
  const font = `bold 64px ${FONT}`;
  g.font = font;
  const h = 96;
  const w = Math.max(h, Math.ceil(g.measureText(text).width) + 48);
  canvas.width = w;
  canvas.height = h;
  roundRect(g, 3, 3, w - 6, h - 6, 22);
  g.fillStyle = bg;
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = border;
  g.stroke();
  g.font = font;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, toneMapped: false }));
  sprite.renderOrder = 10;
  sprite.userData.aspect = w / h;
  sprite.userData.size = size;
  sprite.scale.set(size * w / h, size, 1);
  return sprite;
}

// 家の黒板。育ち具合を書く。write(title, lines) で書き換える
function createBoard(face) {
  const CW = 1024;
  const CH = Math.round(CW * face.scale.y / face.scale.x);
  const canvas = document.createElement('canvas');
  canvas.width = CW;
  canvas.height = CH;
  const g = canvas.getContext('2d');
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(face.scale.x, face.scale.y),
    new THREE.MeshBasicMaterial({ map, toneMapped: false }),
  );
  mesh.position.copy(face.position);

  // lines: [{ label, value }]
  function write(title, lines) {
    g.fillStyle = '#2c4a3c';
    g.fillRect(0, 0, CW, CH);
    g.textBaseline = 'middle';
    g.font = `bold 58px ${FONT}`;
    g.fillStyle = '#ffe9a8';
    g.textAlign = 'left';
    g.fillText(title, 44, 62);
    g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(44, 108);
    g.lineTo(CW - 44, 108);
    g.stroke();
    lines.forEach((line, i) => {
      const y = 170 + i * 76;
      g.font = `52px ${FONT}`;
      g.fillStyle = '#e8efe9';
      g.textAlign = 'left';
      g.fillText(line.label, 60, y);
      g.font = `bold 60px ${FONT}`;
      g.fillStyle = '#fff';
      g.textAlign = 'right';
      g.fillText(line.value, CW - 60, y);
    });
    map.needsUpdate = true;
  }

  write('', []);
  return { mesh, write };
}

export async function createRoom(root) {
  // 空（昼と夜の 2 枚を重ねて、夜のほうの濃さを変える）
  const skyDay = document.createElement('div');
  skyDay.className = 'sky sky-day';
  const skyNight = document.createElement('div');
  skyNight.className = 'sky sky-night';
  root.append(skyDay, skyNight);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const compactGPU = window.matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, compactGPU ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  root.append(renderer.domElement);

  const scene = new THREE.Scene();
  // 起動時だけ生成する面光源。追加のポスト処理パスは不要。
  const studio = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(studio, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = DAY.environment;
  studio.dispose();
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const hemi = new THREE.HemisphereLight(0xe7f1ff, 0xbba184, DAY.hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, DAY.sun);
  sun.position.set(-7, 11, 8);
  sun.target.position.set(-3, 0, 0);
  sun.castShadow = true;
  const shadowSize = compactGPU ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.left = -9;
  sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -8;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 40;
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.02;
  const lamp = new THREE.PointLight(0xffc880, 0, 9, 1.6);
  scene.add(hemi, sun, sun.target, lamp);

  const loader = new GLTFLoader();
  const version = document.querySelector('meta[name="app-version"]')?.content ?? 'dev';
  const [roomGltf, charGltf, npcGltf, sleepGltf, mindGltf] = await Promise.all([
    loader.loadAsync(`./assets/room.glb?v=${version}`),
    loader.loadAsync(`./assets/character.glb?v=${version}`),
    loader.loadAsync(`./assets/npc.glb?v=${version}`),
    loader.loadAsync(`./assets/sleep-mobile.glb?v=${version}`),
    loader.loadAsync(`./assets/mind-space.glb?v=${version}`),
  ]);
  for (const gltf of [roomGltf, charGltf, npcGltf]) {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const far = /^(hill|cloud)/.test(o.name);
      o.castShadow = !far;
      o.receiveShadow = !far;
    });
  }
  // 家と広場の材質に、その場で描いた模様（木目・しっくい・織物・芝・砂）を貼る
  const surfaces = [[/^(wood|wood_dark|door_wood)$/, 'wood', 0.4, 0.5, true], [/^wall$/, 'plaster', 0.3, 0.5, false], [/^(rug|rug_edge)$/, 'fabric', 0.5, 1.6, false],
    [/^(grass|grass_dark)$/, 'grass', 0.6, 0.5, false], [/^(stone|stone_in|town_ground)$/, 'sand', 0.4, 0.5, false]];
  const textured = new Set();
  roomGltf.scene.traverse((o) => {
    const surface = o.isMesh && surfaces.find(([pattern]) => pattern.test(o.material.name));
    if (!surface) return;
    if (!o.geometry.userData.boxUV) { boxUV(o.geometry, surface[3], surface[4]); o.geometry.userData.boxUV = true; }
    if (!textured.has(o.material)) { applySurface(o.material, surface[1], { bump: surface[2] }); textured.add(o.material); }
  });
  scene.add(roomGltf.scene, charGltf.scene);
  scene.updateMatrixWorld(true);

  // 名前の付いた目印の位置
  const at = (name) => roomGltf.scene.getObjectByName(name).getWorldPosition(new THREE.Vector3());
  lamp.position.copy(at('lamp_light'));

  const board = createBoard(roomGltf.scene.getObjectByName('board_face'));
  scene.add(board.mesh);

  // カメラの構図。house: 家だけ、plaza: まちの ひろば。tall は縦長の画面（スマホ）のときの構図
  const SHOTS = {
    house: {
      wide: { target: new THREE.Vector3(0, 1.75, 0.1), halfW: 5.6, halfH: 4.0 },
      tall: { target: new THREE.Vector3(0, 1.75, 0.1), halfW: 5.15, halfH: 4.0 },
    },
    plaza: {
      wide: { target: new THREE.Vector3(-4.6, 1.3, -0.3), halfW: 5.6, halfH: 4.3 },
      tall: { target: new THREE.Vector3(-5.9, 1.3, 0), halfW: 3.9, halfH: 4.0 },
    },
  };
  let shot = 'house';
  const isTall = () => root.clientWidth < root.clientHeight * 0.8;
  const dir = new THREE.Vector3(0, 0.40, 0.92).normalize();
  const look = new THREE.Vector3();
  function resize() {
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    const { target, halfW, halfH } = SHOTS[shot][isTall() ? 'tall' : 'wide'];
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(halfW / (t * camera.aspect), halfH / t);
    // 縦に余るときは、家を少し上に寄せて、下を入力のために空ける
    const spare = dist * t - halfH;
    look.copy(target);
    look.y -= spare * 0.3;
    camera.position.copy(look).addScaledVector(dir, dist);
    camera.lookAt(look);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(root);
  resize();

  // 場面を切り替える。house: 家だけ、plaza: まちの ひろば（広場と、家の代わりのお店が見える）
  const houseRoot = roomGltf.scene.getObjectByName('house_root');
  const plazaRoot = roomGltf.scene.getObjectByName('plaza_root');
  const townRoot = roomGltf.scene.getObjectByName('town_root');
  function setScene(name) {
    const out = name === 'plaza';
    houseRoot.visible = !out;
    board.mesh.visible = !out;
    plazaRoot.visible = out;
    townRoot.visible = out;
    shot = out ? 'plaza' : 'house';
    resize();
  }

  // 場面転換の幕。幕が閉じているあいだに fn を実行する
  const curtain = document.createElement('div');
  curtain.className = 'journey-cut';
  curtain.setAttribute('aria-hidden', 'true');
  curtain.innerHTML = `<div class="journey-card">
    <div class="journey-painting"><img class="journey-art journey-art-plaza" src="./assets/journey-plaza.png?v=${version}" alt="コトがパン屋と花屋の並ぶまちへ出掛ける"><img class="journey-art journey-art-home" src="./assets/journey-home.png?v=${version}" alt="ことばのかごを抱えて、おうちへ帰るコト"></div>
    <div class="journey-route"><span class="journey-trail" aria-hidden="true"><i>●</i><i>●</i><i>●</i><i>●</i><i>●</i></span><span class="journey-to"></span></div>
  </div>`;
  root.append(curtain);
  async function transition(title, ms, fn) {
    const home = title === 'おうち';
    curtain.dataset.destination = home ? 'home' : 'plaza';
    curtain.querySelector('.journey-to').textContent = title;
    if (ms > 0) {
      curtain.setAttribute('aria-hidden', 'false');
      curtain.classList.add('is-visible');
      await wait(Math.min(ms, 250));
    }
    try {
      await fn();
      if (ms > 0) await wait(Math.min(ms, 400));
    } finally {
      curtain.classList.remove('is-visible');
      curtain.setAttribute('aria-hidden', 'true');
      if (ms > 0) await wait(200);
    }
  }

  // 3D の位置が画面のどこに見えるか（root の左上からのピクセル）
  function screenPos(v) {
    const p = v.clone().project(camera);
    return { x: (p.x + 1) / 2 * root.clientWidth, y: (1 - p.y) / 2 * root.clientHeight };
  }

  // 時間で動かす仕組み。tween(ms, fn) は fn(0..1) を毎フレーム呼び、終わると解決する
  const tweens = new Set();
  let fastForward = false;
  function setFastForward(value) {
    fastForward = value;
    if (!value) return;
    for (const tw of [...tweens]) {
      if (tw.ambient) continue;
      tweens.delete(tw);
      tw.fn(1);
      tw.resolve();
    }
  }
  const frameHandlers = [];
  function tween(ms, fn, ambient = false) {
    if (ms <= 0 || (fastForward && !ambient)) {
      fn(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => tweens.add({ start: null, ms, fn, resolve, ambient }));
  }
  const wait = (ms) => tween(ms, () => {});

  renderer.setAnimationLoop((now) => {
    for (const tw of [...tweens]) {
      if (tw.start === null) tw.start = now;
      const k = Math.min(1, (now - tw.start) / tw.ms);
      tw.fn(k);
      if (k >= 1) {
        tweens.delete(tw);
        tw.resolve();
      }
    }
    for (const fn of frameHandlers) fn(now / 1000);
    if (!root.classList.contains('mind-active')) renderer.render(scene, camera);
  });

  setScene('house');

  // 昼と夜の切り替え。k: 0 = 昼、1 = 夜
  let nightNow = 0;
  function setNight(k) {
    nightNow = k;
    skyNight.style.opacity = String(k);
    hemi.intensity = THREE.MathUtils.lerp(DAY.hemi, NIGHT.hemi, k);
    sun.intensity = THREE.MathUtils.lerp(DAY.sun, NIGHT.sun, k);
    lamp.intensity = THREE.MathUtils.lerp(DAY.lamp, NIGHT.lamp, k);
    scene.environmentIntensity = THREE.MathUtils.lerp(DAY.environment, NIGHT.environment, k);
  }
  function fadeNight(to, ms) {
    const from = nightNow;
    return tween(ms, (k) => setNight(THREE.MathUtils.lerp(from, to, k)));
  }

  return {
    scene,
    camera,
    canvas: renderer.domElement,
    object: (name) => roomGltf.scene.getObjectByName(name),
    // 縦長の画面では札の文字が小さくなるので、大きめに作る
    get textScale() { return isTall() ? 1.6 : 1; },
    character: charGltf.scene,
    mindSpace: mindGltf.scene,
    npc: npcGltf.scene, // 広場で話す人のひな形（場面には足していない）
    sleepMobile: sleepGltf.scene,
    board,
    at,
    tween,
    setFastForward,
    get fastForward() { return fastForward; },
    wait,
    onFrame: (fn) => frameHandlers.push(fn),
    setNight,
    setScene,
    transition,
    screenPos,
    fadeNight,
  };
}
