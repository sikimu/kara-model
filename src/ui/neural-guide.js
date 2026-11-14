// 初めて見る人向けの説明。計算の記録と詳しい数値は別に保持する。
const names = { '<bos>': 'はじめ', '<user>': 'あなた', '<assistant>': 'コト', '<turn>': '交代', '<eos>': 'おわり', '<unk>': '未習' };
const name = t => names[t] ?? t;
export const glossary = {
  '文字の札': 'ことばを小さく分けたものです。このコトは「ねこ」を「ね」「こ」の2枚に分けます。この1枚を専門用語でトークンと呼びます。',
  '手がかり': '続きの文字を考えるときに参考にする情報です。たとえば「おはよ」まで来たら、その並びが次の「う」を考える手がかりになります。必ず「う」になるわけではありません。',
  '覚えた数': '練習するたびに少しずつ調整する、計算用の数です。会話をそのまましまうのではなく、ことばの続き方を数に反映します。専門用語では重みと呼びます。',
  '確率': 'どれくらい選ばれやすいかを表す割合です。たとえば25%は、ルーレットの4分の1の広さ。4回まわせば必ず1回当たる、という意味ではありません。',
  'まだ覚えていない': 'この文字はまだ練習に出ていないため、専用の数を持っていません。元の文字は残しますが、計算の中では同じ「未習」の札として扱います。「？」が並んでいたのはこのためです。',
  '見る割合': '前のことばのどこを、どれくらい参考にするかです。次の文字として選ばれる確率とは別です。まだ練習が少ないと、役に立つ場所をうまく選べません。',
};

export function simpleGuide(v, info) {
  const stage = v.operation && v.stages?.[v.operation.index], kind = stage?.kind ?? (stage ? 'tune' : null);
  const guide = (body, picture, captions, tokens = []) => ({ title: info.title, body, picture, captions, tokens });
  if (kind) {
    const unknown = stage.tokens?.includes('<unk>');
    const texts = {
      add: v.operation.index === 0 ? '文字の札を、計算に使える数に置きかえます。「どの文字か」と「何番めか」の両方を入れます。' : '前のことばから集めた手がかりを、もとの文字の情報に足します。もとの情報も残ります。',
      match: '次の文字を考えるために、前のことばを見直します。どこを多く参考にするか、「見る割合」を決めます。' + (unknown ? '「未習」は、まだ覚えていない文字です。' : ''),
      mix: '前のことばから手がかりを集めます。「見る割合」が大きい文字からは多く、小さい文字からは少し受け取ります。',
      gate: '集めた手がかりを、覚えた数で組み合わせ直します。これで、単に足すだけでは表せないことばのつながりも扱えます。',
      score: '続きになりそうな文字に点をつけます。点が高いほど選ばれやすくなりますが、まだ答えは決まりません。',
      tune: '次の文字をうまく当てられるように、覚えた数を少し直します。ここで直した数は、次に話すときにも使います。',
    };
    const captions = { add: ['文字と順番', '数にする', '計算の材料'], match: ['前のことば', '見直す', '見る割合'], mix: ['それぞれの情報', '集める', '手がかり'], gate: ['手がかり', '組み合わせる', '新しい手がかり'], score: ['手がかり', '点をつける', '続きの候補'], tune: ['答えと比べる', '少し直す', '次にも使う'] };
    const result = guide(texts[kind], kind, captions[kind], (stage.sourceTokens ?? stage.tokens ?? [stage.token]).filter(Boolean).slice(-5).map(name));
    result.title = { add: v.operation.index === 0 ? '文字を計算の材料にする' : 'もとの情報も残す', match: '前のことばを見直す', mix: '手がかりを集める', gate: '手がかりを組み合わせる', score: '続きの候補に点をつける', tune: info.title }[kind];
    return result;
  }
  if (v.arriving) return guide('あなたのことばがポストに届きました。元のことばはここに残し、文字の札にした写しを運びます。', 'mail', ['あなたのことば', 'ポストに届く', '写しを運ぶ']);
  if (v.arrange) return guide('文字の札を、聞いた順に置きます。「ねこ」と「こね」では、順番が変わるとことばも変わります。いっぱいになったら重ねて残します。', 'order', ['ね → こ', '順番を保つ', '重ねて残す'], v.arrange.tokens.slice(0, 5).map(name));
  if (v.quiz) return guide('会話の続きを予想して、お手本の答えと比べます。間違いを減らせるように、このあと覚えた数を直します。', 'tune', ['続きを予想', 'お手本と比べる', '練習する']);
  if (v.errorNote) return guide('答えとのずれを、前の部屋へ知らせます。どの覚えた数をどう直すか、計算をさかのぼって調べます。', 'tune', ['答えとのずれ', '前へ知らせる', '数を直す']);
  if (v.phase === 'probs' || v.phase === 'pick') return guide(v.phase === 'probs' ? '候補の点を、選ばれやすさを表す確率に変えます。確率が大きい文字ほど、ルーレットの場所が広くなります。' : 'ルーレットで次の文字を1つ選びます。広い場所ほど当たりやすいですが、狭い場所にも当たることがあります。', 'wheel', ['候補の点', '広さに変える', '1つ選ぶ']);
  if (v.phase === 'emit' || v.endText) return guide('選んだ文字を返事につけ足します。返事の続きも、同じように1文字ずつ考えます。終わりの合図が出ると返事が完成します。', 'order', ['文字を選ぶ', '返事に足す', '続きを考える'], (v.out ?? []).slice(-5).map(name));
  if (v.mode === 'explore') return guide('コトは、ことばの続きを1文字ずつ考えて返事を作ります。部屋を回ると、その準備と計算を見ることができます。', 'order', ['聞いたことば', '続きを考える', '返事']);
  return guide('聞いたことばを手がかりに、続きの文字を考える準備をしています。文字の札の写しを次の場所へ運びます。', 'order', ['聞いたことば', '写しを運ぶ', '次の準備']);
}

