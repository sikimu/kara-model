// 演出。モデルが返したトレースを、3D の部屋でキャラクターに演じさせる。

import * as THREE from 'three';
import { createRoom, makeLabel } from './room.js';
import { createActor } from './actor.js';
import { MEMORY_CAPACITY } from '../model/model.js';

const END_TEXT = {
  eos: '■ が出たので、おしまい',
  empty: '棚がからっぽ。何も言えない',
  limit: '30 文字になったので、打ち切り',
};
const BOARD_ROWS = 3;  // 黒板に出す候補の数
const ROW_LENGTH = 14; // 手前に並べる文字の 1 行の数
const HEARD_Y = 0.3;   // 聞いた言葉の行の高さ
const OUT_Y = -0.2;    // 出した言葉の行の高さ
const FRONT = 0;
const BACK = Math.PI;
const LEFT = -Math.PI / 2;
const RIGHT = Math.PI / 2;

const ease = (k) => k * k * (3 - 2 * k);

function shorten(text, max) {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

export async function createStage(root) {
  root.classList.add('stage3d');
  const caption = document.createElement('div');
  caption.className = 'caption';
  root.append(caption);

  const room = await createRoom(root);
  const actor = createActor(room);
  const { scene, board, dice, tween, wait } = room;

  const P = {
    home: room.at('at_home'),
    shelf: room.at('at_shelf'),
    table: room.at('at_table'),
    basket: room.at('at_basket'),
    horn: room.at('at_horn'),
    bed: room.at('at_bed'),
    bedTop: room.at('bed_top'),
    basketTop: room.at('basket_top'),
    hornMouth: room.at('horn_mouth'),
    ear: room.at('ear'),
  };
  actor.root.position.copy(P.home);
  const diceHome = dice.position.clone();

  let heard = null;   // 聞いた言葉の行 { text, sprites }
  let out = [];       // 出した言葉の行（札の配列）
  let mem = [];       // 短期記憶の札 [{ text, sprite, carried }]
  let memCount = null;
  let cands = [];     // 今の候補（抽選の帯の並び）
  let sleeping = false;

  // ---- 札の小道具 ----
  function put(sprite, pos) {
    sprite.position.copy(pos);
    scene.add(sprite);
    return sprite;
  }
  function remove(sprite) {
    if (actor.held === sprite) actor.held = null;
    scene.remove(sprite);
    sprite.material.map.dispose();
    sprite.material.dispose();
  }
  function pop(sprite, ms) {
    const { aspect, size } = sprite.userData;
    return tween(ms, (k) => {
      const s = Math.max(0.001, size * (k < 1 ? ease(k) * 1.15 : 1));
      sprite.scale.set(s * aspect, s, 1);
    });
  }
  function fly(sprite, to, ms, arc = 0.5) {
    const from = sprite.position.clone();
    return tween(ms, (k) => {
      sprite.position.lerpVectors(from, to, ease(k));
      sprite.position.y += Math.sin(k * Math.PI) * arc;
    });
  }
  async function fadeAway(sprite, ms) {
    const y = sprite.position.y;
    await tween(ms, (k) => {
      sprite.material.opacity = 1 - k;
      sprite.position.y = y + k * 0.5;
    });
    remove(sprite);
  }
  const rowPos = (i, y) => new THREE.Vector3(
    -2.35 + (i % ROW_LENGTH) * 0.36,
    y - Math.floor(i / ROW_LENGTH) * 0.38,
    3.7,
  );

  function setBoard(state) {
    board.state = state;
    board.draw();
  }
  function clearLines() {
    if (heard) heard.sprites.forEach(remove);
    heard = null;
    out.forEach(remove);
    out = [];
  }

  // ---- 短期記憶（かごの上の札） ----
  const memSlot = (i) => new THREE.Vector3(P.basketTop.x - 0.5, P.basketTop.y + 0.2 + i * 0.36, P.basketTop.z);
  function memLabel(text) {
    const sprite = makeLabel(shorten(text, 9), { size: 0.3, border: '#9cc27c' });
    sprite.center.set(0, 0.5);
    return sprite;
  }
  function updateMemCount() {
    if (memCount) remove(memCount);
    memCount = makeLabel(`短期記憶 ${mem.length}/${MEMORY_CAPACITY}`, { size: 0.24, bg: '#eef5e6', border: '#9cc27c' });
    put(memCount, new THREE.Vector3(P.basketTop.x, 0.28, P.basketTop.z + 0.5));
  }
  function restack(ms) {
    const stacked = mem.filter((m) => !m.carried);
    return Promise.all(stacked.map((m, i) => fly(m.sprite, memSlot(i), ms, 0)));
  }
  function syncMemory(list) {
    clearLines();
    mem.forEach((m) => remove(m.sprite));
    mem = list.map((text, i) => ({ text, sprite: put(memLabel(text), memSlot(i)) }));
    updateMemCount();
  }

  // ---- 睡眠 ----
  async function fallAsleep(step) {
    sleeping = true;
    clearLines();
    setBoard({});
    caption.textContent = 'おやすみ…';
    await Promise.all([room.fadeNight(1, step * 1.5), actor.walkTo(P.bed, step)]);
    actor.eyesClosed = true;
    await actor.lieDown(P.bedTop, step);
    const zzz = put(makeLabel('Zzz', { size: 0.34, bg: '#3a4a7a', color: '#fff', border: '#8fa0d8' }),
      new THREE.Vector3(P.bedTop.x, P.bedTop.y + 0.9, P.bedTop.z - 0.9));
    await pop(zzz, step * 0.4);
    await wait(step * 1.6);
    remove(zzz);
    await actor.getUp(P.bed, step);
    caption.textContent = '寝ぼけたまま、思い出した文を棚にしまう';
  }
  async function wake(step) {
    await actor.walkTo(P.home, step, FRONT);
    await room.fadeNight(0, step * 1.2);
    actor.eyesClosed = false;
    await actor.hop(step);
    setBoard({});
    sleeping = false;
  }

  // ---- トレースの種類ごとの演出 ----
  const handlers = {
    async tokenize(ev, step) {
      clearLines();
      setBoard({});
      caption.textContent = '';
      const tokens = ev.tokens.length > ROW_LENGTH
        ? [...ev.tokens.slice(0, ROW_LENGTH - 1), '…']
        : ev.tokens;
      heard = { text: ev.tokens.join(''), sprites: [] };
      for (const [i, t] of tokens.entries()) {
        const sprite = put(makeLabel(t, { size: 0.32 }), rowPos(i, HEARD_Y));
        heard.sprites.push(sprite);
        await pop(sprite, step * 0.2);
      }
      await wait(step * 0.3);
    },

    async lookup(ev, step) {
      await actor.walkTo(P.shelf, step, BACK);
      setBoard({ title: `「${ev.key}」の次に来る文字` });
      await actor.hop(step, 0.25);
      if (!ev.found) {
        setBoard({ ...board.state, message: '（からっぽ）' });
        await wait(step * 0.8);
      }
    },

    async probs(ev, step) {
      cands = ev.candidates;
      const top = [...cands].sort((a, b) => b.count - a.count).slice(0, BOARD_ROWS);
      const rows = top.map((c) => ({ ...c, fill: 0 }));
      const more = cands.length > BOARD_ROWS ? `ほか ${cands.length - BOARD_ROWS} 文字` : '';
      const state = { title: board.state.title, rows, more };
      await tween(step * 0.8, (k) => {
        for (const r of rows) r.fill = ease(k);
        setBoard(state);
      });
      await wait(step * 0.3);
    },

    async pick(ev, step) {
      await actor.walkTo(P.table, step, LEFT);
      const strip = cands.map((c) => ({ token: c.token, p: c.p }));
      const state = { ...board.state, strip, needle: 0, diceText: 'サイコロをふる…' };
      const spin = [1, 2, 3].map(() => (1 + Math.floor(Math.random() * 3)) * Math.PI);
      await tween(step, (k) => {
        dice.position.y = diceHome.y + Math.sin(k * Math.PI) * 0.8;
        dice.rotation.set(spin[0] * k, spin[1] * k, spin[2] * k);
        state.needle = ev.r * ease(k);
        setBoard(state);
      });
      state.diceText = `サイコロ ${ev.r.toFixed(2)} → 「${ev.token}」`;
      for (const seg of strip) seg.picked = seg.token === ev.token;
      let row = state.rows.find((r) => r.token === ev.token);
      if (!row) {
        // 上位に入っていない文字が当たったら、最後の行と入れ替えて見せる
        row = { ...cands.find((c) => c.token === ev.token), fill: 1 };
        state.rows[state.rows.length - 1] = row;
      }
      row.picked = true;
      setBoard(state);
      await wait(step * 0.8);
    },

    async emit(ev, step) {
      const big = put(makeLabel(ev.token, { size: 0.42, bg: '#f6c56b', border: '#d9a441' }),
        new THREE.Vector3(diceHome.x, diceHome.y + 0.6, diceHome.z));
      await pop(big, step * 0.3);
      actor.held = big;
      await actor.walkTo(P.horn, step, RIGHT);
      actor.held = null;
      await fly(big, P.hornMouth, step * 0.4, 0.3);
      remove(big);
      const small = put(makeLabel(ev.token, { size: 0.32, bg: '#f6c56b', border: '#d9a441' }), P.hornMouth);
      out.push(small);
      await fly(small, rowPos(out.length - 1, OUT_Y), step * 0.5, 0.8);
    },

    async end(ev, step) {
      caption.textContent = END_TEXT[ev.reason] ?? '';
      await actor.walkTo(P.home, step, FRONT);
      if (ev.reason === 'empty') {
        await actor.turnTo(-0.5, step * 0.3);
        await actor.turnTo(0.5, step * 0.3);
        await actor.turnTo(FRONT, step * 0.3);
      } else {
        await actor.hop(step);
      }
      await wait(step * 0.4);
    },

    async hear(ev, step) {
      const slot = memSlot(mem.filter((m) => !m.carried).length);
      const sprite = memLabel(ev.text);
      // 手前に並んでいる文字（聞いた言葉・出した言葉）がこの文なら、それがかごへ飛び込む
      let line = null;
      if (heard && heard.text === ev.text) {
        line = heard.sprites;
        heard = null;
      } else if (out.length > 0) {
        line = out;
        out = [];
      }
      if (line) {
        await Promise.all(line.map((s, i) => wait(i * step * 0.04).then(() => fly(s, P.basketTop, step * 0.5, 0.8))));
        line.forEach(remove);
        put(sprite, slot);
        await pop(sprite, step * 0.3);
      } else {
        put(sprite, P.ear);
        await fly(sprite, slot, step * 0.7, 0);
      }
      mem.push({ text: ev.text, sprite });
      updateMemCount();
      await wait(step * 0.2);
    },

    async forget(ev, step) {
      const i = mem.findIndex((m) => m.text === ev.text);
      if (i < 0) return;
      const [item] = mem.splice(i, 1);
      updateMemCount();
      await fadeAway(item.sprite, step * 0.6);
      await restack(step * 0.3);
    },

    async replay(ev, step) {
      if (!sleeping) await fallAsleep(step);
      await actor.walkTo(P.basket, step, LEFT);
      const item = mem.find((m) => m.text === ev.text && !m.carried);
      if (item) {
        item.carried = true;
        item.sprite.center.set(0.5, 0.5);
        actor.held = item.sprite;
        restack(step * 0.3);
      }
      setBoard({ title: '思い出している文', message: shorten(ev.text, 14) });
      await actor.walkTo(P.shelf, step, BACK);
    },

    async count(ev, step) {
      const title = `「${ev.key}」の次に来る文字`;
      setBoard({ title, count: { token: ev.token, num: ev.before } });
      await wait(step * 0.4);
      const hopping = actor.hop(step, 0.25);
      await wait(step * 0.3);
      setBoard({ title, count: { token: ev.token, num: ev.after, changed: true } });
      await hopping;
      await wait(step * 0.4);
    },
  };

  // trace を順に再生する。getStep() は 1 手順あたりの時間（ミリ秒）を返す
  async function play(trace, getStep) {
    for (const ev of trace) {
      // 知らない type は無視する
      await handlers[ev.type]?.(ev, getStep());
    }
    if (sleeping) await wake(getStep());
  }

  function say(text) {
    caption.textContent = text;
  }

  function showIdle() {
    caption.textContent = '';
    setBoard({});
  }

  updateMemCount();
  return { play, say, showIdle, syncMemory };
}
