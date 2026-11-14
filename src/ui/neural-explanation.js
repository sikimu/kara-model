// Display-only descriptions of the recorded computation, never a second model.

// 1 つの部屋の作業を、いくつの手順に分けて見せるか。
export function unitCount(stage) {
  if (!stage) return 0;
  const kind = stage.kind ?? 'tune';
  if (kind === 'match' || kind === 'mix') return stage.tokens.length;
  if (kind === 'score') return stage.candidates.length;
  if (kind === 'tune') return Math.ceil(stage.values.length / 4);
  return stage.values.length;
}

export function workFrame(stage, k) {
  const count = unitCount(stage);
  const position = Math.max(0, Math.min(1, k)) * count;
  const index = Math.min(Math.max(0, count - 1), Math.floor(position));
  const phase = k >= 1 ? 1 : position - index;
  return { index, phase, count };
}

// いま見せている手順。くわしく説明するために止まっている間は、置き終えた手順を指す。
export function frameOf(stage, operation) {
  const frame = workFrame(stage, operation.k);
  return operation.hold != null ? { index: operation.hold, phase: 1, count: frame.count } : frame;
}

// tune の 1 手順（4 個ひと組）の中で、いちばん大きく動いた重み。
export function tuneChange(stage, unit) {
  let best = unit * 4;
  for (let j = unit * 4; j < Math.min(stage.values.length, unit * 4 + 4); j++) {
    if (Math.abs(stage.values[j] - (stage.before?.[j] ?? 0)) > Math.abs(stage.values[best] - (stage.before?.[best] ?? 0))) best = j;
  }
  return { index: best, before: stage.before?.[best] ?? 0, after: stage.values[best] };
}

const num = x => `${x < 0 ? '−' : ''}${Math.abs(x).toFixed(2)}`;
const pct = p => `${(p * 100).toFixed(1)}%`;
const name = token => ({ '<bos>': 'はじまり', '<eos>': 'おしまい', '<user>': 'あなた', '<assistant>': 'コト', '<turn>': '交代', '<unk>': '？', '■': 'おしまい' })[token] ?? token;

// 机の手前に出す、いま扱っている値の短い読み上げ。説明なしでも出す。
export function readout(stage, frame) {
  const kind = stage.kind ?? 'tune', i = frame.index;
  if (kind === 'add') return `${num(stage.a[i])} ＋ ${num(stage.b[i])} ＝ ${num(stage.values[i])}`;
  if (kind === 'match') return `「${name(stage.tokens[i])}」を 見る わりあい ${pct(stage.weights[i])}`;
  if (kind === 'mix') return `「${name(stage.tokens[i])}」から ${pct(stage.weights[i])} ぶん`;
  if (kind === 'gate') return `${num(stage.before[i])} → ${num(stage.values[i])}`;
  if (kind === 'score') return `「${name(stage.candidates[i].token)}」は ${stage.candidates[i].score.toFixed(2)} 点`;
  if (!stage.before) return '';
  const c = tuneChange(stage, i);
  return `${c.before.toFixed(4)} → ${c.after.toFixed(4)}`;
}

const steps = {
  add0: ['① 文字を 数に する', '文字のままでは計算できません。文字ごとに決まっている12個の数（埋め込み）を引き出しから出し、「文の何番目か」を表す12個の数を1つずつ足します。金色はプラス、青はマイナスの数です。'],
  match: ['② どの文字を見るか 見くらべる', '次の文字を当てるために、これまでのどの文字が手がかりになるかを調べます。虫めがねで1文字ずつ見くらべ、役に立ちそうな文字ほど高い台にのせます。台の高さが「見る割合」で、全部を足すと100%です（自己注意）。'],
  mix: ['③ 見る割合で まぜる', '高い台の文字からはたくさん、低い台の文字からは少しだけ、その文字が持つ数をすくって手前の列にまぜます。こうして文脈全体から1組の手がかりを作ります。'],
  add3: ['④ もとの数に たしなおす', '③でまぜた手がかりを、①で作ったもとの数に足します。もとの情報を消さずに上乗せするこの足し算を、残差接続と呼びます。'],
  gate: ['⑤ しぼって 特徴を とり出す', '数を24個に広げてから、1つずつしぼり機（GELU）に通します。プラスの数はほぼそのまま通り、マイナスの数は小さくつぶれます。この「曲げ」があるので、足し算だけではできない見分けができます（MLP）。'],
  score: ['⑥ 文字ごとに 点を つける', 'できあがった手がかりを、知っている文字1つずつと照らし合わせて点をつけます。点が高い文字ほど、次に来そうな文字です。このあと点を確率に直して、ルーレットで1つ選びます。'],
};

