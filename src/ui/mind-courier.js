import * as THREE from 'three';

// Blenderのコトを歩行フレームへ描画する。頭の中でも同じ姿で札を運ぶ。
export function createMindCourier(character, bag) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(180, 220); renderer.setClearColor(0, 0);
  const scene = new THREE.Scene(), koto = character.clone(true);
  koto.position.set(0, 0, 0); koto.rotation.set(0, 0, 0); koto.scale.setScalar(1);
  koto.add(bag.clone(true));
  scene.add(koto, new THREE.HemisphereLight(0xfff7e6, 0x8c9b86, 2.5));
  const light = new THREE.DirectionalLight(0xffffff, 2.5); light.position.set(-3, 5, 5); scene.add(light);
  const camera = new THREE.PerspectiveCamera(30, 180 / 220, .1, 20);
  camera.position.set(0, 1.15, 4.7); camera.lookAt(0, .85, 0);
  const feet = ['footL', 'footR'].map(n => koto.getObjectByName(n));
  const bases = feet.map(f => f.position.clone());
  const arms = ['armL', 'armR'].map(n => koto.getObjectByName(n));
  const frames = [];
  for (let i = 0; i < 16; i++) {
    const phase = i / 16 * Math.PI * 2;
    koto.position.y = Math.abs(Math.sin(phase)) * .035;
    feet.forEach((f, j) => { const a = phase + j * Math.PI; f.position.z = bases[j].z + Math.sin(a) * .12; f.position.y = bases[j].y + Math.max(0, Math.cos(a)) * .10; });
    arms.forEach((a, j) => { a.rotation.z = (j ? 1 : -1) * .6; a.rotation.x = -.5; });
    koto.getObjectByName('sprout').rotation.z = Math.sin(phase) * .1;
    renderer.render(scene, camera);
    const frame = document.createElement('canvas'); frame.width = 180; frame.height = 220;
    frame.getContext('2d').drawImage(renderer.domElement, 0, 0); frames.push(frame);
  }
  renderer.dispose();
  return (g, x, y, phase, size = 95) => {
    g.save(); g.fillStyle = '#101d3644'; g.beginPath(); g.ellipse(x, y - 4, size * .24, 7, 0, 0, Math.PI * 2); g.fill();
    g.drawImage(frames[Math.floor(phase * 16) % 16], x - size * .5, y - size * 220 / 180, size, size * 220 / 180); g.restore();
  };
}
