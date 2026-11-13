// 音楽と効果音。音声ファイルは使わず、Web Audio API でその場で合成する。
// ブラウザの決まりで、最初のクリックやキー入力のあとから音が出る。

const KEY = 'kara-model-settings';
const DEFAULTS = { bgm: true, sfx: true, volume: 0.6 };

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) };
  } catch {
    return { ...DEFAULTS };
  }
}

const settings = loadSettings();
let ctx = null;
let master;
let bgmGain;
let sfxGain;
let noiseBuffer;

const midi = (m) => 440 * 2 ** ((m - 69) / 12);

function applySettings() {
  if (!ctx) return;
  master.gain.value = settings.volume;
  bgmGain.gain.value = settings.bgm ? 1 : 0;
  sfxGain.gain.value = settings.sfx ? 1 : 0;
}

function ensure() {
  if (ctx) return true;
  const AC = window.AudioContext ?? window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  bgmGain = ctx.createGain();
  sfxGain = ctx.createGain();
  bgmGain.connect(master);
  sfxGain.connect(master);
  master.connect(ctx.destination);
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  applySettings();
  setInterval(schedule, 100);
  return true;
}

function unlock() {
  if (ensure() && ctx.state === 'suspended') ctx.resume();
}
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

// ---- 音の部品 ----
function tone(freq, { type = 'sine', dur = 0.15, vol = 0.25, to = null, at = 0, dest = sfxGain } = {}) {
  const t = Math.max(ctx.currentTime, at || ctx.currentTime);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

function noise({ dur = 0.1, vol = 0.2, freq = 1500, q = 1, at = 0 } = {}) {
  const t = Math.max(ctx.currentTime, at || ctx.currentTime);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(sfxGain);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.03);
}

const now = () => ctx.currentTime;

// ---- 効果音 ----
const SFX = {
  mindWin: (sec = 0.3) => {
    [84, 88, 91].forEach((m, i) => tone(midi(m), { dur: sec * 0.35, vol: 0.12, at: now() + i * sec * 0.1 }));
    noise({ dur: sec * 0.15, vol: 0.07, freq: 4200, q: 2 });
  },
  mindLand: (sec = 0.3) => tone(520, { type: 'triangle', dur: sec * 0.25, vol: 0.1, to: 780 }),
  // もわもわ（頭の中へ切り替わる）
  moya: () => {
    [0, 1, 2].forEach((i) => tone(midi(72 + i * 4), { dur: 0.2, vol: 0.14, to: midi(77 + i * 4), at: now() + i * 0.14 }));
    noise({ dur: 0.7, vol: 0.07, freq: 700, q: 0.5, at: now() + 0.42 });
  },
  pet: () => [84, 88, 91].forEach((m, i) => tone(midi(m), { type: 'triangle', dur: 0.16, vol: 0.14, at: now() + i * 0.07 })),
  step: () => tone(170, { dur: 0.07, vol: 0.12, to: 90 }),
  hop: () => tone(420, { type: 'triangle', dur: 0.16, vol: 0.18, to: 840 }),
  pop: () => tone(900, { dur: 0.07, vol: 0.14, to: 1300 }),
  book: () => noise({ dur: 0.18, vol: 0.25, freq: 900, q: 0.8 }),
  bars: () => tone(330, { type: 'triangle', dur: 0.35, vol: 0.12, to: 660 }),
  dice: (sec = 0.3) => {
    const n = Math.max(3, Math.round(sec / 0.07));
    for (let i = 0; i < n; i++) noise({ dur: 0.04, vol: 0.3, freq: 2500 + Math.random() * 1500, q: 3, at: now() + i * (sec / n) });
  },
  pick: () => {
    tone(midi(84), { dur: 0.45, vol: 0.2 });
    tone(midi(91), { dur: 0.5, vol: 0.14, at: now() + 0.07 });
  },
  // ラッパから文字を出す。文字ごとに音の高さを変える
  toot: (token = '') => {
    const scale = [60, 62, 64, 67, 69, 72, 74, 76];
    const m = scale[(token.codePointAt(0) ?? 0) % scale.length];
    tone(midi(m), { type: 'square', dur: 0.2, vol: 0.09 });
    tone(midi(m + 12), { type: 'triangle', dur: 0.22, vol: 0.12 });
  },
  done: () => {
    tone(midi(79), { type: 'triangle', dur: 0.18, vol: 0.18 });
    tone(midi(84), { type: 'triangle', dur: 0.35, vol: 0.18, at: now() + 0.12 });
  },
  empty: () => tone(220, { dur: 0.4, vol: 0.18, to: 150 }),
  hear: () => tone(midi(76), { type: 'triangle', dur: 0.14, vol: 0.16 }),
  forget: () => tone(620, { dur: 0.35, vol: 0.12, to: 200 }),
  count: () => {
    noise({ dur: 0.06, vol: 0.2, freq: 4000, q: 2 });
    tone(midi(88), { dur: 0.25, vol: 0.14, at: now() + 0.05 });
  },
  sleep: () => [79, 76, 72].forEach((m, i) => tone(midi(m), { dur: 0.6, vol: 0.14, at: now() + i * 0.28 })),
  wake: () => [72, 76, 79, 84].forEach((m, i) => tone(midi(m), { type: 'triangle', dur: 0.25, vol: 0.16, at: now() + i * 0.1 })),
  // 広場の人の話し声。人ごとに声の高さを変える
  talk: (index = 0) => {
    const base = [58, 65, 53, 70][index % 4];
    for (let i = 0; i < 4; i++) {
      tone(midi(base + Math.floor(Math.random() * 5)), { type: 'square', dur: 0.08, vol: 0.06, at: now() + i * 0.1 });
    }
  },
};

