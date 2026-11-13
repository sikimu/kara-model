// 3D の部屋（空モデルの頭の中）。three.js の場面、読み込み、時間で動かす仕組み、札と黒板。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DAY = { sky: new THREE.Color(0xf4f1ea), hemi: 2.2, sun: 2.0 };
const NIGHT = { sky: new THREE.Color(0x1d2440), hemi: 0.55, sun: 0.25 };
const FONT = '"Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", sans-serif';

function roundRect(g, x, y, w, h, r) {
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

// 黒板。state を書き換えて draw() を呼ぶ
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

  // state: { title, message, rows: [{ token, count, p, fill, picked }], more,
  //          strip: [{ token, p, picked }], needle, diceText, count: { token, num, changed } }
  const board = { mesh, state: {}, draw };

  function draw() {
    const s = board.state;
    g.fillStyle = '#2c4a3c';
    g.fillRect(0, 0, CW, CH);
    g.textBaseline = 'middle';

    if (s.title) {
      g.font = `bold 50px ${FONT}`;
      g.fillStyle = '#ffe9a8';
      g.textAlign = 'left';
      g.fillText(s.title, 32, 44);
    }
    if (s.message) {
      g.font = `bold 60px ${FONT}`;
      g.fillStyle = '#e8efe9';
      g.textAlign = 'center';
      g.fillText(s.message, CW / 2, CH / 2 + 20);
    }
    if (s.rows) {
      s.rows.forEach((r, i) => {
        const y = 108 + i * 60;
        if (r.picked) {
          g.fillStyle = 'rgba(246, 197, 107, 0.35)';
          roundRect(g, 20, y - 29, CW - 40, 58, 10);
          g.fill();
        }
        g.font = `bold 50px ${FONT}`;
        g.fillStyle = '#fff';
        g.textAlign = 'center';
        g.fillText(r.token, 64, y + 2);
        g.fillStyle = 'rgba(255, 255, 255, 0.18)';
        roundRect(g, 110, y - 16, 560, 32, 16);
        g.fill();
        const w = 560 * r.p * (r.fill ?? 1);
        if (w > 1) {
          g.fillStyle = r.picked ? '#f6c56b' : '#8fc7ea';
          roundRect(g, 110, y - 16, Math.max(w, 32), 32, 16);
          g.fill();
        }
        g.font = `44px ${FONT}`;
        g.fillStyle = '#e8efe9';
        g.textAlign = 'right';
        g.fillText(`${r.count}回 ${Math.round(r.p * 100)}%`, CW - 32, y + 2);
      });
      if (s.more) {
        g.font = `36px ${FONT}`;
        g.fillStyle = '#b9cdbf';
        g.textAlign = 'right';
        g.fillText(s.more, CW - 32, 44);
      }
    }
    if (s.strip) {
      const x0 = 32;
      const w0 = CW - 64;
      const y = CH - 122;
      let x = x0;
      for (const seg of s.strip) {
        const w = w0 * seg.p;
        g.fillStyle = seg.picked ? '#f6c56b' : '#f4f1ea';
        g.fillRect(x, y, w, 56);
        g.strokeStyle = '#2c4a3c';
        g.lineWidth = 2;
        g.strokeRect(x, y, w, 56);
        if (w > 48) {
          g.font = `bold 42px ${FONT}`;
          g.fillStyle = '#333';
          g.textAlign = 'center';
          g.fillText(seg.token, x + w / 2, y + 31);
        }
        x += w;
      }
      if (s.needle != null) {
        const nx = x0 + w0 * s.needle;
        g.fillStyle = '#ff5a4d';
        g.fillRect(nx - 4, y - 12, 8, 80);
      }
      if (s.diceText) {
        g.font = `44px ${FONT}`;
        g.fillStyle = '#ffe9a8';
        g.textAlign = 'left';
        g.fillText(s.diceText, x0, CH - 32);
      }
    }
    if (s.count) {
      g.font = `bold 110px ${FONT}`;
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.fillText(s.count.token, CW / 2 - 190, CH / 2 + 30);
      if (s.count.changed) {
        g.fillStyle = 'rgba(246, 197, 107, 0.4)';
        roundRect(g, CW / 2 - 60, CH / 2 - 45, 200, 150, 20);
        g.fill();
      }
      g.fillStyle = s.count.changed ? '#f6c56b' : '#fff';
      g.fillText(String(s.count.num), CW / 2 + 40, CH / 2 + 30);
      g.font = `48px ${FONT}`;
      g.fillStyle = '#e8efe9';
      g.fillText('回', CW / 2 + 190, CH / 2 + 50);
    }
    map.needsUpdate = true;
  }

  draw();
  return board;
}

export async function createRoom(root) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  root.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = DAY.sky.clone();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const hemi = new THREE.HemisphereLight(0xffffff, 0xc9b99a, DAY.hemi);
  const sun = new THREE.DirectionalLight(0xffffff, DAY.sun);
  sun.position.set(-3, 8, 6);
  scene.add(hemi, sun);

  const loader = new GLTFLoader();
  const [roomGltf, charGltf] = await Promise.all([
    loader.loadAsync('./assets/room.glb'),
    loader.loadAsync('./assets/character.glb'),
  ]);
  scene.add(roomGltf.scene, charGltf.scene);
  scene.updateMatrixWorld(true);

  // 名前の付いた目印の位置
  const at = (name) => roomGltf.scene.getObjectByName(name).getWorldPosition(new THREE.Vector3());

  const board = createBoard(roomGltf.scene.getObjectByName('board_face'));
  scene.add(board.mesh);

  // 部屋全体が画面に収まるようにカメラを引く
  const target = new THREE.Vector3(0, 1.25, -0.2);
  const dir = new THREE.Vector3(0, 0.66, 0.75).normalize();
  function resize() {
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(3.25 / (t * camera.aspect), 4.2 / t);
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(root);
  resize();

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
    scene.background.lerpColors(DAY.sky, NIGHT.sky, k);
    hemi.intensity = THREE.MathUtils.lerp(DAY.hemi, NIGHT.hemi, k);
    sun.intensity = THREE.MathUtils.lerp(DAY.sun, NIGHT.sun, k);
  }
  function fadeNight(to, ms) {
    const from = nightNow;
    return tween(ms, (k) => setNight(THREE.MathUtils.lerp(from, to, k)));
  }

  return {
    scene,
    character: charGltf.scene,
    dice: roomGltf.scene.getObjectByName('dice'),
    board,
    at,
    tween,
    wait,
    onFrame: (fn) => frameHandlers.push(fn),
    setNight,
    fadeNight,
  };
}