// くわしい説明モードで、置き終えた 1 手ごとに出す文。数は記録された計算結果そのもの。
export function stepNote(stage, frame, index) {
  const kind = stage.kind ?? 'tune', i = frame.index;
  if (kind === 'add' && index === 0) return `いま置いたのは ${i + 1}本め。文字「${name(stage.token)}」の ${i + 1}番めの数 ${num(stage.a[i])} に、「文の ${stage.position + 1}番め」を表す数 ${num(stage.b[i])} を重ねて、${num(stage.values[i])} になりました。12本そろうと、「${name(stage.token)}が ${stage.position + 1}番めにある」ことを表す数の組になります。`;
  if (kind === 'add') return `いま置いたのは ${i + 1}本め。①で作ったもとの数 ${num(stage.a[i])} に、③でまぜた手がかり ${num(stage.b[i])} を重ねて、${num(stage.values[i])} になりました。もとの数を捨てずに足すので、文字そのものの情報も残ります。`;
  if (kind === 'match') return `「${name(stage.tokens[i])}」が、次の文字を当てる手がかりになりそうかを数にすると ${stage.scores[i].toFixed(2)} でした。全部の札の数を比べて割合に直すと ${pct(stage.weights[i])}。この割合の高さの台にのせました。`;
  if (kind === 'mix') return `「${name(stage.tokens[i])}」が持つ12個の数に、見る割合 ${pct(stage.weights[i])} を掛けて、手前の列に足しました。割合が大きい札ほど、手前の列を大きく動かします。`;
  if (kind === 'gate') return stage.before[i] < 0
    ? `${num(stage.before[i])} はマイナスなので、しぼり機で ${num(stage.values[i])} まで小さくつぶれました。「この特徴は当てはまらない」という合図は弱めて通します。`
    : `${num(stage.before[i])} はプラスなので、ほぼそのまま ${num(stage.values[i])} で通りました。「この特徴が当てはまる」という合図はそのまま次へ渡します。`;
  if (kind === 'score') return `「${name(stage.candidates[i].token)}」の点は ${stage.candidates[i].score.toFixed(2)}。奥に並べた手がかりの12個の数と、「${name(stage.candidates[i].token)}」用に覚えている12個の数を、1つずつ掛けて足した値です。点が高いほど、次に来そうな文字です。`;
  const c = tuneChange(stage, i), up = c.after > c.before;
  return `この4個の目もりを、矢印の向きへ動かしました。いちばん動いたのは ${c.index + 1}番めで、${c.before.toFixed(4)} から ${c.after.toFixed(4)} へ（${up ? '大きく' : '小さく'}しました）。この向きは、後ろの部屋から届いた「はずれの知らせ」から計算したものです。`;
}

export function rouletteTurn(k, r) { return (3 + r) * (1 - (1 - Math.max(0, Math.min(1, k))) ** 3); }
export function rouletteSector(rows, r) {
  let sum = 0;
  for (const row of rows) { sum += row.p; if (r < sum) return row; }
  return rows.at(-1);
}

