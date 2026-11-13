// 演出。モデルが返したトレースを、3D の部屋でキャラクターに演じさせる。

import * as THREE from 'three';
import { createRoom, makeLabel } from './room.js';
import { createActor } from './actor.js';
import { sound } from './sound.js';
import { MEMORY_CAPACITY } from '../model/model.js';

const END_TEXT = {
  eos: '■ が出たので、おしまい',
  empty: '棚がからっぽ。何も言えない',
  limit: '30 文字になったので、打ち切り',
};
const BOARD_ROWS = 4;  // 黒板に出す候補の数
const ROW_LENGTH = 14; // 手前に並べる文字の 1 行の数
const HEARD_Y = 0.3;   // 聞いた言葉の行の高さ
const OUT_Y = -0.2;    // 出した言葉の行の高さ
const NPC_COLORS = ['#e58a6f', '#6fa8dc', '#8cc084', '#c59ad6'];
const FRONT = 0;
const BACK = Math.PI;
const LEFT = -Math.PI / 2;
const RIGHT = Math.PI / 2;

const ease = (k) => k * k * (3 - 2 * k);

// 効果音。「飛ばす」（step が 0）のときは鳴らさない
const sfx = (name, step, param) => { if (step > 0) sound.play(name, param); };

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
    doorIn: room.at('at_door_in'),
    doorOut: room.at('at_door_out'),
    hide: room.at('at_hide'),
    plaza: room.at('plaza_center'),
  };
  actor.root.position.copy(P.home);
  const diceHome = dice.position.clone();

  let heard = null;   // 聞いた言葉の行 { text, sprites }
  let out = [];       // 出した言葉の行（札の配列）
  let mem = [];       // 短期記憶の札 [{ text, sprite, carried }]
  let memCount = null;
  let cands = [];     // 今の候補（抽選の帯の並び）
  let sleeping = false;
  let incoming = null; // 広場で出た吹き出し（次の hear でかごへ飛ぶ）

  // 広場で話す人（最大 4 人）。ふだんは隠しておく
  const npcs = NPC_COLORS.map((color) => {
    const npc = room.npc.clone(true);
    npc.traverse((o) => {
      if (o.isMesh && o.material.name === 'npc_cloth') {
        o.material = o.material.clone();
        o.material.color.set(color);
      }
    });
    npc.visible = false;
    scene.add(npc);
    return npc;
  });

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
    sound.setTheme('night');
    sfx('sleep', step);
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
    sound.setTheme('day');
    sfx('wake', step);
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
        sfx('pop', step);
        await pop(sprite, step * 0.2);
      }
      await wait(step * 0.3);
    },

    async lookup(ev, step) {
      await actor.walkTo(P.shelf, step, BACK);
      setBoard({ title: `「${ev.key}」の次に来る文字` });
      sfx('book', step);
      await actor.hop(step, 0.25);
      if (!ev.found) {
        sfx('empty', step);
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
      sfx('bars', step);
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
      sfx('dice', step, step / 1000);
      const spin = [1, 2, 3].map(() => (1 + Math.floor(Math.random() * 3)) * Math.PI);
      await tween(step, (k) => {
        dice.position.y = diceHome.y + Math.sin(k * Math.PI) * 0.8;
        dice.rotation.set(spin[0] * k, spin[1] * k, spin[2] * k);
        state.needle = ev.r * ease(k);
        setBoard(state);
      });
      sfx('pick', step);
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
      sfx('pop', step);
      await pop(big, step * 0.3);
      actor.held = big;
      await actor.walkTo(P.horn, step, RIGHT);
      actor.held = null;
      sfx('toot', step, ev.token);
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
        sfx('done', step);
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
      } else if (incoming) {
        // 広場の吹き出しが、家のかごまで飛んでくる
        put(sprite, incoming.position);
        remove(incoming);
        incoming = null;
        actor.hop(step, 0.2);
        await fly(sprite, slot, step * 1.6, 1.8);
      } else {
        put(sprite, P.ear);
        await fly(sprite, slot, step * 0.7, 0);
      }
      mem.push({ text: ev.text, sprite });
      sfx('hear', step);
      updateMemCount();
      await wait(step * 0.2);
    },

    async forget(ev, step) {
      const i = mem.findIndex((m) => m.text === ev.text);
      if (i < 0) return;
      const [item] = mem.splice(i, 1);
      sfx('forget', step);
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
      sfx('count', step);
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

  // ---- 盗み聞き ----
  // 外へ出て茂みの陰に隠れ、広場に count 人が現れる
  async function goListen(count, getStep) {
    clearLines();
    setBoard({});
    caption.textContent = '外の話し声を聞きに行く';
    room.setShot('world', getStep() * 3);
    await actor.walkTo(P.doorIn, getStep());
    await actor.walkTo(P.doorOut, getStep());
    await actor.walkTo(P.hide, getStep(), Math.atan2(P.plaza.x - P.hide.x, P.plaza.z - P.hide.z));
    const step = getStep();
    const offset = count === 4 ? Math.PI / 4 : Math.PI / 2;
    await Promise.all(npcs.slice(0, count).map((npc, i) => {
      const a = (i / count) * Math.PI * 2 + offset;
      const r = count === 1 ? 0 : 1.05;
      npc.position.set(P.plaza.x + Math.sin(a) * r, 0, P.plaza.z + Math.cos(a) * r);
      npc.rotation.y = count === 1 ? FRONT : a + Math.PI;
      npc.scale.setScalar(0.001);
      npc.visible = true;
      return wait(i * step * 0.3).then(() => tween(step * 0.6, (k) => npc.scale.setScalar(Math.max(0.001, ease(k)))));
    }));
    caption.textContent = 'しーっ… 茂みの陰で聞いている';
  }

  // index 番目の人が text を話し、それを聞く（trace は model.hear の結果）
  async function speak(index, text, trace, getStep) {
    const step = getStep();
    const npc = npcs[index];
    const bubble = put(makeLabel(shorten(text, 16), { size: 0.44, border: NPC_COLORS[index] }),
      new THREE.Vector3(npc.position.x, 2.05, npc.position.z));
    sfx('talk', step, index);
    await pop(bubble, step * 0.3);
    await tween(step * 1.4, (k) => { npc.position.y = Math.abs(Math.sin(k * Math.PI * 3)) * 0.12; });
    incoming = bubble;
    await play(trace, getStep);
    if (incoming) { // 飛ばされなかった吹き出しを片付ける
      remove(incoming);
      incoming = null;
    }
  }

  // 広場の人が去り、家へ帰る
  async function comeBack(getStep) {
    const step = getStep();
    await Promise.all(npcs.filter((npc) => npc.visible).map((npc) => tween(step * 0.5, (k) => {
      npc.scale.setScalar(Math.max(0.001, 1 - ease(k)));
    }).then(() => { npc.visible = false; })));
    caption.textContent = '';
    room.setShot('house', getStep() * 3);
    await actor.walkTo(P.doorOut, getStep());
    await actor.walkTo(P.doorIn, getStep());
    await actor.walkTo(P.home, getStep(), FRONT);
  }

  function showIdle() {
    caption.textContent = '';
    setBoard({});
  }

  updateMemCount();
  return { play, say, showIdle, syncMemory, goListen, speak, comeBack, npcColors: NPC_COLORS };
}
