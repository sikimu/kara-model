// セーブとロード。localStorage の 1 つのキーに、整合した 1 組（構成・語彙・原本・本・学習待ち・進行）をまるごと置く。
// 書き込みに失敗したら false を返す（握りつぶさない）。壊れた保存は勝手に消さず、読み込み側へ知らせる。

import { FORMAT_VERSION, validConfig, validLimits } from './model/config.js';

const KEY = 'kara-model-save';
const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);

function shapeOk(data) {
  return isObject(data) && data.formatVersion === FORMAT_VERSION && Number.isInteger(data.revision)
    && validConfig(data.config) && validLimits(data.limits)
    && isObject(data.vocabulary) && Array.isArray(data.vocabulary.entries)
    && isObject(data.parameters) && isObject(data.parameters.params) && Object.values(data.parameters.params).every(v => typeof v === 'string')
    && isObject(data.conversationBook) && Array.isArray(data.conversationBook.conversations)
    && Array.isArray(data.pendingLessons) && isObject(data.progress);
}

// data は model.snapshot()。成功したら true
export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

// { status: 'none' | 'ok' | 'invalid' | 'old', data }
export function load() {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { return { status: 'none' }; }
  if (raw == null) return { status: 'none' };
  try {
    const data = JSON.parse(raw);
    if (isObject(data) && data.version === 1) return { status: 'old', data }; // 旧形式（チップ方式）。消去は了承済み
    return shapeOk(data) ? { status: 'ok', data } : { status: 'invalid', data };
  } catch {
    return { status: 'invalid' };
  }
}

export function clear() {
  try { localStorage.removeItem(KEY); } catch { /* 何もしない */ }
}

// 保存容量のめやす（文字数）。設定画面などで示す
export function sizeOf(data) { return JSON.stringify(data).length; }
