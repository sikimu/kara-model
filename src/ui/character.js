// キャラクター表示（three.js）。assets/character.glb がなければ仮の図形を出す。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const GLB_URL = './assets/character.glb';

// 仮の図形: 目のついた玉
function createPlaceholder() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0xe0803a, roughness: 0.6 }),
  );
  group.add(body);
  const eyeGeo = new THREE.SphereGeometry(0.12, 16, 12);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  for (const x of [-0.32, 0.32]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(x, 0.2, 0.9);
    eye.scale.set(1, 1.5, 0.6);
    group.add(eye);
  }
  return group;
}

// 高さ 2 に収まるように大きさをそろえ、中心を原点に合わせる
function fit(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 2 / (Math.max(size.x, size.y, size.z) || 1);
  object.position.sub(center).multiplyScalar(scale);
  object.scale.multiplyScalar(scale);
  const holder = new THREE.Group();
  holder.add(object);
  return holder;
}

export function createCharacter(root) {
  root.classList.add('character');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  root.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0.2, 5);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb0a890, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(2, 4, 3);
  scene.add(sun);

  let figure = null;
  function setFigure(object, kind) {
    if (figure) scene.remove(figure);
    figure = object;
    scene.add(figure);
    root.dataset.character = kind;
  }

  new GLTFLoader().load(
    GLB_URL,
    (gltf) => setFigure(fit(gltf.scene), 'glb'),
    undefined,
    () => setFigure(createPlaceholder(), 'placeholder'),
  );

  function resize() {
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(root);
  resize();

  // ゆっくり揺れるだけの待機の動き
  renderer.setAnimationLoop((ms) => {
    if (figure) {
      const t = ms / 1000;
      figure.position.y = Math.sin(t * 2) * 0.06;
      figure.rotation.y = Math.sin(t * 0.8) * 0.35;
    }
    renderer.render(scene, camera);
  });
}