export function explainNeural(v) {
  if (v.holdNote) return v.holdNote;
  if (v.quiz && !v.operation && !v.errorNote) {
    const q = v.quiz, said = q.context.map(name).join('');
    return { title: `れんしゅう ${v.epoch ?? 1} / 12 · 次の文字を 当ててみる`,
      body: `聞いた会話の途中「${said}」までを見て、次の文字を予想しました。正解は「${name(q.answer)}」です。正解の文字に付けた確率が低いほど「はずれ」が大きい、と数えます。このはずれを小さくしていくのが学習です。`,
      detail: `正解「${name(q.answer)}」に付けた確率 ${pct(q.p)} → はずれ ${pct(1 - q.p)}` };
  }
  if (v.errorNote && v.courier && !v.operation) return { title: 'はずれの知らせを 前の部屋へ',
    body: '答えにいちばん近い⑥の部屋から①の部屋へ、計算とは逆向きに、はずれの知らせを運びます。部屋ごとに「この目もりをどちら向きにどれだけ動かせば、はずれが減るか」を計算して伝えます（誤差逆伝播）。',
    detail: `赤い粒は伝わる向きのイメージです（粒の数や大きさは勾配の実数値ではありません）。見本の正解以外に付けた確率 ${pct(v.errorNote.size)}` };
  if (v.lottery && v.phase === 'pick') {
    const selected = rouletteSector(v.rows, v.lottery.r);
    return { title: v.lottery.k < 1 ? 'ルーレットで 次の文字を えらぶ' : `「${name(selected.token)}」に 止まった`,
      body: '盤の区切りの幅は、それぞれの文字の確率です。広い区切りほど当たりやすく、せまい区切りもたまに当たります。だから同じことばを聞いても、返事が毎回同じとは限りません。',
      detail: v.lottery.k < 1 ? '針が止まる場所は、計算のときに引いた乱数で決まっています。回している間に引き直しはしません。' : `乱数 ${v.lottery.r.toFixed(4)} · この文字の確率 ${(selected.p * 100).toFixed(2)}%` };
  }
  if (v.operation) {
    const stage = v.stages[v.operation.index], f = frameOf(stage, v.operation), kind = stage.kind ?? 'tune';
    const step = v.operation.hold != null ? stepNote(stage, f, v.operation.index) : null;
    const at = `${f.index + 1} / ${f.count}`;
    if (kind === 'tune') {
      const c = tuneChange(stage, f.index);
      return {
        title: `れんしゅう ${v.epoch ?? 1} / 12 · 「${stage.label}」を ちょうせい`,
        body: step ?? '届いた「はずれの知らせ」に合わせて、この部屋の道具の目もり（重み）を、はずれが減る向きへ少しずつ動かします（勾配降下）。矢印が動かす向き、うすい印が動かす前の高さです。棒はこの部屋の重みのうち先頭の24個で、1周分の調整の前と後を見せています。1例ごとの計算をすべて再生しているわけではありません。',
        detail: `${at} 組め · いちばん動いた重み ${c.index + 1}：${c.before.toFixed(4)} → ${c.after.toFixed(4)}`,
      };
    }
    const [title, body] = steps[kind === 'add' ? (v.operation.index === 0 ? 'add0' : 'add3') : kind];
    return { title, body: step ?? body, detail: `${at}：${readout(stage, f)}` };
  }
  if (v.phase === 'probs' && v.share != null && v.share < 1) return { title: '点を 確率に なおす', body: '⑥でつけた点を、全部足すと100%になる割合（確率）に直します。点が高い文字ほど、大きな割合をもらいます（softmax）。選び方チップが「温度」のときは、ここで割合のかたよりを強めたり弱めたりします。', detail: '表示は上位5つ。ルーレットにはすべての候補が乗ります。' };
  const t = v.courier;
  const tokens = t?.tokens ?? (t?.token != null ? [t.token] : []);
  if (tokens.length) {
    const pack = tokens.length > 1 ? .3 : .2;
    const action = t.k < pack ? 'かばんに しまう' : t.k > 1 - pack ? '机に ならべる' : 'かばんで 運ぶ';
    const what = tokens.length > 1 ? `${tokens.length}まいの 札` : `「${name(tokens[0])}」`;
    const from = (t.froms?.[0] ?? t.from).lane;
    return { title: `${what}を ${action}`,
      body: from === 'candidates' ? 'ルーレットで選ばれた文字を、返事の部屋へ運びます。出した文字は文脈にも加わり、その次の文字を考える手がかりになります。'
        : from === 'work' ? '点の高かった文字を、候補の部屋へ運びます。そこで点を確率に直します。'
        : from === 'output' ? 'いま出した文字を文脈に加えます。次の文字は、この文字も見て決めます。'
        : '聞いたことばを1文字ずつの札にして、文脈の部屋に順番どおり並べます。「だれが話したか」「どこで交代したか」も札になっています。',
      detail: v.attentionFocus != null ? `この位置を見る割合：${(v.attention.weights[v.attentionFocus] * 100).toFixed(2)}%` : '札の1まいが、計算の単位（トークン）です。' };
  }
  if (v.packet) return { title: '計算した数を 次の部屋へ', body: '前の部屋でできた数をかばんに入れて運び、次の部屋の材料にします。', detail: `${v.packet.length}個の数。金色はプラス、青はマイナスです。` };
  if (v.phase === 'pick') return { title: '確率に したがって えらぶ', body: 'いちばん確率が高い文字に決め打ちせず、確率の幅に合わせたルーレットで選びます。', detail: '選ばれた札は、コトが返事の部屋へ運びます。' };
  if (v.endText) return { title: v.endText, body: 'この返事の計算が終わりました。眠っておぼえた重みは保存され、次の会話でも使われます。', detail: '' };
  return { title: v.mode === 'learn' ? '聞いた会話を 思い出す' : v.mode === 'explore' ? '頭の中の 部屋を 見てまわる' : '届いた ことばを 受けとる',
    body: v.mode === 'explore' ? '①〜⑥の部屋の机には、眠っておぼえた重みの一部が置いてあります。回転・移動・ズームで好きな部屋をのぞけます。' : 'ことばは左手前の部屋に届き、①から⑥の部屋を順番に通って、候補、ルーレット、返事の部屋へ進みます。コトが作業を始めると、その部屋の机に寄ります。',
    detail: '説明を隠しても、同じ数と動きを再生します。' };
}
