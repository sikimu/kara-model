// 初めて見る人向けの説明。計算の記録と詳しい数値は別に保持する。DOM に触れない。
import { tokenLabel } from '../model/vocabulary.js';
const name = tokenLabel;
export const glossary = {
  '文字に対応する数': 'このコトには、文字・まとまり・会話の目印ごとに d 個（初期構成では48個）の数の組があります。札の番号でその組を取り出します。番号は表の場所を指すだけで、数の組とは別です。数の組は最初はでたらめな値で、学習で調整されます。1 個ずつの数に特定の文字や意味が割り当てられているわけではありません。',
  '原本': '棚にある本。学習で調整して保存する数（パラメータ）の正本です。推論では持ち出さず、必要な行だけをバインダーへ写します。学習のときだけ、机で書き直して棚へ戻します。',
  '作業用バインダー': '今回の計算に必要な情報だけを綴じたもの。①で写した元の情報と、部屋を通るごとに書き直す現在の情報があります。計算が終わると用済みになり、原本には残りません。',
  '数の箱': '箱（棒）1 本が 1 つの数です。文字や文の情報は、いくつもの数を組み合わせて表します。箱 1 個に「猫」「うれしい」のような決まった意味があるとは限りません。',
  '文字の札': 'ことばを小さく分けたものです。はじめは 1 文字が 1 まい。勉強で「よく出る並び」をまとまりとして登録すると、複数の文字が 1 まいになることもあります。この 1 まいを専門用語でトークンと呼びます。',
  '手がかり': '続きの札を考えるときに参考にする情報です。たとえば「おはよ」まで来たら、その並びが次の「う」を考える手がかりになります。必ず「う」になるわけではありません。',
  '練習で直す数': '練習するたびに少しずつ調整する、原本の数です。会話をそのまましまうのではなく、ことばの続き方を数に反映します。専門用語では重みと呼びます。',
  '確率': 'どれくらい選ばれやすいかを表す割合です。たとえば25%は、ルーレットの4分の1の広さ。4回まわせば必ず1回当たる、という意味ではありません。',
  '見る割合': '前のことばのどこを、どれくらい参考にするかです。次の札として選ばれる確率とは別です。まだ練習が少ないと、役に立つ場所をうまく選べません。',
  '層': '同じ形の作業（②〜⑤）を重ねた段数です。前の層の出力が次の層の入力になります。層ごとに別の原本の本を使います。',
  'ヘッド': '②③で、別々の見かたで見る割合を作る組の数です。ヘッドごとに決まった役割があるとは限りません。',
};

