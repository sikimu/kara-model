// 記録された計算の、表示専用の説明。別のモデルで計算し直さない。DOM にも three.js にも触れない。
import { tokenLabel } from '../model/vocabulary.js';

// 入室ごとに 1 回だけ説明する。同じ部屋でも層が変われば入室とみなす。別の部屋へ移ったらリセット
export function createVisitGuide() {
  let room = null, explained = false;
  const keyOf = (address, layer) => {
    const base = address.lane === 'work' ? `work${address.index ?? 0}`
      : ['attention', 'sorting'].includes(address.lane) ? 'context'
      : ['entrance', 'heard'].includes(address.lane) ? 'entrance'
      : address.lane === 'candidates' ? 'roulette' : address.lane;
    return layer != null ? `${base}@${layer}` : base;
  };
  return {
    reset() { room = null; explained = false; },
    enter(address, layer = null) { const next = keyOf(address, layer); if (next !== room) { room = next; explained = false; } },
    take() { if (explained) return false; explained = true; return true; },
  };
}

const name = tokenLabel;
const pct = p => `${(p * 100).toFixed(1)}%`;

export function rouletteTurn(k, r) { return (3 + r) * (1 - (1 - Math.max(0, Math.min(1, k))) ** 3); }
export function rouletteSector(rows, r) {
  let sum = 0;
  for (const row of rows) { sum += row.p; if (r < sum) return row; }
  return rows.at(-1);
}

// 部屋ごとの詳しい説明（「くわしい仕組みと数字」）。d・層・ヘッドは保存された構成に合わせる
export function roomNote(stage, config, layerText) {
  const d = config.dim, kind = stage.kind ?? 'tune';
  if (kind === 'add' && stage.room === 0) return ['① 文字を 数に する', `文字の本には文字ごとに${d}個の数が、順番の本には何番めかごとに${d}個の数が記録されています。札ごとに対応する行を写し、同じ位置どうしで足して${d}個のページにします（並べて${d * 2}個にするのではありません）。全部の札をページにして、作業用バインダーに綴じます。`];
  if (kind === 'match') return [`② どの札を見るか 見くらべる${layerText}`, `バインダーの各ページに②の本（Q と K の表）を掛け、いちばん後ろの位置から見て、どの位置の札が手がかりになるかを数にします。割合に直すと合計100%になり、これが「見る割合」です。未来（後ろ）の位置は見ません。ヘッドが${config.heads}つあり、それぞれ別の見かたで割合を作ります。`];
  if (kind === 'mix') return [`③ 見る割合で まぜる${layerText}`, `各ページに③の本（V の表）を掛けた数を、見る割合ぶんだけ取って足し合わせます。ヘッドごとの結果をつなげ、O の表で整えて${d}個にします。`];
  if (kind === 'add') return [`④ もとの数に たしなおす${layerText}`, `③の結果を、この層の入力（1層めなら①のページ、2層め以降は前の層の出力）に足します。もとの情報を消さずに上乗せするこの足し算が残差接続です。`];
  if (kind === 'gate') return [`⑤ しぼって 特徴を とり出す${layerText}`, `④の結果を⑤の本（F1）で${stage.before?.length ?? config.hidden}個に広げ、しぼり機（GELU）を通してから F2 で${d}個に戻し、もう一度④の結果に足します。これがこの層の出力で、次の層の入力になります。`];
  if (kind === 'score') return ['⑥ 札ごとに 点を つける', `最後の層の出力${d}個と、出力の本にある札ごとの${d}個を掛けて足し、点にします。点が高い札ほど次に来やすい札です。このあと点を確率に直してルーレットで 1 つ選びます。`];
  return [stage.label ?? '原本を 書き直す', '学習では、はずれを小さくする向きに原本の数を少しずつ動かします。'];
}

