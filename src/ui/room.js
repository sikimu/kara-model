// 3D の世界（家と外の広場）。three.js の場面、読み込み、時間で動かす仕組み、札と黒板。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DAY = { hemi: 1.9, sun: 2.4, lamp: 0 };
const NIGHT = { hemi: 0.45, sun: 0.2, lamp: 14 };
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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false }));
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
    new THREE.MeshBasicMaterial({ map }),
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  root.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const hemi = new THREE.HemisphereLight(0xffffff, 0xc9b99a, DAY.hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, DAY.sun);
  sun.position.set(-7, 11, 8);
  sun.target.position.set(-3, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -9;
  sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -8;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 40;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  const lamp = new THREE.PointLight(0xffc880, 0, 9, 1.6);
  scene.add(hemi, sun, sun.target, lamp);

  const loader = new GLTFLoader();
  const [roomGltf, charGltf, npcGltf] = await Promise.all([
    loader.loadAsync('./assets/room.glb'),
    loader.loadAsync('./assets/character.glb'),
    loader.loadAsync('./assets/npc.glb'),
  ]);
  for (const gltf of [roomGltf, charGltf, npcGltf]) {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const far = /^(hill|cloud)/.test(o.name);
      o.castShadow = !far;
      o.receiveShadow = !far;
    });
  }
  scene.add(roomGltf.scene, charGltf.scene);
  scene.updateMatrixWorld(true);

  // 名前の付いた目印の位置
  const at = (name) => roomGltf.scene.getObjectByName(name).getWorldPosition(new THREE.Vector3());
  lamp.position.copy(at('lamp_light'));

  const board = createBoard(roomGltf.scene.getObjectByName('board_face'));
  scene.add(board.mesh);

  // カメラの構図。house: 家に寄る、world: 家と広場の全体
  const SHOTS = {
    house: { target: new THREE.Vector3(-1.6, 1.4, -0.1), halfW: 4.9, halfH: 4.5 },
    world: { target: new THREE.Vector3(-3.25, 1.6, -0.2), halfW: 6.8, halfH: 4.5 },
  };
  const target = SHOTS.house.target.clone();
  let halfW = SHOTS.house.halfW;
  let halfH = SHOTS.house.halfH;
  const dir = new THREE.Vector3(0, 0.66, 0.75).normalize();
  function resize() {
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(halfW / (t * camera.aspect), halfH / t);
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(root);
  resize();

  // 構図を切り替える（ms かけてなめらかに動かす）
  function setShot(name, ms) {
    const to = SHOTS[name];
    const from = { target: target.clone(), halfW, halfH };
    return tween(ms, (k) => {
      const e = k * k * (3 - 2 * k);
      target.lerpVectors(from.target, to.target, e);
      halfW = from.halfW + (to.halfW - from.halfW) * e;
      halfH = from.halfH + (to.halfH - from.halfH) * e;
      resize();
    });
  }

  // 3D の位置が画面のどこに見えるか（root の左上からのピクセル）
  function screenPos(v) {
    const p = v.clone().project(camera);
    return { x: (p.x + 1) / 2 * root.clientWidth, y: (1 - p.y) / 2 * root.clientHeight };
  }

  // 時間で動かす仕組み。tween(ms, fn) は fn(0..1) を毎フレーム呼び、終わると解決する
  const tweens = new Set();
  const frameHandlers = [];
  function tween(ms, fn) {
    if (ms <= 0) {
      fn(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => tweens.add({ start: null, ms, fn, resolve }));
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
    renderer.render(scene, camera);
  });

  // 昼と夜の切り替え。k: 0 = 昼、1 = 夜
  let nightNow = 0;
  function setNight(k) {
    nightNow = k;
    skyNight.style.opacity = String(k);
    hemi.intensity = THREE.MathUtils.lerp(DAY.hemi, NIGHT.hemi, k);
    sun.intensity = THREE.MathUtils.lerp(DAY.sun, NIGHT.sun, k);
    lamp.intensity = THREE.MathUtils.lerp(DAY.lamp, NIGHT.lamp, k);
  }
  function fadeNight(to, ms) {
    const from = nightNow;
    return tween(ms, (k) => setNight(THREE.MathUtils.lerp(from, to, k)));
  }

  return {
    scene,
    character: charGltf.scene,
    npc: npcGltf.scene, // 広場で話す人のひな形（場面には足していない）
    board,
    at,
    tween,
    wait,
    onFrame: (fn) => frameHandlers.push(fn),
    setNight,
    setShot,
    screenPos,
    fadeNight,
  };
}
