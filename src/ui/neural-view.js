const GOLD = '#f4cb7e';
const labels = { '<bos>': 'はじまり', '<eos>': 'おしまい', '<user>': 'あなた', '<assistant>': 'コト', '<turn>': '交代', '<unk>': '？', '■': 'おしまい' };
export const tokenLabel = token => labels[token] ?? token;
export function neuralLayout(W) {
  const mobile = W <= 640, x = mobile ? 18 : 48, width = mobile ? W - 36 : W * .67;
  const ys = mobile ? { heard: 168, attention: 290, work: 430, candidates: 570, output: 730 } : { heard: 155, attention: 290, work: 435, candidates: 580, output: 755 };
  const point = (lane, index = 0, count = 1) => {
    if (lane === 'entry') return { x: x + width * .75, y: ys.heard - 5 };
    if (lane === 'work') return { x: x + width / 2, y: ys.work };
    const slots = lane === 'attention' ? 8 : lane === 'output' ? (mobile ? 8 : 16) : Math.min(8, Math.max(1, count));
    const step = Math.min(lane === 'output' ? 42 : 76, width / slots);
    return { x: x + 24 + (index % slots) * step, y: ys[lane] + Math.floor(index / slots) * (lane === 'attention' ? 32 : 44) };
  };
  return { mobile, x, width, ys, point };
}

