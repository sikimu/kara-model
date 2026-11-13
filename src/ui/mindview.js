// 頭の中の画面。推論と学習のあいだ、画面全体をこれに切り替える。
// 集計表の全体を「文字のつながりの地図」として描き、右側に手順・今の行・抽選・出力などを出す。
// 2D の canvas に描く（three.js の世界の上に重ねる）。

import { FONT, roundRect } from './room.js';
import { sound } from './sound.js';
import { BOS, EOS, MAX_OUTPUT, MEMORY_CAPACITY } from '../model/model.js';

const SLOTS = [
  ['tokenizer', '切り方'],
  ['context', '文脈の見方'],
  ['predictor', '予測'],
  ['sampler', '選び方'],
  ['learner', '学習'],
];
const MODE_TITLE = {
  infer: '頭の中: 返事を考えている（推論）',
  learn: '夢の中: 聞いたことをおぼえている（学習）',
  explore: '頭の中をのぞいている（文字をクリックすると、その行が見える）',
};
const END_TEXT = {
  eos: '■（おわり）が出たので、おしまい',
  empty: 'この文脈の行がからっぽ。何も言えない',
  limit: `${MAX_OUTPUT} 文字になったので、打ち切り`,
};
const GOLD = '#f6c56b';
const ease = (k) => k * k * (3 - 2 * k);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const edgeKey = (a, b) => `${a}\u0000${b}`;

