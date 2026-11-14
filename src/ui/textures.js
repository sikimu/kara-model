// その場で描く手ざわりの模様（木目、しっくい、織物、芝、砂）。画像ファイルは使わない。
// 模様は白に近い濃淡で描き、材質の色に掛け合わせる。同じ絵を凹凸にも使う。
import * as THREE from 'three';

function random(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

const painters = {
  // 縦に流れる木目と、ところどころの節
  wood(g, size, r) {
    g.fillStyle = '#f4f0ea'; g.fillRect(0, 0, size, size);
    for (let i = 0; i < 150; i++) {
      const x = r() * size, sway = 2 + r() * 7, shade = 150 + r() * 80;
      g.strokeStyle = `rgba(${shade}, ${shade - 22}, ${shade - 50}, ${.1 + r() * .22})`; g.lineWidth = .6 + r() * 2.4;
      g.beginPath();
      for (let y = -8; y <= size + 8; y += 8) g.lineTo(x + Math.sin(y / size * Math.PI * 2 * (1 + Math.floor(r() * 2)) + i) * sway, y);
      g.stroke();
    }
    for (let i = 0; i < 3; i++) {
      const x = r() * size, y = r() * size;
      for (let ring = 5; ring > 0; ring--) { g.strokeStyle = `rgba(140, 105, 70, ${.1 + (5 - ring) * .05})`; g.lineWidth = 1.4; g.beginPath(); g.ellipse(x, y, ring * 2.6, ring * 5, 0, 0, Math.PI * 2); g.stroke(); }
    }
  },
  // こて跡のあるしっくい
  plaster(g, size, r) {
    g.fillStyle = '#f7f5f1'; g.fillRect(0, 0, size, size);
    for (let i = 0; i < 260; i++) {
      const shade = r() > .5 ? 255 : 195;
      g.fillStyle = `rgba(${shade}, ${shade}, ${shade - 6}, ${.05 + r() * .09})`;
      g.beginPath(); g.ellipse(r() * size, r() * size, 6 + r() * 34, 3 + r() * 12, r() * Math.PI, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(150, 145, 135, ${r() * .12})`; g.fillRect(r() * size, r() * size, 1.2, 1.2); }
  },
  // たて糸とよこ糸の織り目
  fabric(g, size, r) {
    g.fillStyle = '#f1eee8'; g.fillRect(0, 0, size, size);
    const pitch = size / 64;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const over = (x + y) % 2 === 0, shade = (over ? 238 : 200) + r() * 16;
      g.fillStyle = `rgb(${shade}, ${shade}, ${shade - 4})`;
      g.fillRect(x * pitch + (over ? 0 : pitch * .12), y * pitch + (over ? pitch * .12 : 0), pitch * (over ? 1 : .76), pitch * (over ? .76 : 1));
    }
  },
  // むらのある芝と短い葉
  grass(g, size, r) {
    g.fillStyle = '#eef2e4'; g.fillRect(0, 0, size, size);
    for (let i = 0; i < 90; i++) {
      const shade = r() > .5 ? 255 : 185;
      g.fillStyle = `rgba(${shade - 20}, ${shade}, ${shade - 50}, ${.06 + r() * .1})`;
      g.beginPath(); g.arc(r() * size, r() * size, 14 + r() * 50, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 2600; i++) {
      const x = r() * size, y = r() * size, shade = 150 + r() * 105;
      g.strokeStyle = `rgba(${shade - 45}, ${shade}, ${shade - 80}, ${.25 + r() * .35})`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - .5) * 5, y - 3 - r() * 6); g.stroke();
    }
  },
  // 廊下の石のタイル（目地つき）
  tile(g, size, r) {
    g.fillStyle = '#d9d2c4'; g.fillRect(0, 0, size, size);
    const half = size / 2;
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      const shade = 236 + r() * 16;
      g.fillStyle = `rgb(${shade}, ${shade - 2}, ${shade - 8})`; g.beginPath(); g.roundRect(x * half + 5, y * half + 5, half - 10, half - 10, 10); g.fill();
      for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(160, 150, 135, ${r() * .14})`; g.fillRect(x * half + 8 + r() * (half - 16), y * half + 8 + r() * (half - 16), 1.5, 1.5); }
    }
  },
  // 小石のまじった砂の道
  sand(g, size, r) {
    g.fillStyle = '#f5f1e8'; g.fillRect(0, 0, size, size);
    for (let i = 0; i < 2600; i++) { const shade = 170 + r() * 85; g.fillStyle = `rgba(${shade}, ${shade - 8}, ${shade - 24}, ${.12 + r() * .25})`; g.fillRect(r() * size, r() * size, 1 + r() * 2.4, 1 + r() * 2.4); }
    for (let i = 0; i < 46; i++) { g.fillStyle = `rgba(175, 165, 145, ${.18 + r() * .2})`; g.beginPath(); g.ellipse(r() * size, r() * size, 3 + r() * 6, 2 + r() * 4, r() * 3, 0, Math.PI * 2); g.fill(); }
  },
};

const cache = new Map();
export function surfaceTexture(kind, repeat = 1) {
  const key = `${kind}|${repeat}`;
  if (cache.has(key)) return cache.get(key);
  const size = 512, canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  painters[kind](canvas.getContext('2d'), size, random(kind.length * 7919 + 13));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(repeat, repeat); texture.anisotropy = 8;
  cache.set(key, texture);
  return texture;
}

// 材質に模様を付ける。bump は凹凸の強さ。
export function applySurface(material, kind, { bump = .5, repeat = 1 } = {}) {
  material.map = surfaceTexture(kind, repeat);
  material.bumpMap = material.map; material.bumpScale = bump;
  material.needsUpdate = true;
  return material;
}

// 面の向きから貼り方を決める（箱型の展開）。scale は 1 単位あたりの繰り返し。turn で木目の向きを 90 度回す。
export function boxUV(geometry, scale = .5, turn = false) {
  const position = geometry.attributes.position, normal = geometry.attributes.normal, uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const ax = Math.abs(normal.getX(i)), ay = Math.abs(normal.getY(i)), az = Math.abs(normal.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = (turn ? v : u) * scale; uv[i * 2 + 1] = (turn ? u : v) * scale;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}