export function drawNeural(g, v, model, W, H, courier, clock) {
  const { mobile, x, width, ys, point } = neuralLayout(W);
  const text = (s, xx, yy, size = 15, color = '#f5ebd5', max = width) => { g.font = `${size}px "Yu Gothic UI", sans-serif`; g.fillStyle = color; g.textAlign = 'left'; g.fillText(s, xx, yy, max); };
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#243749'); bg.addColorStop(1, '#111d34'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 45; i++) { g.globalAlpha = .15 + Math.sin(clock + i) ** 2 * .25; g.fillStyle = GOLD; g.beginPath(); g.arc((i * 173 + 29) % W, (i * 97 + 33) % H, i % 3 ? 1 : 2, 0, 7); g.fill(); } g.globalAlpha = 1;
  text(v.mode === 'learn' ? 'コトの夢 · ことばをおぼえる' : 'コトの考えごと', x, mobile ? 92 : 55, mobile ? 20 : 26);
  const card = (token, p, active = false, scale = 1, maxWidth = 62) => {
    const label = tokenLabel(token), w = Math.min(maxWidth, Math.max(32, Array.from(label).length * 14 + 16));
    g.save(); g.translate(p.x, p.y); g.scale(scale, scale);
    g.fillStyle = '#10162866'; g.beginPath(); g.roundRect(-w / 2 + 2, -13, w, 34, 7); g.fill();
    g.fillStyle = active ? '#ffe3a0' : '#f4edd7'; g.strokeStyle = active ? '#f5c76c' : '#8fac9c'; g.lineWidth = active ? 3 : 1;
    g.beginPath(); g.roundRect(-w / 2, -17, w, 34, 7); g.fill(); g.stroke();
    g.fillStyle = '#40533f'; g.font = 'bold 16px "Yu Gothic UI", sans-serif'; g.textAlign = 'center'; g.fillText(label, 0, 6, w - 8); g.restore();
  };
  g.strokeStyle = '#9ab6a32b'; g.lineWidth = 4; g.setLineDash([3, 12]); g.beginPath();
  g.moveTo(x + width * .5, ys.heard + 30); g.lineTo(x + width * .5, ys.output - 30); g.stroke(); g.setLineDash([]);
  text(v.mode === 'learn' ? '聞いた会話' : '届いたことば', x, ys.heard - 42);
  const incoming = v.mode === 'learn' ? (v.seq ?? []) : (v.heard ?? []);
  const at = v.mode === 'learn' ? Math.max(0, v.seqAt ?? 0) : incoming.length - 1;
  const start = Math.max(0, at - 7), shown = incoming.slice(start, start + 8);
  shown.forEach((token, i) => card(token, point('heard', i, shown.length), start + i === at));
  text(v.mode === 'learn' ? '順番に、つづきを思い出す' : '手がかりを集める', x, ys.attention - 35);
  if (v.attention) {
    v.attention.tokens.forEach((token, i) => {
      const p = point('attention', i, v.attention.tokens.length), weight = v.attention.weights[i];
      g.strokeStyle = `rgba(246,197,107,${.1 + weight * .8})`; g.lineWidth = 1 + weight * 8;
      g.beginPath(); g.moveTo(p.x, p.y + 10); g.quadraticCurveTo(p.x, ys.work - 24, x + width / 2, ys.work); g.stroke();
      card(token, p, i === v.attentionFocus, .69, 47);
    });
  } else if (v.mode === 'learn') shown.forEach((token, i) => card(token, point('attention', i, shown.length), start + i === at, .78));
  const station = point('work');
  g.fillStyle = '#5f7567'; g.strokeStyle = '#aeb993'; g.lineWidth = 3; g.beginPath(); g.roundRect(station.x - 82, station.y - 44, 164, 78, 12); g.fill(); g.stroke();
  const matrix = v.matrices?.[v.mode === 'learn' ? 1 : 0] ?? [];
  matrix.forEach((value, i) => { g.fillStyle = value > 0 ? `rgba(250,208,128,${.3 + Math.min(.7, Math.abs(value) * 4)})` : '#6b9eaf'; g.fillRect(station.x - 70 + i % 24 * 6, station.y - 34 + Math.floor(i / 24) * 8, 4, 6); });
  text(v.mode === 'learn' ? 'ことばのつながりを育てる' : 'つづきのことばを探す', station.x - 95, station.y + 58, 14);
  if (v.mode === 'learn' || v.mode === 'explore') {
    const history = v.losses ?? [], latest = history.at(-1);
    text(latest ? `練習 ${latest.epoch} / 12` : 'コトのことばの引き出し', x, ys.candidates - 12, 18);
    if (latest) text(`損失 ${latest.loss.toFixed(3)}　重みの更新 ${latest.updates} 回`, x, ys.candidates + 18, 13, '#b7d1cd');
    if (history.length) {
      const max = Math.max(...history.map(h => h.loss), .1) * 1.1;
      g.strokeStyle = GOLD; g.lineWidth = 3; g.beginPath(); history.forEach((h, i) => { const xx = x + i / 11 * width, yy = ys.candidates + 130 - h.loss / max * 80; if (i) g.lineTo(xx, yy); else g.moveTo(xx, yy); }); g.stroke();
    }
  } else {
    text('ことばのくじ', x, ys.candidates - 40);
    const rows = [...(v.rows ?? [])].sort((a, b) => b.p - a.p).slice(0, 5);
    const selected = v.rows?.find(r => r.token === v.picked);
    if (selected && !rows.includes(selected)) rows[rows.length - 1] = selected;
    rows.forEach((r, i) => { const p = point('candidates', i, rows.length); card(r.token, p, r.token === v.picked || i === v.rollIndex); text(`${(r.p * 100).toFixed(1)}%`, p.x - 18, p.y + 38, 11, '#b7d1cd', 60); });
    text('コトの返事', x, ys.output - 40);
    (v.out ?? []).forEach((token, i) => card(token, point('output', i), false, .88));
  }
  if (!mobile) {
    const rx = W * .76; text('ことばの旅', rx, 165, 22, GOLD, W * .2);
    text(v.mode === 'learn' ? '思い出して、運んで、おぼえる。' : '集めて、選んで、声にする。', rx, 200, 14, '#b7d1cd', W * .2);
    text('小さなTransformer', rx, 260, 14, '#b7d1cd', W * .2);
    const latest = v.losses?.at(-1); if (latest) text(`損失 ${latest.loss.toFixed(4)}`, rx, 292, 15, GOLD, W * .2);
  }
  const travel = v.courier, resolve = a => point(a.lane, a.index ?? 0, a.count ?? 1);
  const from = travel ? resolve(travel.from) : { x: station.x - 120, y: station.y + 75 }, to = travel ? resolve(travel.to) : from;
  const k = travel?.k ?? 0, walk = Math.max(0, Math.min(1, (k - .2) / .6)), eased = walk * walk * (3 - 2 * walk);
  const px = from.x + (to.x - from.x) * eased, py = from.y + (to.y - from.y) * eased;
  courier(g, px, py + 68, travel?.token != null ? walk * 3 : clock * .16, mobile ? 100 : 130);
  if (travel?.token != null && (k < .2 || k > .8)) {
    const into = k < .2 ? k / .2 : (1 - k) / .2;
    card(travel.token, { x: px, y: py - 25 + into * 50 }, true, 1 - into * .8, mobile ? 85 : 120);
  }
}