export function simpleGuide(v, info, config = { dim: 48, layers: 3, heads: 3 }) {
  const d = config.dim;
  const stage = v.operation && v.stages?.[v.operation.index], kind = stage?.kind ?? (stage ? 'tune' : null);
  const guide = (body, picture, captions, tokens = []) => ({ title: info.title, body, picture, captions, tokens });
  if (kind) {
    const layer = stage.layer != null ? `${stage.layer + 1}層め。` : '';
    const texts = {
      add: stage.room === 0 ? '文字の札を、計算に使える数のページに置きかえます。「どの札か」と「何番めか」の両方を入れて、作業用バインダーに綴じます。' : `${layer}前のことばから集めた手がかりを、もとの情報に足します。もとの情報も残ります。`,
      match: `${layer}次の札を考えるために、前のことばを見直します。どこを多く参考にするか、「見る割合」を決めます。`,
      mix: `${layer}前のことばから手がかりを集めます。「見る割合」が大きい札からは多く、小さい札からは少し受け取ります。`,
      gate: `${layer}集めた手がかりを、原本の数で組み合わせ直します。これで、単に足すだけでは表せないことばのつながりも扱えます。`,
      score: '続きになりそうな札に点をつけます。点が高いほど選ばれやすくなりますが、まだ答えは決まりません。',
      tune: stage.tokens?.length
        ? `「${[...new Set(stage.tokens)].map(name).join('」「')}」に使う原本の数を直します。${stage.parameter === 'out' ? 'この数は、その札を返事の続きとして選ぶ点をつけるときに使います。' : 'この数は、その札を計算の材料にするときに使います。'}直した本は棚へ戻し、次の会話でも使います。`
        : `${layer}どの札にも共通で使う原本の数を直します。この部屋の本は、${['札を計算の材料にする', '前のことばのどこを参考にするか決める', '前のことばから集める情報を作る', '', '手がかりを組み合わせる', '次の札の候補に点をつける'][stage.room]}ために使います。直した本は棚へ戻し、次の会話でも使います。`,
    };
    const captions = { add: ['札と順番', '写して足す', 'バインダーへ'], match: ['前のことば', '見直す', '見る割合'], mix: ['それぞれの情報', '集める', '手がかり'], gate: ['手がかり', '組み合わせる', '新しい手がかり'], score: ['手がかり', '点をつける', '続きの候補'], tune: ['答えと比べる', '本を書き直す', '棚へ戻す'] };
    const result = guide(texts[kind], kind, captions[kind], [...new Set(stage.sourceTokens ?? stage.tokens ?? [stage.token])].filter(Boolean).slice(-5).map(name));
    const boxes = {
      add: stage.room === 0 ? '机の左が文字の本・順番の本、右が作業用バインダーです。本から数を写して足し、文字と順番を見出しにしたページへ記録します。' : 'バインダーに残した元の情報と、集めた情報を足してページを書き直します。',
      match: 'どの札をどれくらい参考にするかを計算し、バインダーへ記録します。',
      mix: '参考にする割合に合わせて情報を集め、バインダーのページを書き直します。',
      gate: '本を参照して情報を変換し、次へ渡す情報をバインダーへ記録します。',
      score: '出力の本を参照して、次の札の候補に点をつけます。',
      tune: '計算した調整を原本のページに書き込みます。書き直した本は棚へ戻します。',
    };
    result.body = `${boxes[kind]}\n${result.body}`;
    result.title = { add: stage.room === 0 ? '札を数のページにして綴じる' : 'もとの情報も残す', match: '前のことばを見直す', mix: '手がかりを集める', gate: '手がかりを組み合わせる', score: '続きの候補に点をつける', tune: '原本を書き直して棚へ戻す' }[kind];
    if (kind === 'add' && stage.room === 0) {
      const token = name(stage.sourceToken ?? stage.token);
      result.title = `文字の本から「${token}」の行を写す`;
      result.body = `文字の本には、文字ごとに${d}個の数がひと組で記録されています。この組は、次の札を考える計算に使うものです。受け取った札「${token}」に対応する組を作業用バインダーへ写し、さらに「${stage.position + 1}番め」を表す順番の本の${d}個を足します。\n1 個の数が 1 文字を表すわけではありません。`;
      result.picture = 'embedding';
      result.captions = ['文字の札', `対応する${d}個`, '順番の数を足す'];
      result.tokens = [token];
      result.embedding = stage.a;
    }
    return result;
  }
  if (v.arriving) return guide('あなたのことばがポストに届きました。元のことばはここに残し、文字の札にした写しを運びます。', 'mail', ['あなたのことば', 'ポストに届く', '写しを運ぶ']);
  if (v.arrange) return guide('文字の札を、聞いた順に置きます。「ねこ」と「こね」では、順番が変わるとことばも変わります。いっぱいになったら重ねて残します。', 'order', ['ね → こ', '順番を保つ', '重ねて残す'], v.arrange.tokens.slice(0, 5).map(name));
  if (v.registering) return guide('はじめて見た文字のページを文字の本に足します。これは登録で、まだ何も学習していません。', 'book', ['はじめての文字', 'ページを足す', 'これから学ぶ'], v.registering.tokens.map(name));
  if (v.studyRound || v.merging) return guide('本の会話を読み返し、となり合う札の組を数えます。何度も出る組は、1 まいの札として読めるようにします。', 'book', ['会話を読む', '組を数える', 'ひとまとまりに'], v.merging ? [v.merging.text] : []);
  if (v.quiz) return guide('会話の続きを予想して、お手本の答えと比べます。間違いを減らせるように、このあと原本の本を書き直します。', 'tune', ['続きを予想', 'お手本と比べる', '本を直す']);
  if (v.errorNote) return guide('答えとのずれを、前の部屋へ知らせます。どの本のどの数をどう直すか、計算をさかのぼって調べます。', 'tune', ['答えとのずれ', '前へ知らせる', '本を直す']);
  if (v.phase === 'probs' || v.phase === 'pick') return guide(v.phase === 'probs' ? '候補の点を、選ばれやすさを表す確率に変えます。確率が大きい札ほど、ルーレットの場所が広くなります。' : 'ルーレットで次の札を1つ選びます。広い場所ほど当たりやすいですが、狭い場所にも当たることがあります。', 'wheel', ['候補の点', '広さに変える', '1つ選ぶ']);
  if (v.phase === 'emit' || v.endText) return guide('選んだ札を返事につけ足します。返事の続きも、同じように1まいずつ考えます。終わりの合図が出ると返事が完成します。', 'order', ['札を選ぶ', '返事に足す', '続きを考える'], (v.out ?? []).slice(-5).map(name));
  if (v.carrying) return guide(v.carrying === 'note' ? 'はずれの知らせを持って、前の部屋へ戻ります。' : '作業用バインダーを持って、次の部屋へ移ります。原本の本は棚に残ります。', 'book', ['バインダー', '持って移る', '次の部屋']);
  if (v.mode === 'explore') return guide('コトは、ことばの続きを1まいずつ考えて返事を作ります。部屋の棚の本を押すと原本を、右下からは作業用バインダーを見られます。', 'book', ['原本の本', 'バインダー', '返事']);
  if (v.mode === 'study') return guide('机の本で勉強を始めました。本に残っている会話から、よく出る札の並びを探します。', 'book', ['会話を読む', '組を数える', 'ひとまとまりに']);
  return guide('聞いたことばを手がかりに、続きの札を考える準備をしています。文字の札の写しを次の場所へ運びます。', 'order', ['聞いたことば', '写しを運ぶ', '次の準備']);
}

