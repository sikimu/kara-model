// セーブとロード。localStorage に 1 つのキーで保存する。

const KEY = 'kara-model-save';
const VERSION = 1;

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValid(data) {
  return isPlainObject(data)
    && data.version === VERSION
    && isPlainObject(data.store)
    && Object.values(data.store).every((row) => isPlainObject(row)
      && Object.values(row).every((n) => Number.isInteger(n) && n > 0))
    && Array.isArray(data.shortMemory)
    && data.shortMemory.every((s) => typeof s === 'string')
    && (data.stats === undefined
      || (isPlainObject(data.stats) && Number.isInteger(data.stats.sleeps)));
}

export function save(model) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, ...model.snapshot() }));
  } catch {
    // 保存できなくても遊べるようにする
  }
}

// 読み込めなければ null（空の状態で始める）
export function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    return isValid(data) ? data : null;
  } catch {
    return null;
  }
}

export function clear() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 何もしない
  }
}
