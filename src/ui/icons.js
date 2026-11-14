// 絵のボタンに使う SVG。文字の代わりに絵で伝える。

const svg = (body, view = '0 0 32 32') => `<svg viewBox="${view}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  dice: svg('<rect x="5" y="5" width="22" height="22" rx="5" fill="#f4e5bf"/><g fill="currentColor" stroke="none"><circle cx="11" cy="11" r="2"/><circle cx="21" cy="11" r="2"/><circle cx="16" cy="16" r="2"/><circle cx="11" cy="21" r="2"/><circle cx="21" cy="21" r="2"/></g>'),
  basket: svg('<path d="M5 13h22l-3 14H8Z" fill="#ead2a0"/><path d="m10 13 6-9 6 9M11 17v6m5-6v6m5-6v6"/>'),
  link: svg('<circle cx="7" cy="8" r="4" fill="#dce8ba"/><circle cx="25" cy="9" r="4" fill="#dce8ba"/><circle cx="16" cy="25" r="4" fill="#dce8ba"/><path d="m10 10 4 11m8-9-4 9M11 8h10"/>'),
  empty: svg('<path d="M5 7h22v15H15l-6 5v-5H5Z" fill="#fff"/>'),
  // 話す（吹き出し）
  talk: svg('<path d="M5 8a4 4 0 0 1 4-4h14a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4h-8l-6 6v-6a4 4 0 0 1-4-4Z" fill="#fff"/><path d="M11 12.5h.01M16 12.5h.01M21 12.5h.01" stroke-width="3.2"/>'),
  // 聞きに行く（耳）
  listen: svg('<path d="M9 13a7.5 7.5 0 1 1 15 0c0 5-4.5 5.5-4.5 9.5a4.2 4.2 0 0 1-8 1.6" fill="#fff"/><path d="M13 13.5a3.5 3.5 0 1 1 6.2 2.2c-1 1.2-2.2 1.3-2.2 3"/><path d="M4 9c-1.2 2.3-1.2 5 0 7.3M27.5 4.5c.8 1 1.3 2 1.6 3.2" stroke-width="2"/>'),
  // 眠る（月と星）
  sleep: svg('<path d="M20 4.5A11.5 11.5 0 1 0 27.5 21 9.5 9.5 0 0 1 20 4.5Z" fill="#fff"/><path d="m25 6 .8 2.2L28 9l-2.2.8L25 12l-.8-2.2L22 9l2.2-.8Z" fill="currentColor" stroke-width="1"/>'),
  // 頭の中を見る（虫めがね）
  explore: svg('<circle cx="14" cy="14" r="8.5" fill="#fff"/><path d="m20.5 20.5 7 7" stroke-width="3.4"/><path d="M10.5 14h.01M14 14h.01M17.5 14h.01" stroke-width="2.6"/>'),
  // 設定（歯車）
  gear: svg('<path d="M13.6 3h4.8l.7 3.3 2.3 1.3 3.2-1 2.4 4.1-2.5 2.3v2.6l2.5 2.3-2.4 4.1-3.2-1-2.3 1.3-.7 3.3h-4.8l-.7-3.3-2.3-1.3-3.2 1L5 17.9l2.5-2.3V13L5 10.7l2.4-4.1 3.2 1 2.3-1.3Z" fill="#fff"/><circle cx="16" cy="14.3" r="3.6"/>', '0 -1.7 32 32'),
  pause: svg('<path d="M11 7v18M21 7v18" stroke-width="4.5"/>'),
  play: svg('<path d="M10 6.5v19l15-9.5Z" fill="currentColor"/>'),
  // コマ送り（1 手順だけ進める）
  step: svg('<path d="M7 7v18l12-9Z" fill="currentColor"/><path d="M24 7v18" stroke-width="4"/>'),
  // 家にもどる
  home: svg('<path d="M4.5 15 16 5l11.5 10" /><path d="M7.5 13.5V26h17V13.5" fill="#fff"/><path d="M13.5 26v-7h5v7"/>'),
  // 送る（話しかける）
  send: svg('<path d="M4.5 16 27 5.5 21 27l-5-8.5Z" fill="currentColor" stroke-width="1.8"/><path d="M16 18.5 27 5.5" stroke="#fff" stroke-width="1.6"/>'),
  // お手本（本）
  book: svg('<path d="M16 8c-3-2.2-7-2.5-11-1.5v17c4-1 8-.7 11 1.5 3-2.2 7-2.5 11-1.5v-17c-4-1-8-.7-11 1.5Z" fill="#fff"/><path d="M16 8v17"/>'),
  // 出かける（足あと）
  walk: svg('<ellipse cx="11" cy="10" rx="3.6" ry="5.2" fill="currentColor" stroke="none" transform="rotate(-12 11 10)"/><circle cx="12.5" cy="19" r="2.3" fill="currentColor" stroke="none"/><ellipse cx="21" cy="17" rx="3.6" ry="5.2" fill="currentColor" stroke="none" transform="rotate(12 21 17)"/><circle cx="19.5" cy="26" r="2.3" fill="currentColor" stroke="none"/>'),
  // 話す人（色は currentColor）
  person: svg('<circle cx="16" cy="11" r="6.5" fill="currentColor" stroke="none"/><path d="M5 29c0-7 4.5-10.5 11-10.5S27 22 27 29Z" fill="currentColor" stroke="none"/>'),
  close: svg('<path d="m8 8 16 16M24 8 8 24" stroke-width="3"/>'),
  music: svg('<path d="M12 23V7l13-3v16"/><circle cx="8.5" cy="23" r="3.5" fill="currentColor"/><circle cx="21.5" cy="20" r="3.5" fill="currentColor"/>'),
  sfx: svg('<path d="M5 12.5h5l7-6v19l-7-6H5Z" fill="currentColor"/><path d="M21.5 11.5a6.5 6.5 0 0 1 0 9M25 8a11.5 11.5 0 0 1 0 16"/>'),
  skip: svg('<path d="M5 7.5v17l10-8.5ZM16 7.5v17l10-8.5Z" fill="currentColor" stroke-width="1.5"/>'),
  turtle: svg('<path d="M6 20a9 9 0 0 1 18 0Z" fill="currentColor"/><circle cx="26.5" cy="16.5" r="2.6" fill="currentColor"/><path d="M9 21v4M21 21v4M4 21h2"/>'),
  rabbit: svg('<ellipse cx="14" cy="21" rx="9" ry="6" fill="currentColor"/><circle cx="23.5" cy="15.5" r="4.2" fill="currentColor"/><path d="M22 12c-1.5-4-1.5-7 0-8 1.8 1 2.8 4 2.6 7.5" fill="currentColor"/><circle cx="4.8" cy="20" r="1.8" fill="currentColor"/>'),
};

// 絵だけのボタンを作る。label は読み上げとツールチップに使う
export function iconButton(icon, label, className = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `icon-button ${className}`.trim();
  b.innerHTML = ICONS[icon];
  b.setAttribute('aria-label', label);
  b.title = label;
  return b;
}