export function createMindView(root, room, model) {
  const canvas = document.createElement('canvas');
  canvas.className = 'mind-view';
  root.append(canvas);
  const g = canvas.getContext('2d');
  let W = 1;
  let H = 1;
  function resize() {
    W = Math.max(1, root.clientWidth);
    H = Math.max(1, root.clientHeight);
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(resize).observe(root);
  resize();

  // ---- 文字のつながりの地図 ----
  const nodes = new Map(); // token → { token, x, y, vx, vy, out, born }
  const edges = new Map(); // edgeKey → { a, b, count }
  const stars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() }));
  let clock = 0;

  const area = () => ({ x0: 28, y0: 118, x1: W * 0.6, y1: H - 64 });

  function ensureNode(token, near) {
    let n = nodes.get(token);
    if (n) return n;
    const a = area();
    n = {
      token,
      x: near ? near.x + (Math.random() - 0.5) * 80 : a.x0 + (0.25 + Math.random() * 0.5) * (a.x1 - a.x0),
      y: near ? near.y + (Math.random() - 0.5) * 80 : a.y0 + (0.2 + Math.random() * 0.6) * (a.y1 - a.y0),
      vx: 0,
      vy: 0,
      out: 0,
      birth: 1,
    };
    nodes.set(token, n);
    return n;
  }

  function recount() {
    for (const n of nodes.values()) n.out = 0;
    for (const e of edges.values()) nodes.get(e.a).out += e.count;
  }

  // 集計表（model.store）に地図を合わせる
  function sync() {
    ensureNode(BOS);
    ensureNode(EOS);
    const seen = new Set();
    for (const [a, row] of Object.entries(model.store)) {
      for (const [b, count] of Object.entries(row)) {
        const na = ensureNode(a);
        ensureNode(b, na);
        const key = edgeKey(a, b);
        seen.add(key);
        const e = edges.get(key);
        if (e) e.count = count;
        else edges.set(key, { a, b, count });
      }
    }
    for (const key of [...edges.keys()]) if (!seen.has(key)) edges.delete(key);
    recount();
  }

  function rowOf(key) {
    const list = [...edges.values()].filter((e) => e.a === key).map((e) => ({ token: e.b, count: e.count }));
    const total = list.reduce((s, r) => s + r.count, 0);
    for (const r of list) r.p = total ? r.count / total : 0;
    return list.sort((x, y) => y.count - x.count);
  }

  function stats() {
    let total = 0;
    for (const e of edges.values()) total += e.count;
    return {
      kinds: [...nodes.keys()].filter((t) => t !== BOS && t !== EOS && (nodes.get(t).out > 0 || hasIn(t))).length,
      links: edges.size,
      total,
      sleeps: model.stats.sleeps,
    };
  }
  function hasIn(token) {
    for (const e of edges.values()) if (e.b === token) return true;
    return false;
  }

  function simulate() {
    const a = area();
    const list = [...nodes.values()];
    const cx = (a.x0 + a.x1) / 2;
    const cy = (a.y0 + a.y1) / 2;
    const ideal = clamp(Math.sqrt((a.x1 - a.x0) * (a.y1 - a.y0) / Math.max(4, list.length)) * 0.85, 55, 170);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const q = list[j];
        let dx = p.x - q.x;
        let dy = p.y - q.y;
        const d2 = Math.max(60, dx * dx + dy * dy);
        if (d2 > ideal * ideal * 6) continue;
        const f = ideal * ideal * 0.02 / d2;
        if (dx === 0 && dy === 0) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
        p.vx += dx * f; p.vy += dy * f;
        q.vx -= dx * f; q.vy -= dy * f;
      }
      p.vx += (cx - p.x) * 0.0012;
      p.vy += (cy - p.y) * 0.0018;
    }
    for (const e of edges.values()) {
      if (e.a === e.b) continue;
      const p = nodes.get(e.a);
      const q = nodes.get(e.b);
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - ideal) * 0.006 / d;
      p.vx += dx * f; p.vy += dy * f;
      q.vx -= dx * f; q.vy -= dy * f;
    }
    for (const p of list) {
      p.vx *= 0.8;
      p.vy *= 0.8;
      p.x = clamp(p.x + p.vx, a.x0 + 30, a.x1 - 30);
      p.y = clamp(p.y + p.vy, a.y0 + 30, a.y1 - 30);
    }
    // はじまりは左、おわりは右に固定する
    const bos = nodes.get(BOS);
    const eos = nodes.get(EOS);
    if (bos) { bos.x = a.x0 + 46; bos.y = cy; bos.vx = bos.vy = 0; }
    if (eos) { eos.x = a.x1 - 46; eos.y = cy; eos.vx = eos.vy = 0; }
  }

  // ---- 画面の状態 ----
  let reveal = 0;          // もわもわの進み具合（0: 閉じている、1: 全面）
  let origin = { x: 0, y: 0 };
  let v = fresh('explore');
  const avatar = { x: 0, y: 0, hop: 0, visible: false };
  let mem = [];            // 短期記憶の表示 [{ text, active }]

  function fresh(mode) {
    return {
      mode, heard: null, slot: null, rowKey: null, rows: [], fill: 1, message: '',
      strip: null, needle: null, diceText: '', picked: null, glow: null,
      out: [], endText: '', seq: null, seqAt: -1, write: null, floaters: [],
      scan: 1, drawer: 1, roll: null, flash: 0, flow: 0, pulse: 0,
      particles: [], flight: null, replayAt: -1, sad: 0,
    };
  }

  const nodeRadius = (n) => 15 + Math.min(10, Math.sqrt(n.out) * 1.6);

  // 共通の粒。イベントの進行率だけで更新し、描画頻度によらず最大 120 個。
  function burst(x, y, kind = 'spark', count = 24) {
    const colors = kind === 'confetti' ? [GOLD, '#9de5e0', '#f5a9cc', '#fff'] : [GOLD, '#fff3c4', '#a9dfff'];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, speed = 25 + Math.random() * 80;
      v.particles.push({ x, y, dx: Math.cos(a) * speed, dy: Math.sin(a) * speed,
        size: 2 + Math.random() * 4, color: colors[i % colors.length], kind, age: 0 });
    }
    v.particles = v.particles.slice(-120);
  }
  function animate(ms, fn = () => {}) {
    let prev = 0;
    return room.tween(ms, (k) => {
      for (const p of v.particles) p.age += k - prev;
      prev = k;
      v.particles = v.particles.filter((p) => p.age < 1);
      fn(k);
    });
  }
  function drawParticles() {
    g.save();
    for (const p of v.particles) {
      const k = p.age;
      g.globalAlpha = (1 - k) * 0.85;
      g.fillStyle = g.strokeStyle = p.color; g.lineWidth = 1.2;
      const x = p.x + p.dx * k, y = p.y + p.dy * k + (p.kind === 'bubble' ? -70 : 55) * k * k;
      g.beginPath();
      if (p.kind === 'confetti') {
        g.save(); g.translate(x, y); g.rotate(k * 9 + p.dx);
        g.fillRect(-p.size, -2, p.size * 2, 4); g.restore();
      } else {
        g.arc(x, y, p.size * (p.kind === 'bubble' ? 1 + k : 1 - k * 0.7), 0, Math.PI * 2);
        if (p.kind === 'bubble') g.stroke(); else g.fill();
      }
    }
    g.restore();
  }
  function outputPoint(index) {
    const u = clamp(H / 40, 14, 22), px = W * 0.62, pw = W - px - 24;
    const per = Math.max(1, Math.floor((pw - 28) / 31));
    return { x: px + 28 + index % per * 31, y: H - 18 - u * 6.2 + Math.floor(index / per) * 32 + 14 };
  }
  function drawDie(x, y, size) {
    const k = v.roll ?? 1;
    g.save();
    g.translate(x + Math.sin(k * Math.PI * 8) * size * (1 - k), y - Math.abs(Math.sin(k * Math.PI * 5)) * size * (1 - k));
    g.rotate(Math.sin(k * Math.PI * 6) * (1 - k));
    roundRect(g, -size / 2 + 3, -size / 2 + 4, size, size, 5);
    g.fillStyle = '#8b9bb9'; g.fill();
    roundRect(g, -size / 2, -size / 2, size, size, 5);
    g.fillStyle = '#fffdf5'; g.fill();
    g.strokeStyle = '#c6d4eb'; g.lineWidth = 1; g.stroke();
    // 目は装飾。実際の乱数は帯の針と数値で示す。
    const face = v.roll == null ? 5 : 1 + Math.floor(k * 23) % 6;
    const dots = { 1: [[0,0]], 2: [[-1,-1],[1,1]], 3: [[-1,-1],[0,0],[1,1]],
      4: [[-1,-1],[1,-1],[-1,1],[1,1]], 5: [[-1,-1],[1,-1],[0,0],[-1,1],[1,1]],
      6: [[-1,-1],[1,-1],[-1,0],[1,0],[-1,1],[1,1]] };
    g.fillStyle = '#374461';
    for (const [dx, dy] of dots[face]) { g.beginPath(); g.arc(dx * size * 0.25, dy * size * 0.25, size * 0.065, 0, Math.PI * 2); g.fill(); }
    g.restore();
  }

  // ---- 描く ----
  function tiles(tokens, x, y, size, maxW, hi) {
    const n = tokens.length;
    const s = clamp(Math.floor((maxW - (n - 1) * 3) / Math.max(1, n)), 12, size);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    tokens.forEach((t, i) => {
      const tx = x + i * (s + 3);
      if (tx + s > x + maxW + 1) return;
      const on = hi && hi(i);
      roundRect(g, tx, y, s, s, s * 0.22);
      g.fillStyle = on ? GOLD : 'rgba(255, 255, 255, 0.92)';
      g.fill();
      g.fillStyle = t === BOS ? '#3d9a5c' : t === EOS ? '#c0504d' : '#222';
      g.font = `bold ${Math.round(s * 0.62)}px ${FONT}`;
      g.fillText(t, tx + s / 2, y + s / 2 + 1);
    });
    return s;
  }

  function card(x, y, w, h, title, u) {
    roundRect(g, x, y, w, h, 14);
    g.fillStyle = 'rgba(12, 16, 40, 0.62)';
    g.fill();
    g.strokeStyle = 'rgba(160, 180, 255, 0.35)';
    g.lineWidth = 1;
    g.stroke();
    g.font = `bold ${u * 0.95}px ${FONT}`;
    g.fillStyle = '#aebcf0';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(title, x + 14, y + u * 1.1);
  }

  function edgeGeom(e) {
    const p = nodes.get(e.a);
    const q = nodes.get(e.b);
    if (e.a === e.b) return { loop: true, cx: p.x, cy: p.y - nodeRadius(p) - 11, mx: p.x, my: p.y - nodeRadius(p) - 26 };
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const bend = Math.min(26, d * 0.18);
    const cx = (p.x + q.x) / 2 - dy / d * bend;
    const cy = (p.y + q.y) / 2 + dx / d * bend;
    return { p, q, cx, cy, mx: 0.25 * p.x + 0.5 * cx + 0.25 * q.x, my: 0.25 * p.y + 0.5 * cy + 0.25 * q.y };
  }

  function drawEdge(e, maxCount) {
    const geo = edgeGeom(e);
    const from = e.a === v.rowKey && (v.scan >= 1 || v.rows.findIndex((r) => r.token === e.b) < v.scan * v.rows.length);
    const glow = v.glow === edgeKey(e.a, e.b);
    const w = 1 + Math.min(5, Math.log2(e.count + 1));
    g.lineWidth = glow ? w + 3 + Math.sin(v.pulse * Math.PI) * 5 : from ? w + 1 : w;
    g.save();
    if (glow) { g.shadowColor = GOLD; g.shadowBlur = 12; }
    const growth = e.growth ?? 1;
    g.strokeStyle = glow ? '#fff3c4'
      : from ? 'rgba(246, 197, 107, 0.95)'
        : `rgba(150, 172, 255, ${0.16 + 0.5 * e.count / maxCount})`;
    g.fillStyle = g.strokeStyle;
    g.beginPath();
    if (geo.loop) {
      g.arc(geo.cx, geo.cy, 13, 0, Math.PI * 2 * growth);
      g.stroke();
      if (glow) {
        const a = v.flow * Math.PI * 2;
        g.beginPath(); g.arc(geo.cx + Math.cos(a) * 13, geo.cy + Math.sin(a) * 13, 3, 0, Math.PI * 2);
        g.fillStyle = '#fff'; g.fill();
      }
      g.restore();
      return geo;
    }
    const rq = nodeRadius(geo.q) + 3;
    const ax = geo.q.x - geo.cx;
    const ay = geo.q.y - geo.cy;
    const ad = Math.hypot(ax, ay) || 1;
    const ex = geo.q.x - ax / ad * rq;
    const ey = geo.q.y - ay / ad * rq;
    g.moveTo(geo.p.x, geo.p.y);
    const t = growth, z = 1 - t;
    g.quadraticCurveTo(geo.p.x + (geo.cx - geo.p.x) * t, geo.p.y + (geo.cy - geo.p.y) * t,
      z*z*geo.p.x + 2*z*t*geo.cx + t*t*ex, z*z*geo.p.y + 2*z*t*geo.cy + t*t*ey);
    g.stroke();
    if (glow) {
      for (let i = 0; i < 5; i++) {
        const t = (v.flow + i / 5) % 1, z = 1 - t;
        g.beginPath(); g.arc(z*z*geo.p.x + 2*z*t*geo.cx + t*t*ex,
          z*z*geo.p.y + 2*z*t*geo.cy + t*t*ey, 2 + i * 0.4, 0, Math.PI * 2);
        g.fillStyle = '#fff'; g.fill();
      }
    }
    g.restore();
    if (growth < 1) return geo;
    g.fillStyle = glow ? '#fff3c4' : from ? GOLD : 'rgba(150, 172, 255, 0.6)';
    const s = 5 + g.lineWidth;
    g.beginPath();
    g.moveTo(ex, ey);
    g.lineTo(ex - ax / ad * s - ay / ad * s * 0.6, ey - ay / ad * s + ax / ad * s * 0.6);
    g.lineTo(ex - ax / ad * s + ay / ad * s * 0.6, ey - ay / ad * s - ax / ad * s * 0.6);
    g.closePath();
    g.fill();
    return geo;
  }

  function drawAvatar() {
    const x = avatar.x;
    const y = avatar.y - 30 - avatar.hop + v.sad * 8;
    g.fillStyle = 'rgba(0, 0, 0, 0.25)';
    g.beginPath();
    g.ellipse(avatar.x, avatar.y - 14, 12, 4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fdfbf3';
    g.strokeStyle = '#8c93b8';
    g.lineWidth = 1.5;
    for (const sx of [-10, 10]) { // 耳
      g.beginPath();
      g.arc(x + sx, y - 12, 5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.beginPath();
    g.arc(x, y, 15, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#23213a';
    const blink = (clock % 3.2) < 0.12 ? 0.2 : 1;
    for (const sx of [-5.5, 5.5]) {
      g.beginPath();
      g.ellipse(x + sx, y + 1, 2.4, 3.4 * blink * (1 - v.sad * 0.7), sx < 0 ? -v.sad * 0.4 : v.sad * 0.4, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = '#7fbf5a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y - 15);
    g.lineTo(x, y - 22);
    g.stroke();
    g.fillStyle = '#9ad86a';
    g.beginPath();
    g.ellipse(x - 4, y - 23, 5, 2.5, -0.5, 0, Math.PI * 2);
    g.ellipse(x + 4, y - 23, 5, 2.5, 0.5, 0, Math.PI * 2);
    g.fill();
  }

  function drawScene() {
    const u = clamp(H / 40, 14, 22); // 文字の基準の大きさ
    const learn = v.mode === 'learn';
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, learn ? '#1b1436' : '#141b3d');
    bg.addColorStop(1, learn ? '#43306e' : '#2b3577');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    for (const s of stars) {
      g.fillStyle = `rgba(255, 255, 255, ${0.15 + 0.35 * Math.abs(Math.sin(clock * (0.4 + s.s) + s.s * 9))})`;
      g.fillRect(s.x * W, s.y * H, 1.5 + s.s, 1.5 + s.s);
    }

    // 流れ星は文字とカードを避け、地図の背景に流す。
    const meteor = clock % 9;
    if (meteor < 1.2) {
      const x = W * (0.12 + meteor * 0.25), y = 135 + meteor * 85;
      g.save(); g.globalAlpha = Math.sin(meteor / 1.2 * Math.PI) * 0.55;
      const tail = g.createLinearGradient(x - 90, y - 30, x, y);
      tail.addColorStop(0, 'transparent'); tail.addColorStop(1, '#c8ebff');
      g.strokeStyle = tail; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 90, y - 30); g.lineTo(x, y); g.stroke(); g.restore();
    }

    // 上: 題と、聞いた言葉 / 思い出している文
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = `bold ${u * 1.2}px ${FONT}`;
    g.fillStyle = '#fff';
    g.fillText(MODE_TITLE[v.mode], 28, 30);
    const line = learn ? v.seq : v.heard;
    if (line) {
      g.font = `${u * 0.9}px ${FONT}`;
      g.fillStyle = '#aebcf0';
      const label = learn ? '思い出している文' : '聞いた言葉';
      g.fillText(label, 28, 78);
      const lx = 28 + g.measureText(label).width + 14;
      tiles(line, lx, 60, 36, W * 0.6 - lx, learn ? (i) => i === v.replayAt || i === v.seqAt || i === v.seqAt + 1 : null);
      if (!learn) {
        g.font = `${u * 0.8}px ${FONT}`;
        g.fillStyle = '#8f9bd0';
        g.textAlign = 'left';
        g.fillText('※ 今の空モデルは、聞いた言葉の中身を返事に使えない（直前の 1 文字しか見ない）', 28, 108);
      }
    }

    // 地図
    let maxCount = 1;
    for (const e of edges.values()) maxCount = Math.max(maxCount, e.count);
    const labels = [];
    for (const e of edges.values()) {
      const geo = drawEdge(e, maxCount);
      if (e.a === v.rowKey) labels.push({ e, geo });
    }
    labels.sort((x, y) => y.e.count - x.e.count);
    const rowTotal = labels.reduce((s, l) => s + l.e.count, 0);
    g.font = `bold ${u * 0.8}px ${FONT}`;
    g.textAlign = 'center';
    for (const { e, geo } of labels.slice(0, 7)) {
      const text = learn ? `${e.count}回` : `${rowTotal ? Math.round(e.count / rowTotal * 100) : 0}%`;
      const tw = g.measureText(text).width + 10;
      roundRect(g, geo.mx - tw / 2, geo.my - u * 0.6, tw, u * 1.2, 6);
      g.fillStyle = 'rgba(20, 24, 50, 0.85)';
      g.fill();
      g.fillStyle = GOLD;
      g.fillText(text, geo.mx, geo.my + 1);
    }
    for (const n of nodes.values()) {
      const pop = n.birth;
      const r = nodeRadius(n) * (pop < 1 ? ease(pop) * 1.15 : 1);
      g.save();
      g.shadowColor = n.token === v.rowKey ? GOLD : '#93a4e6';
      g.shadowBlur = n.token === v.rowKey ? 20 + 10 * v.scan : 4 + 3 * Math.sin(clock * 1.5 + n.x);
      if (pop < 1) { g.strokeStyle = GOLD; g.lineWidth = 2; g.beginPath(); g.arc(n.x, n.y, r + 20 * (1 - pop), 0, Math.PI * 2); g.stroke(); }
      const special = n.token === BOS ? '#3d9a5c' : n.token === EOS ? '#c0504d' : null;
      g.beginPath();
      g.arc(n.x, n.y, r, 0, Math.PI * 2);
      g.fillStyle = special ?? (n.token === v.rowKey ? '#5a4a1c' : '#263060');
      g.fill();
      g.lineWidth = n.token === v.rowKey ? 4 : 1.5;
      g.strokeStyle = n.token === v.rowKey ? GOLD : '#93a4e6';
      g.stroke();
      g.restore();
      g.fillStyle = '#fff';
      g.font = `bold ${Math.round(nodeRadius(n) * 1.05)}px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(n.token, n.x, n.y + 1);
      if (special) {
        g.font = `${u * 0.75}px ${FONT}`;
        g.fillStyle = '#cfd8ff';
        g.fillText(n.token === BOS ? 'はじまり' : 'おわり', n.x, n.y + r + u * 0.8);
      }
    }
    if (nodes.size <= 2 && edges.size === 0) {
      const a = area();
      g.font = `${u * 1.1}px ${FONT}`;
      g.fillStyle = '#aebcf0';
      g.textAlign = 'center';
      g.fillText('まだ何もおぼえていない（まっさら）', (a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2 - 60);
    }
    if (avatar.visible) drawAvatar();
    for (const f of v.floaters) {
      const k = v.pulse;
      g.font = `bold ${u * (1.5 + 1.3 * (1 - ease(Math.min(1, k * 3))))}px ${FONT}`;
      g.fillStyle = `rgba(255, 233, 150, ${1 - k})`;
      g.textAlign = 'center';
      g.fillText(f.text, f.x, f.y - k * 40);
    }

    // 下: 育ち具合
    const st = stats();
    g.font = `${u * 0.9}px ${FONT}`;
    g.fillStyle = '#cfd8ff';
    g.textAlign = 'left';
    g.fillText(`おぼえた文字 ${st.kinds} 種類　・　つながり ${st.links} 本　・　数えた回数 ${st.total} 回　・　眠った回数 ${st.sleeps} 回`, 28, H - 30);

    // 右: 手順、今の行、抽選 / 書き換え、出力 / 短期記憶
    const px = W * 0.62;
    const pw = W - px - 24;
    const gap = 12;
    let y = 18;

    const h1 = u * 7;
    card(px, y, pw, h1, 'いまの手順', u);
    const bw = (pw - 28 - 4 * 6) / 5;
    SLOTS.forEach(([id, name], i) => {
      const bx = px + 14 + i * (bw + 6);
      const on = v.slot === id;
      roundRect(g, bx, y + u * 2, bw, u * 1.9, 8);
      g.fillStyle = on ? GOLD : 'rgba(255, 255, 255, 0.1)';
      g.fill();
      g.font = `${on ? 'bold ' : ''}${u * 0.78}px ${FONT}`;
      g.fillStyle = on ? '#222' : '#cfd8ff';
      g.textAlign = 'center';
      g.fillText(name, bx + bw / 2, y + u * 2.95);
    });
    g.textAlign = 'left';
    const chip = v.slot ? model.chips[v.slot] : null;
    g.font = `bold ${u * 0.95}px ${FONT}`;
    g.fillStyle = '#fff';
    g.fillText(chip ? `チップ「${chip.name}」` : '—', px + 14, y + u * 4.9);
    g.font = `${u * 0.82}px ${FONT}`;
    g.fillStyle = '#aebcf0';
    g.fillText(chip ? chip.description : '', px + 14, y + u * 6.1);
    y += h1 + gap;

    const h3 = u * 6.4;
    const h4 = u * 8.2;
    const h2 = H - y - h3 - h4 - gap * 2 - 18;
    card(px, y, pw, h2, v.rowKey ? `「${v.rowKey}」の次に来る文字（集計表の 1 行）` : '集計表の 1 行', u);
    const rowH = u * 1.75;
    const maxRows = Math.max(1, Math.floor((h2 - u * 2.6) / rowH) - 1);
    if (v.message) {
      g.font = `bold ${u * 1.2}px ${FONT}`;
      g.fillStyle = '#e8efe9';
      g.textAlign = 'center';
      g.fillText(v.message, px + pw / 2, y + h2 / 2);
    }
    let shown = v.rows.slice(0, maxRows);
    if (v.picked && !shown.some((r) => r.token === v.picked)) {
      const hit = v.rows.find((r) => r.token === v.picked);
      if (hit) shown = [...shown.slice(0, maxRows - 1), hit];
    }
    shown.forEach((r, i) => {
      const entry = clamp(v.drawer * 1.6 - i / Math.max(1, shown.length) * 0.6, 0, 1);
      const bar = ease(clamp(v.fill * 1.7 - i / Math.max(1, shown.length) * 0.7, 0, 1));
      const ry = y + u * 2.7 + i * rowH - (1 - ease(entry)) * rowH * 0.7;
      g.save(); g.globalAlpha = entry;
      const on = r.token === v.picked;
      if (on) {
        roundRect(g, px + 8, ry - rowH / 2 + 2, pw - 16, rowH - 4, 8);
        g.fillStyle = 'rgba(246, 197, 107, 0.28)';
        g.fill();
      }
      g.font = `bold ${u * 1.1}px ${FONT}`;
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.fillText(r.token, px + 30, ry + 1);
      const bx = px + 54;
      const bwid = pw - 54 - u * 7.2;
      roundRect(g, bx, ry - 6, bwid, 12, 6);
      g.fillStyle = 'rgba(255, 255, 255, 0.14)';
      g.fill();
      const fw = bwid * r.p * bar;
      if (fw > 1) {
        roundRect(g, bx, ry - 6, fw, 12, Math.min(6, fw / 2));
        g.fillStyle = on ? GOLD : '#8fc7ea';
        g.fill();
      }
      g.font = `${u * 0.9}px ${FONT}`;
      g.fillStyle = '#e8efe9';
      g.textAlign = 'right';
      // 数値は真値を保ち、現れ方だけバーに合わせる。
      g.fillText(`${r.count}回`, px + pw - 14 - u * 3.8, ry + 1);
      g.globalAlpha *= clamp((bar - 0.85) / 0.15, 0, 1);
      g.fillText(`${(r.p * 100).toFixed(r.p < 0.1 ? 1 : 0)}%`, px + pw - 14, ry + 1);
      g.restore();
    });
    if (v.rows.length > shown.length) {
      g.font = `${u * 0.8}px ${FONT}`;
      g.fillStyle = '#8f9bd0';
      g.textAlign = 'right';
      g.fillText(`ほか ${v.rows.length - shown.length} 文字（全部で ${v.rows.length} 文字）`, px + pw - 14, y + h2 - u * 0.9);
    }
    y += h2 + gap;

    if (learn) {
      card(px, y, pw, h3, '書き換え（数えて +1）', u);
      if (v.write) {
        g.font = `bold ${u * 1.5}px ${FONT}`;
        g.fillStyle = '#fff';
        g.textAlign = 'left';
        g.fillText(`「${v.write.key}」→「${v.write.token}」`, px + 18, y + u * 3.9);
        g.textAlign = 'right';
        g.fillStyle = v.write.done ? GOLD : '#fff';
        g.fillText(v.write.done ? `${v.write.before} → ${v.write.after} 回` : `${v.write.before} 回`, px + pw - 18, y + u * 3.9);
      }
    } else {
      card(px, y, pw, h3, '抽選（回数に比例した幅の帯に、サイコロの針を落とす）', u);
      if (v.strip) {
        const sx = px + 14;
        const sw = pw - 28;
        const sy = y + u * 2.1;
        const sh = u * 1.9;
        let x = sx;
        for (const seg of v.strip) {
          const w = sw * seg.p;
          g.save();
          if (seg.token === v.picked) { g.shadowColor = GOLD; g.shadowBlur = 24 * v.flash; }
          g.fillStyle = seg.token === v.picked ? GOLD : '#f4f1ea';
          g.fillRect(x, sy, w, sh);
          g.strokeStyle = '#2b3577';
          g.lineWidth = 1;
          g.strokeRect(x, sy, w, sh);
          if (w > u * 1.2) {
            g.font = `bold ${u}px ${FONT}`;
            g.fillStyle = '#222';
            g.textAlign = 'center';
            g.fillText(seg.token, x + w / 2, sy + sh / 2 + 1);
          }
          g.restore();
          x += w;
        }
        if (v.needle != null) {
          g.fillStyle = '#ff5a4d';
          g.fillRect(sx + sw * v.needle - 2, sy - 6, 4, sh + 12);
        }
        g.font = `${u * 0.95}px ${FONT}`;
        g.fillStyle = '#ffe9a8';
        g.textAlign = 'left';
        g.fillText(v.diceText, sx, y + u * 5.3);
        drawDie(sx + sw - u, y + u * 5.15, u * 1.35);
      }
    }
    y += h3 + gap;

    if (v.mode === 'infer') {
      card(px, y, pw, h4, `口から出る言葉（${v.out.length} / ${MAX_OUTPUT} 文字）`, u);
      const per = Math.max(1, Math.floor((pw - 28) / 31));
      for (let i = 0; i * per < Math.max(1, v.out.length); i++) {
        tiles(v.out.slice(i * per, (i + 1) * per), px + 14, y + u * 2 + i * 32, 28, pw - 28);
      }
      g.font = `${u * 0.9}px ${FONT}`;
      g.fillStyle = '#ffe9a8';
      g.textAlign = 'left';
      g.fillText(v.endText, px + 14, y + h4 - u * 1.1);
    } else {
      card(px, y, pw, h4, `短期記憶（${mem.length} / ${MEMORY_CAPACITY} 文）`, u);
      mem.forEach((m, i) => {
        const my = y + u * 2.5 + i * u * 1.15;
        g.save(); g.globalAlpha = 1 - (m.fade ?? 0);
        g.font = `${m.active ? 'bold ' : ''}${u * 0.9}px ${FONT}`;
        g.fillStyle = m.active ? GOLD : '#e8efe9';
        g.textAlign = 'left';
        g.fillText(`${m.active ? '▶ ' : '・ '}${m.text}`, px + 16, my);
        g.restore();
      });
      if (mem.length === 0) {
        g.font = `${u * 0.9}px ${FONT}`;
        g.fillStyle = '#8f9bd0';
        g.textAlign = 'left';
        g.fillText('（からっぽ）', px + 16, y + u * 2.5);
      }
    }
  }

  // もわもわ（考えごとの雲）の形。小さな泡が 3 つ出てから、大きな雲が画面いっぱいに広がる
  function cloudPath(cx, cy, r) {
    g.beginPath();
    g.moveTo(cx + r * 0.75, cy);
    g.arc(cx, cy, r * 0.75, 0, Math.PI * 2);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2 + clock * 0.4;
      const br = r * (0.3 + 0.05 * Math.sin(clock * 3 + i * 1.7));
      const bx = cx + Math.cos(a) * r * 0.72;
      const by = cy + Math.sin(a) * r * 0.72;
      g.moveTo(bx + br, by);
      g.arc(bx, by, br, 0, Math.PI * 2);
    }
  }

  function draw(t) {
    // 背景の時刻も room.tween で進める。
    g.clearRect(0, 0, W, H);
    if (reveal <= 0) return;
    simulate();
    drawScene();
    drawParticles();
    if (v.flight) {
      const f = v.flight, start = nodes.get(f.token), end = outputPoint(v.out.length);
      const point = (t) => ({ x: start.x + (end.x - start.x) * ease(t), y: start.y + (end.y - start.y) * ease(t) - Math.sin(t * Math.PI) * H * 0.2 });
      g.save();
      for (let i = 7; i >= 0; i--) {
        const p = point(Math.max(0, f.k - i * 0.025));
        g.globalAlpha = i === 0 ? 1 : (1 - i / 8) * 0.2;
        g.shadowColor = GOLD; g.shadowBlur = 12;
        tiles([f.token], p.x - 14, p.y - 14, 28, 28);
      }
      g.restore();
    }
    if (reveal >= 1) return;

    const side = origin.x > W / 2 ? -1 : 1;
    const cx = clamp(origin.x + side * 90, 80, W - 80);
    const cy = clamp(origin.y - 170, 80, H - 80);
    const far = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy));
    const k = clamp((reveal - 0.42) / 0.58, 0, 1);
    const r = k <= 0 ? 0 : 46 + k * k * far * 1.45;
    g.globalCompositeOperation = 'destination-in';
    if (r > 0) {
      cloudPath(cx, cy, r);
      g.fill();
    } else {
      g.clearRect(0, 0, W, H);
    }
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = '#fff';
    if (r > 0) {
      cloudPath(cx, cy, r + 7);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    // 頭から雲へ続く小さな泡
    [[0.04, 26, 30, 8], [0.16, 50, 66, 13], [0.28, 74, 112, 19]].forEach(([at, dx, dy, size], i) => {
      const bk = clamp((reveal - at) / 0.12, 0, 1) * (1 - clamp((reveal - 0.7) / 0.2, 0, 1));
      if (bk <= 0) return;
      g.beginPath();
      g.arc(origin.x + side * dx, origin.y - dy + Math.sin(clock * 4 + i) * 2, size * ease(bk), 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
      g.strokeStyle = '#c9cfe6';
      g.lineWidth = 2;
      g.stroke();
    });
  }
  room.onFrame(draw);

  // ---- 開く、閉じる ----
  // mode: 'infer' | 'learn' | 'explore'。from は雲が出てくる場所（画面上の位置）
  // memory は短期記憶として見せる文（省略時は今のモデルの短期記憶）
  let ambientRun = 0;
  let ambientStep = 300;
  async function breathe(run) {
    while (run === ambientRun && reveal > 0) {
      const start = clock;
      await room.tween(ambientStep * 4, (k) => { if (run === ambientRun) clock = start + k; });
    }
  }
  async function open(mode, from, ms, memory = model.shortMemory) {
    v = fresh(mode);
    avatar.visible = false;
    avatar.hop = 0;
    origin = from ?? { x: W / 2, y: H / 2 };
    mem = memory.map((text) => ({ text, active: false }));
    canvas.style.pointerEvents = 'auto';
    sfx('moya', ms);
    await room.tween(ms, (k) => { reveal = k; });
    reveal = 1;
    void breathe(++ambientRun);
  }

  async function close(ms) {
    ambientRun++;
    await room.tween(ms, (k) => { reveal = 1 - k; });
    reveal = 0;
    canvas.style.pointerEvents = 'none';
  }

  // のぞいているとき: 文字をクリックすると、その行を出す
  canvas.addEventListener('click', (ev) => {
    if (v.mode !== 'explore' || reveal < 1) return;
    const box = canvas.getBoundingClientRect();
    const x = ev.clientX - box.left;
    const y = ev.clientY - box.top;
    for (const n of nodes.values()) {
      if (Math.hypot(n.x - x, n.y - y) <= nodeRadius(n) + 6) {
        v.rowKey = n.token;
        v.rows = rowOf(n.token);
        v.message = v.rows.length === 0 ? '（この文字の次は、まだ何もおぼえていない）' : '';
        v.slot = 'predictor';
        sfx('pop', ambientStep);
        return;
      }
    }
  });

  function placeAvatar(token) {
    const n = ensureNode(token);
    avatar.x = n.x;
    avatar.y = n.y;
    avatar.visible = true;
  }
  async function travel(a, b, ms) {
    const p = ensureNode(a);
    const q = ensureNode(b);
    await room.tween(ms * 0.8, (k) => {
      const e = ease(k);
      avatar.x = p.x + (q.x - p.x) * e;
      avatar.y = p.y + (q.y - p.y) * e;
      avatar.hop = Math.sin(k * Math.PI) * 48;
    });
    await room.tween(ms * 0.2, (k) => { avatar.x = q.x; avatar.y = q.y; avatar.hop = Math.sin(k * Math.PI) * 7; });
    avatar.hop = 0;
  }
  const sfx = (name, step, param) => { if (step > 0) sound.play(name, param); };

  // ---- トレースの種類ごとの見せ方 ----
  const handlers = {
    async tokenize(ev, step) {
      v.slot = 'tokenizer';
      v.heard = [];
      await animate(step * Math.min(2, ev.tokens.length * 0.2), (k) => {
        const count = Math.floor(k * ev.tokens.length);
        if (count > v.heard.length) sfx('pop', step);
        v.heard = ev.tokens.slice(0, count);
      });
      placeAvatar(BOS);
      await room.wait(step * 0.6);
    },

    async lookup(ev, step) {
      v.slot = 'context';
      v.rows = [];
      v.strip = null;
      v.needle = null;
      v.diceText = '';
      v.picked = null;
      v.glow = null;
      v.message = '';
      v.rowKey = ev.key;
      placeAvatar(ev.key);
      v.rows = ev.found ? rowOf(ev.key) : [];
      v.drawer = 0; v.scan = 0; v.fill = 1;
      sfx('book', step);
      await animate(step * 1.1, (k) => { v.scan = k; v.drawer = k; });
      v.slot = 'predictor';
      if (!ev.found) {
        v.message = '（からっぽ）';
        sfx('empty', step);
        burst(W * 0.8, H * 0.38, 'dust', 12);
      }
      await animate(step * 0.6);
    },

    async probs(ev, step) {
      v.rows = [...ev.candidates].sort((a, b) => b.count - a.count);
      v.cands = ev.candidates;
      v.fill = 0;
      sfx('bars', step);
      await animate(step * 1.3, (k) => { v.fill = k; });
      v.fill = 1;
      await room.wait(step * 0.4);
    },

    async pick(ev, step) {
      v.slot = 'sampler';
      v.strip = v.cands.map((c) => ({ token: c.token, p: c.p }));
      v.needle = 0;
      v.diceText = 'サイコロをふる…';
      sfx('dice', step, step * 1.6 / 1000);
      await animate(step * 1.6, (k) => {
        v.roll = k;
        const phase = (6 + ev.r) * (1 - (1 - k) ** 3);
        v.needle = 1 - Math.abs(1 - phase % 2);
      });
      v.needle = ev.r; v.roll = null; v.flash = 1;
      v.picked = ev.token;
      v.glow = edgeKey(v.rowKey, ev.token);
      v.diceText = `乱数 ${ev.r.toFixed(3)} →「${ev.token}」`;
      sfx('mindWin', step, step / 1000);
      const u = clamp(H / 40, 14, 22);
      burst(W * 0.62 + 14 + (W * 0.38 - 52) * ev.r, H - 30 - u * 12.5);
      await animate(step * 0.9, (k) => { v.flash = 1 - k; v.flow = k * 2; });
    },

    async emit(ev, step) {
      sfx('toot', step, ev.token);
      v.flight = { token: ev.token, k: 0 };
      await Promise.all([travel(v.rowKey, ev.token, step), animate(step, (k) => { v.flight.k = k; v.flow = k; })]);
      const target = outputPoint(v.out.length);
      v.flight = null; v.out.push(ev.token);
      burst(target.x, target.y, 'spark', 12);
      sfx('mindLand', step, step / 1000);
      await animate(step * 0.35);
    },

    async end(ev, step) {
      if (ev.reason === 'eos') {
        await travel(v.rowKey, EOS, step * 0.9);
        sfx('done', step);
        burst(avatar.x, avatar.y - 35, 'confetti', 70);
      }
      v.endText = END_TEXT[ev.reason] ?? '';
      await animate(step * 1.6, (k) => { if (ev.reason === 'empty') v.sad = ease(k); });
    },

    async replay(ev, step) {
      v.slot = 'tokenizer';
      v.seq = ev.tokens ?? [BOS, ...Array.from(ev.text), EOS];
      v.seqAt = -1;
      v.write = null;
      v.rowKey = null;
      v.rows = [];
      v.glow = null;
      for (const m of mem) m.active = false;
      const item = mem.find((m) => m.text === ev.text);
      if (item) item.active = true;
      placeAvatar(BOS);
      sfx('pop', step);
      await animate(step * 1.2, (k) => { v.replayAt = Math.min(v.seq.length - 1, Math.floor(k * v.seq.length)); });
      v.replayAt = -1;
    },

    async count(ev, step) {
      v.slot = 'learner';
      v.seqAt += 1;
      const newborn = [ev.key, ev.token].filter((t) => !nodes.has(t));
      const from = ensureNode(ev.key);
      const to = ensureNode(ev.token, from);
      const key = edgeKey(ev.key, ev.token);
      if (!edges.has(key)) edges.set(key, { a: ev.key, b: ev.token, count: 0, growth: 0 });
      const edge = edges.get(key);
      edge.count = ev.before;
      v.rowKey = ev.key;
      v.picked = ev.token;
      v.rows = rowOf(ev.key).filter((r) => r.count > 0);
      v.write = { key: ev.key, token: ev.token, before: ev.before, after: ev.after, done: false };
      v.glow = key;
      for (const t of newborn) { const n = nodes.get(t); n.birth = 0; burst(n.x, n.y); }
      const newEdge = edge.growth === 0;
      await Promise.all([travel(ev.key, ev.token, step * 0.8), animate(step * 0.8, (k) => {
        if (newEdge) edge.growth = k;
        v.flow = k;
        for (const t of newborn) nodes.get(t).birth = k;
      })]);
      edge.count = ev.after;
      recount();
      v.rows = rowOf(ev.key);
      v.write.done = true;
      v.floaters.push({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 10, text: '+1' });
      sfx('count', step);
      v.fill = 0; v.pulse = 0;
      await animate(step * 0.9, (k) => { v.pulse = k; v.fill = k; v.flow = k; });
      v.floaters = [];
    },

    async forget(ev, step) {
      const i = mem.findIndex((m) => m.text === ev.text);
      if (i >= 0) {
        const item = mem[i], u = clamp(H / 40, 14, 22);
        burst(W * 0.72, H - 18 - u * 5.7 + i * u * 1.15, 'bubble', 28);
        sfx('forget', step);
        await animate(step * 0.8, (k) => { item.fade = k; });
        mem.splice(i, 1);
      }
      v.seq = null;
      v.write = null;
      await animate(step * 0.2);
    },
  };

  async function handle(ev, step) {
    ambientStep = step > 0 ? step : ambientStep;
    await handlers[ev.type]?.(ev, step);
  }

  sync();
  return { open, close, handle, sync, stats, get isOpen() { return reveal > 0; } };
}