export function explainNeural(v, config = { dim: 48, layers: 3, heads: 3, hidden: 96 }) {
  if (v.holdNote) return v.holdNote;
  const d = config.dim;
  if (v.arrange) {
    const a = v.arrange, token = a.tokens[a.index];
    return { title: 'ならべる 部屋', body: `${a.offset + a.index + 1}番に「${name(token)}」を置きます。左から右へ、聞いた順を保ちます。あいうえお順に並べ替える作業ではありません。`, detail: '同じ札でも、何番めにあるかで前後のつながりが変わります。' };
  }
  if (v.registering) return { title: '文字の本に ページを 足す', body: `「${v.registering.tokens.map(name).join('」「')}」のページを足しました。${d}個の数は小さなでたらめの値から始めます。`, detail: '登録は学習ではありません。文字はまとまりの登録枠に数えません。' };
  if (v.studyRound) return { title: 'となり合う札の組を 数える', body: '本に残っている会話を読み返し、となり合う 2 まいの組が何回出るかを数えます。コト自身が作った返事は数えません。', detail: `いま多い組: ${v.studyRound.candidates.slice(0, 3).map(c => `「${c.a}${c.b}」${c.count}回`).join('、') || 'なし'}` };
  if (v.merging) return { title: `「${v.merging.text}」を ひとまとまりに`, body: `「${v.merging.parts[0]}」の次に「${v.merging.parts[1]}」が ${v.merging.count} 回ならんでいました。1 まいの札として読めるように、文字の本にページを足します。`, detail: '意味を覚えたのではなく、よく出る並びをひとまとまりで読めるようにしただけです。' };
  if (v.quiz && !v.operation && !v.errorNote) {
    const q = v.quiz, said = q.context.map(name).join('');
    return { title: `れんしゅう ${v.epoch ?? 1} / ${v.epochs ?? 12} · 次の札を 当ててみる`,
      body: `聞いた会話の途中「${said}」までを見て、次の札を予想しました。正解は「${name(q.answer)}」です。正解に付けた確率が低いほど「はずれ」が大きい、と数えます。このはずれを小さくするのが学習です。`,
      detail: `正解「${name(q.answer)}」に付けた確率 ${pct(q.p)} → はずれ ${pct(1 - q.p)}` };
  }
  if (v.errorNote && v.courier && !v.operation) return { title: 'はずれの知らせを 前の部屋へ',
    body: '⑥の部屋から①の部屋へ、計算とは逆向きに、はずれの知らせを運びます。部屋ごとに「本のどの数をどちら向きにどれだけ動かせば、はずれが減るか」を計算し、原本を書き直して棚へ戻します（誤差逆伝播）。',
    detail: `見本の正解以外に付けた確率 ${pct(v.errorNote.size)}。表示する数は各周の学習前後の実際の値で、1 周ぶんの更新をまとめています。` };
  if (v.lottery && v.phase === 'pick') {
    const selected = rouletteSector(v.rows, v.lottery.r);
    return { title: v.lottery.k < 1 ? 'ルーレットで 次の札を えらぶ' : `「${name(selected.token)}」に 止まった`,
      body: '盤の区切りの幅は、それぞれの札の確率です。広い区切りほど当たりやすく、せまい区切りもたまに当たります。だから同じことばを聞いても、返事が毎回同じとは限りません。',
      detail: v.lottery.k < 1 ? '針が止まる場所は、計算のときに引いた乱数で決まっています。回している間に引き直しはしません。' : `乱数 ${v.lottery.r.toFixed(4)} · この札の確率 ${(selected.p * 100).toFixed(2)}%` };
  }
  if (v.operation) {
    const stage = v.stages[v.operation.index], kind = stage.kind ?? 'tune';
    const layerText = stage.layer != null ? `（${stage.layer + 1}層め / ${config.layers}）` : '';
    if (kind === 'tune') {
      return { title: `れんしゅう ${v.epoch ?? 1} / ${v.epochs ?? 12} · 「${stage.label}」を 書き直す`,
        body: '原本の数は、計算に使う調節できる数です。はずれが減る向きに、この本の数をまとめて少しずつ書き直し、本を棚へ戻します。',
        detail: `表示している ${stage.values.length}個は原本の一部（抜粋）。この本全体では平均 ${stage.moved?.toExponential(2) ?? '—'} 動きました。` };
    }
    const [title, body] = roomNote(stage, config, layerText);
    const where = kind === 'match' || kind === 'mix' ? `ヘッド ${((v.head ?? 0) % (stage.heads?.length ?? 1)) + 1} を表示中。` : '';
    return { title, body, detail: `${where}数値は本やバインダーを押して開き、ページの数にマウスを乗せる／タップで見られます。作業用バインダーは右下からも開けます。` };
  }
  if (v.phase === 'probs' && v.share != null && v.share < 1) return { title: '点を 確率に なおす', body: '⑥でつけた点を、全部足すと100%になる割合（確率）に直します。点が高い札ほど大きな割合をもらいます（softmax）。', detail: '表示は上位5つ。ルーレットにはすべての候補が乗ります。' };
  const t = v.courier;
  const tokens = t?.tokens ?? (t?.token != null ? [t.token] : []);
  if (tokens.length) {
    const pack = tokens.length > 1 ? .3 : .2;
    const action = t.k < pack ? '手に 取る' : t.k > 1 - pack ? '机に 置く' : '手に持って 運ぶ';
    const what = tokens.length > 1 ? `${tokens.length}まいの 札` : `「${name(tokens[0])}」`;
    const from = (t.froms?.[0] ?? t.from).lane, to = (t.tos?.[0] ?? t.to)?.lane;
    return { title: `${what}を ${action}`,
      body: from === 'candidates' ? 'ルーレットで選ばれた札を、返事の部屋へ運びます。出した札は文脈にも加わり、その次を考える手がかりになります。'
        : from === 'work' ? '点の高かった札を、ルーレットへ運びます。点を確率に直し、その割合の幅に広げてから回します。'
        : from === 'output' ? 'いま出した札を文脈に加えます。次の札は、この札も見て決めます。'
        : to === 'work' ? '並べた札をまとめて①の装置へ持っていきます。装置で札はページに変わり、作業用バインダーに綴じられます。'
        : '聞いたことばを札にして、ならべる部屋へ順番どおり運びます。「だれが話したか」「どこで交代したか」も札になっています。',
      detail: '札の 1 まいが、計算の単位（トークン）です。' };
  }
  if (v.carrying && t) return { title: v.carrying === 'note' ? 'はずれの知らせを 持って 次の部屋へ' : '作業用バインダーを 持って 次の部屋へ', body: v.carrying === 'note' ? '計算を逆にたどりながら、各部屋の本を書き直します。' : '前の部屋で書き直した現在の情報を、バインダーに綴じたまま次の部屋へ運びます。原本は棚に残ります。', detail: `バインダーには ${v.binderPages ?? 0}ページ。` };
  if (v.phase === 'pick') return { title: '確率に したがって えらぶ', body: 'いちばん確率が高い札に決め打ちせず、確率の幅に合わせたルーレットで選びます。', detail: '選ばれた札は、コトが返事の部屋へ運びます。' };
  if (v.endText) return { title: v.endText, body: v.mode === 'study' ? 'まとまり探しが終わりました。結果は机の本から見られます。' : 'この返事の計算が終わりました。眠っておぼえた原本は保存され、次の会話でも使われます。', detail: '' };
  return { title: v.mode === 'learn' ? '聞いた会話を 思い出す' : v.mode === 'explore' ? '頭の中の 部屋を 見てまわる' : v.mode === 'study' ? 'ことばの まとまり探し' : '届いた ことばを 受けとる',
    body: v.mode === 'explore' ? '①〜⑥の部屋の棚には原本の本があり、押すと中身を見られます。回転・移動・ズームで好きな部屋をのぞけます。' : v.mode === 'study' ? '本に残っている会話を読み返し、よく出る札の並びをひとまとまりにします。' : 'ことばは玄関のポストに届き、①から⑥の部屋を順番に通って、ルーレット、返事の部屋へ進みます。',
    detail: `構成: 文脈${config.window ?? '—'}・${d}次元・${config.layers}層${config.heads}ヘッド。説明を隠しても、同じ数と動きを再生します。` };
}