const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// アプリ内の図解。数値を再計算せず、作業の目的だけを絵にする。
export function guidePicture(g) {
  const text = (x, y, s, size = 14) => `<text x="${x}" y="${y}" text-anchor="middle" fill="#304b4a" font-size="${size}">${escape(s)}</text>`;
  const card = (x, y, s, fill = '#fff8e5') => `<rect x="${x - 17}" y="${y - 21}" width="34" height="42" rx="5" fill="${fill}" stroke="#b7a584"/>${text(x, y + 5, s, Math.min(14, 29 / Math.max(1, [...String(s)].length)))}`;
  const tokens = g.tokens.length ? g.tokens.slice(-3) : ['ね', 'こ'];
  const bars = x => [0, 1, 2].map(i => `<rect x="${x - 22 + i * 16}" y="${65 - i * 14}" width="12" height="${20 + i * 14}" rx="3" fill="#d8aa62"/>`).join('');
  const envelope = x => `<rect x="${x - 35}" y="33" width="70" height="46" rx="5" fill="#fff8e5" stroke="#b7a584" stroke-width="2"/><path d="m${x - 34} 35 34 25 34-25" fill="none" stroke="#b7a584" stroke-width="2"/>`;
  let drawing = ['gate', 'mix', 'score', 'wheel'].includes(g.picture) ? bars(80) : tokens.map((t, i) => card(44 + i * 37, 55, t)).join('');
  if (g.picture === 'mail') drawing = envelope(80) + `<rect x="208" y="27" width="84" height="62" rx="9" fill="#cc7a65"/><path d="M223 47h54" stroke="#5a4740" stroke-width="7"/><path d="M250 89v10" stroke="#816850" stroke-width="9"/>` + envelope(405);
  else if (g.picture === 'match') drawing += '<circle cx="248" cy="48" r="23" fill="#b7dedb" stroke="#557b79" stroke-width="5"/><path d="m265 65 19 20" stroke="#557b79" stroke-width="8"/>' + bars(405);
  else if (g.picture === 'wheel') drawing += '<circle cx="250" cy="56" r="34" fill="#8fc6ba"/><path d="M250 56V22A34 34 0 0 1 284 56Z" fill="#efbb69"/><path d="M250 56 276 34" stroke="#b76150" stroke-width="4"/>' + card(405, 55, '次');
  else if (g.picture === 'tune' || g.picture === 'gate') drawing += '<path d="M218 37h64M218 57h64M218 77h64" stroke="#8faaa0" stroke-width="5"/><g fill="#e1a95f"><circle cx="238" cy="37" r="8"/><circle cx="266" cy="57" r="8"/><circle cx="248" cy="77" r="8"/></g>' + card(405, 55, '数');
  else if (g.picture === 'mix') drawing += '<path d="M217 45h66q-4 42-33 42t-33-42" fill="#8fc6ba"/><circle cx="237" cy="34" r="7" fill="#e5b465"/><circle cx="264" cy="27" r="5" fill="#81b7ce"/>' + card(405, 55, '数');
  else if (g.picture === 'order') drawing += card(231, 55, tokens[0]) + card(270, 55, tokens.at(-1)) + text(231, 88, '1') + text(270, 88, '2') + card(401, 64, '') + card(405, 58, '') + card(409, 52, tokens.at(-1));
  else drawing += bars(250) + (g.picture === 'score' ? card(388, 55, 'あ') + card(430, 55, 'い') : bars(405));
  return `<svg viewBox="0 0 490 135" role="img" aria-label="${escape(g.captions.join('、'))}" xmlns="http://www.w3.org/2000/svg"><rect width="490" height="135" rx="14" fill="#f4edda"/>${drawing}<path d="M154 56h33m-9-8 9 8-9 8M315 56h33m-9-8 9 8-9 8" fill="none" stroke="#7a9790" stroke-width="3"/>${g.captions.map((s, i) => text([80, 250, 405][i], 117, s)).join('')}</svg>`;
}