// ---- 音楽 ----
function buildTheme({ bpm, melody, chords, lead, arp }) {
  const events = [];
  let beat = 0;
  for (const [m, len] of melody) {
    if (m) events.push({ beat, m, len: len * 0.9, type: lead.type, vol: lead.vol });
    beat += len;
  }
  chords.forEach(([root, minor], bar) => {
    const b = bar * 4;
    events.push({ beat: b, m: root, len: 1.9, type: 'sine', vol: 0.13 });
    events.push({ beat: b + 2, m: root + 7, len: 1.9, type: 'sine', vol: 0.09 });
    if (arp) {
      const notes = [root + 12, root + 12 + (minor ? 3 : 4), root + 19];
      [0, 2, 1, 2, 0, 2, 1, 2].forEach((n, i) => {
        events.push({ beat: b + i * 0.5, m: notes[n], len: 0.4, type: 'sine', vol: 0.045 });
      });
    }
  });
  events.sort((a, b) => a.beat - b.beat);
  return { spb: 60 / bpm, beats: chords.length * 4, events };
}

const THEMES = {
  day: buildTheme({
    bpm: 104,
    lead: { type: 'triangle', vol: 0.1 },
    arp: true,
    chords: [[48], [45, true], [41], [43], [48], [45, true], [41], [43]],
    melody: [
      [76, 1], [79, 1], [84, 1], [79, 1], [81, 1], [79, 0.5], [76, 0.5], [79, 2],
      [77, 1], [81, 1], [84, 1], [81, 1], [79, 1.5], [76, 0.5], [74, 2],
      [76, 1], [79, 1], [84, 1], [88, 1], [86, 1], [84, 0.5], [81, 0.5], [84, 2],
      [81, 1], [77, 1], [81, 1], [84, 1], [83, 1], [79, 1], [84, 2],
    ],
  }),
  night: buildTheme({
    bpm: 66,
    lead: { type: 'sine', vol: 0.09 },
    arp: false,
    chords: [[48], [43], [45, true], [43]],
    melody: [[76, 2], [72, 2], [74, 2], [67, 2], [76, 2], [72, 2], [74, 1], [76, 1], [74, 2]],
  }),
};

let themeName = 'day';
let loopStart = 0;
let index = 0;

function schedule() {
  if (!ctx || ctx.state !== 'running') return;
  const theme = THEMES[themeName];
  if (loopStart === 0) loopStart = ctx.currentTime + 0.1;
  const horizon = ctx.currentTime + 0.35;
  for (;;) {
    if (index >= theme.events.length) {
      index = 0;
      loopStart += theme.beats * theme.spb;
    }
    const ev = theme.events[index];
    const at = loopStart + ev.beat * theme.spb;
    if (at > horizon) break;
    if (at >= ctx.currentTime) {
      tone(midi(ev.m), { type: ev.type, dur: ev.len * theme.spb, vol: ev.vol, at, dest: bgmGain });
    }
    index += 1;
  }
}

export const sound = {
  settings,

  // 効果音を鳴らす
  play(name, param) {
    if (!ctx || ctx.state !== 'running' || !settings.sfx) return;
    SFX[name]?.(param);
  },

  // 音楽を切り替える（'day' / 'night'）
  setTheme(name) {
    if (name === themeName) return;
    themeName = name;
    index = 0;
    loopStart = ctx ? ctx.currentTime + 0.4 : 0;
  },

  // 設定を変えて保存する
  set(changes) {
    Object.assign(settings, changes);
    applySettings();
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // 保存できなくても続ける
    }
  },

  // 確認用: 音の出口
  get context() { return ctx; },
  get output() { return master; },
};