const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// アプリ内の図解。数値を再計算せず、作業の目的だけを絵にする。
export function guidePicture(g) {
  const text = (x, y, s, size = 14) => `<text x="${x}" y="${y}" text-anchor="middle" fill="#304b4a" font-size="${size}">${escape(s)}</text>`;
  const card = (x, y, s, fill = '#fff8e5') => `<rect x="${x - 17}" y="${y - 21}" width="34" height="42" rx="5" fill="${fill}" stroke="#b7a584"/>${text(x, y + 5, s, Math.min(14, 29 / Math.max(1, [...String(s)].length)))}`;
  const tokens = g.tokens.length ? g.tokens.slice(-3) : ['ね', 'こ'];
  const bars = x => [0, 1, 2].map(i => `<rect x="${x - 22 + i * 16}" y="${65 - i * 14}" width="12" height="${20 + i * 14}" rx="3" fill="#d8aa62"/>`).join('');
  const envelope = x => `<rect x="${x - 35}" y="33" width="70" height="46" rx="5" fill="#fff8e5" stroke="#b7a584" stroke-width="2"/><path d="m${x - 34} 35 34 25 34-25" fill="none" stroke="#b7a584" stroke-width="2"/>`;
  const book = (x, fill = '#9e5c4d') => `<rect x="${x - 30}" y="30" width="60" height="50" rx="4" fill="${fill}" stroke="#4a3a2a" stroke-width="2"/><rect x="${x - 24}" y="35" width="48" height="40" rx="2" fill="#fff8e5"/><path d="M${x - 16} 45h32M${x - 16} 55h32M${x - 16} 65h20" stroke="#b7a584" stroke-width="2"/>`;
  let drawing = ['gate', 'mix', 'score', 'wheel'].includes(g.picture) ? bars(80) : g.picture === 'book' ? book(80) : tokens.map((t, i) => card(44 + i * 37, 55, t)).join('');
  if (g.picture === 'embedding') {
    const cells = g.embedding.slice(0, 12).map((value, i) => {
      const x = 192 + (i % 4) * 39, y = 20 + Math.floor(i / 4) * 24;
      return `<rect x="${x - 18}" y="${y}" width="36" height="21" rx="4" fill="${value < 0 ? '#c6dfe9' : '#efd4a1'}"/>${text(x, y + 14, value.toFixed(2), 10)}`;
    }).join('');
    const more = g.embedding.length > 12 ? text(250, 108, `…ほか ${g.embedding.length - 12}個`, 11) : '';
    drawing = card(80, 55, tokens[0]) + cells + more + text(405, 48, `${g.embedding.length}個の数`) + text(405, 73, `＋ 順番の${g.embedding.length}個`, 12);
    return `<svg viewBox="0 0 490 135" role="img" aria-label="${escape(tokens[0] + 'に対応する' + g.embedding.length + '個の数に、順番の情報を足す')}" xmlns="http://www.w3.org/2000/svg"><rect width="490" height="135" rx="14" fill="#f4edda"/>${drawing}<path d="M115 56h40m-9-8 9 8-9 8M332 56h15m-9-8 9 8-9 8" fill="none" stroke="#7a9790" stroke-width="3"/>${g.captions.map((s, i) => text([80, 250, 405][i], 122, s)).join('')}</svg>`;
  }
  if (g.picture === 'mail') drawing = envelope(80) + `<rect x="208" y="27" width="84" height="62" rx="9" fill="#cc7a65"/><path d="M223 47h54" stroke="#5a4740" stroke-width="7"/><path d="M250 89v10" stroke="#816850" stroke-width="9"/>` + envelope(405);
  else if (g.picture === 'book') drawing += `<rect x="215" y="28" width="70" height="56" rx="4" fill="#3f6677" stroke="#243d47" stroke-width="2"/><rect x="226" y="34" width="52" height="44" rx="2" fill="#fff5dc"/><circle cx="220" cy="44" r="4" fill="#e8e8e0"/><circle cx="220" cy="56" r="4" fill="#e8e8e0"/><circle cx="220" cy="68" r="4" fill="#e8e8e0"/>` + card(405, 55, tokens.at(-1) ?? '次');
  else if (g.picture === 'match') drawing += '<circle cx="248" cy="48" r="23" fill="#b7dedb" stroke="#557b79" stroke-width="5"/><path d="m265 65 19 20" stroke="#557b79" stroke-width="8"/>' + bars(405);
  else if (g.picture === 'wheel') drawing += '<circle cx="250" cy="56" r="34" fill="#8fc6ba"/><path d="M250 56V22A34 34 0 0 1 284 56Z" fill="#efbb69"/><path d="M250 56 276 34" stroke="#b76150" stroke-width="4"/>' + card(405, 55, '次');
  else if (g.picture === 'tune' || g.picture === 'gate') drawing += '<path d="M218 37h64M218 57h64M218 77h64" stroke="#8faaa0" stroke-width="5"/><g fill="#e1a95f"><circle cx="238" cy="37" r="8"/><circle cx="266" cy="57" r="8"/><circle cx="248" cy="77" r="8"/></g>' + (g.picture === 'tune' ? book(405) : card(405, 55, '数'));
  else if (g.picture === 'mix') drawing += '<path d="M217 45h66q-4 42-33 42t-33-42" fill="#8fc6ba"/><circle cx="237" cy="34" r="7" fill="#e5b465"/><circle cx="264" cy="27" r="5" fill="#81b7ce"/>' + card(405, 55, '数');
  else if (g.picture === 'order') drawing += card(231, 55, tokens[0]) + card(270, 55, tokens.at(-1)) + text(231, 88, '1') + text(270, 88, '2') + card(401, 64, '') + card(405, 58, '') + card(409, 52, tokens.at(-1));
  else if (g.picture === 'add') drawing += book(250, '#bd944d') + `<rect x="383" y="30" width="44" height="50" rx="3" fill="#3f6677"/><rect x="390" y="35" width="32" height="40" rx="2" fill="#fff5dc"/>`;
  else drawing += bars(250) + (g.picture === 'score' ? card(388, 55, 'あ') + card(430, 55, 'い') : bars(405));
  return `<svg viewBox="0 0 490 135" role="img" aria-label="${escape(g.captions.join('、'))}" xmlns="http://www.w3.org/2000/svg"><rect width="490" height="135" rx="14" fill="#f4edda"/>${drawing}<path d="M154 56h33m-9-8 9 8-9 8M315 56h33m-9-8 9 8-9 8" fill="none" stroke="#7a9790" stroke-width="3"/>${g.captions.map((s, i) => text([80, 250, 405][i], 117, s)).join('')}</svg>`;
}
