// 実測の注意係数・確率・損失を描く。線や色を学習結果の代用にしない。
export function drawNeural(g, v, model, W, H) {
  const mobile = W < 641, pad = mobile ? 18 : 42, width = W - pad * 2;
  g.fillStyle = '#202c47'; g.fillRect(0, 0, W, H);
  const text = (s, x, y, size = 16, color = '#f9edce') => { g.font = `${size}px "Yu Gothic UI", sans-serif`; g.fillStyle = color; g.textAlign = 'left'; g.fillText(s, x, y, width); };
  text(v.mode === 'learn' ? 'コトの夢 · ことばの練習' : 'コトの考えごと', pad, mobile ? 105 : 66, 24);
  text('小さなTransformer', pad, mobile ? 136 : 95, 13, '#adbed8');
  let y = mobile ? 180 : 155;
  const matrices = v.matrices ?? [];
  const cell = mobile ? 6 : Math.min(14, width / 68), side = cell * 12;
  const names = ['自己注意 Q', 'MLP', '出力の重み'];
  const space = (width - side * 3) / 2;
  matrices.forEach((matrix, m) => {
    const x = pad + m * (side + space);
    text(names[m], x, y, mobile ? 12 : 17, '#bdd5d9');
    matrix.forEach((value, i) => {
      const amount = Math.min(1, Math.abs(value) * 4);
      g.fillStyle = value >= 0 ? `rgba(245,195,101,${.13 + amount * .87})` : `rgba(103,190,207,${.13 + amount * .87})`;
      g.fillRect(x + i % 12 * cell, y + 16 + Math.floor(i / 12) * cell, cell - 1, cell - 1);
    });
    if (m < 2) {
      const mid = x + side + space * .5;
      g.strokeStyle = '#91abb5'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + side + 6, y + 16 + side / 2); g.lineTo(x + side + space - 6, y + 16 + side / 2); g.stroke();
      text('›', mid - 4, y + 21 + side / 2, 20, '#f6c56b');
    }
  });
  y += side + 60;
  text('ここまでの会話に、目を向ける', pad, y, 18);
  y += 34;
  const attention = v.attention;
  if (attention) {
    const tokens = attention.tokens, per = mobile ? 6 : 12, gap = 5, tw = Math.min(70, (width - (per - 1) * gap) / per);
    tokens.forEach((token, i) => {
      const x = pad + i % per * (tw + gap), ty = y + Math.floor(i / per) * 62;
      g.fillStyle = `rgba(246,197,107,${.12 + attention.weights[i] * .88})`; g.fillRect(x, ty, tw, 51);
      const label = ({ '<bos>': '始', '<user>': 'あなた', '<assistant>': 'コト', '<turn>': '交代', '<unk>': '?' })[token] ?? token;
      text(label, x + 4, ty + 21, 13); text(`${(attention.weights[i] * 100).toFixed(1)}%`, x + 4, ty + 42, 11, '#afc6d8');
    });
    y += Math.ceil(tokens.length / per) * 62 + 22;
  } else { text(v.mode === 'learn' ? '聞いた順に、つづきを思い出す。' : 'ことばを待っている。', pad, y + 18, 15, '#adbed8'); y += 60; }
  if (v.mode === 'learn' || v.mode === 'explore') {
    text('重みを、少しずつ育てる', pad, y, 18); y += 35;
    const history = v.losses ?? [];
    const latest = history.at(-1);
    text(`交差エントロピー損失　${(latest?.loss ?? (v.mode === 'explore' ? model.network.lastLoss : null))?.toFixed(4) ?? '—'}`, pad, y, 16);
    text(`重みの更新　${latest?.updates ?? (v.mode === 'explore' ? model.network.updates : '—')} 回`, pad, y + 29, 16);
    if (latest) text(`練習 ${latest.epoch} / 12　勾配ノルム ${latest.gradientNorm.toFixed(3)}`, pad, y + 58, 13, '#adbed8');
    const chartY = y + 90, ch = 110, cw = Math.min(width, 680);
    g.strokeStyle = '#6a829e'; g.beginPath(); g.moveTo(pad, chartY); g.lineTo(pad, chartY + ch); g.lineTo(pad + cw, chartY + ch); g.stroke();
    if (history.length) {
      const max = Math.max(...history.map(h => h.loss), .1) * 1.1;
      g.strokeStyle = '#f6c56b'; g.lineWidth = 3; g.beginPath();
      history.forEach((h, i) => { const x = pad + i / 11 * cw, yy = chartY + ch - h.loss / max * ch; if (i) g.lineTo(x, yy); else g.moveTo(x, yy); }); g.stroke();
    }
    text('1層 · 1ヘッド · 12次元 · 文脈24トークン', pad, chartY + ch + 35, 13, '#adbed8');
  } else {
    text('次のことばの候補', pad, y, 18); y += 25;
    const rows = [...(v.rows ?? [])].sort((a, b) => b.p - a.p).slice(0, 5);
    rows.forEach((row, i) => {
      const yy = y + i * 32;
      text(row.token === '■' ? 'おしまい' : row.token, pad, yy + 19, 14);
      g.fillStyle = row.token === v.picked ? '#f6c56b' : '#80b5b3';
      g.fillRect(pad + 70, yy, Math.max(1, row.p * (width - 135)), 23);
      text(`${(row.p * 100).toFixed(1)}%`, W - pad - 60, yy + 18, 12);
    });
    y += 190;
    text('コトの返事', pad, y, 18);
    const output = v.out?.join('') || v.endText || '';
    const per = mobile ? 17 : 40;
    for (let i = 0; i * per < output.length; i++) text(output.slice(i * per, (i + 1) * per), pad, y + 38 + i * 30, 20);
  }
}
