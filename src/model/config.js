// コトを作るときに決める構成と上限。検証済みの組み合わせだけを一覧で持つ（個別値の直積にしない）。
// 数値の根拠は docs/model-settings.md と docs/benchmark-results.md。候補値のうち「仮」はゲーム統合後の実測で見直す。

export const FORMAT_VERSION = 2;      // 保存形式の版
export const SEGMENTER_VERSION = 'grapheme-1'; // 「1文字」の区切り方の版（Intl.Segmenter の書記素）

// 独立検証済みの構成（文脈／次元／層／ヘッド／MLP幅）。先頭が初期値。
export const PRESETS = [
  { id: 'a', window: 128, dim: 48, layers: 3, heads: 3, hidden: 96, label: '文脈128・48次元・3層3ヘッド', note: 'はじめての初期値。PCで計算・保存・復元を確認済み' },
  { id: 'b', window: 256, dim: 96, layers: 3, heads: 3, hidden: 192, label: '文脈256・96次元・3層3ヘッド', note: '計算も保存容量も約4倍。長い文脈では返事に時間がかかる（PCで確認済み、スマホは未確認）' },
];

// 会話の本に残す会話の数（仮の候補。容量の実測で見直す）
export const CONVERSATION_LIMITS = [10, 30, 100];
// 机の勉強で登録できる「まとまり」の数（仮の候補）。文字と目印は別枠で、この数に入れない
export const MERGE_LIMITS = [32, 128, 512];
export const DEFAULT_LIMITS = { conversations: 30, merges: 128 };

// 文字（1文字の札）の枠。利用者は選ばない。到達したら原文を失わず、処理を始めずに知らせる
export const CHAR_CAPACITY = 1500;
// 学習待ち（かご）にためられる会話の数
export const PENDING_CAPACITY = 20;
// まとまり探しの条件（仮）。同じ教材内で2回以上並んだ組を、1回の勉強で最大4つ追加する。まとまりは6文字まで
export const STUDY = { minCount: 2, perStudy: 4, maxChars: 6 };
// 学習率・勾配クリップ・1回の睡眠で回す周回数。1系列ごとに損失を平均して更新するので、
// 1位置ごとに更新していた旧実装（.035）より大きい値にする（仮。数会話×12周で返事が変わる程度）
export const TRAINING = { rate: .25, clip: 1, epochs: 12 };
// 返事の最大トークン数
export const MAX_OUTPUT = 30;

export function presetOf(id) { return PRESETS.find(p => p.id === id) ?? null; }

export function validConfig(c) {
  return !!c && PRESETS.some(p => ['window', 'dim', 'layers', 'heads', 'hidden'].every(k => p[k] === c[k]));
}
export function validLimits(l) {
  return !!l && CONVERSATION_LIMITS.includes(l.conversations) && MERGE_LIMITS.includes(l.merges);
}
