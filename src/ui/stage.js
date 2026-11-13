// 演出。モデルが返したトレースを見せる。
// 家と広場（3D）ではキャラクターの暮らしを、推論と学習は「頭の中の画面」に切り替えて見せる。

import * as THREE from 'three';
import { createRoom, makeLabel } from './room.js';
import { createActor } from './actor.js';
import { createMindView } from './mindview.js';
import { sound } from './sound.js';
import { MEMORY_CAPACITY, EMPTY_REPLY } from '../model/model.js';

const END_TEXT = {
  eos: '返事ができた',
  empty: 'まだ何もおぼえていないので、何も言えない',
  limit: '長くなりすぎたので、途中でやめた',
};
const NPC_COLORS = ['#e58a6f', '#6fa8dc', '#8cc084', '#c59ad6'];
const FRONT = 0;

const ease = (k) => k * k * (3 - 2 * k);

// 効果音。「飛ばす」（step が 0）のときは鳴らさない
const sfx = (name, step, param) => { if (step > 0) sound.play(name, param); };

function shorten(text, max) {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

export async function createStage(root, model) {
  root.classList.add('stage3d');
  const caption = document.createElement('div');
  caption.className = 'caption';

  const room = await createRoom(root);
  const actor = createActor(room);
  const mind = createMindView(root, room, model);
  root.append(caption);
  const { scene, tween, wait } = room;
  // 札。縦長の画面では大きめに、短めに作る
  const label = (text, opt = {}) => makeLabel(text, { ...opt, size: (opt.size ?? 0.36) * room.textScale });
  const tall = () => room.textScale > 1;
  const lineMax = () => (tall() ? 9 : 16);

  const P = {
    home: room.at('at_home'),
    basket: room.at('at_basket'),
    bed: room.at('at_bed'),
    bedTop: room.at('bed_top'),
    basketTop: room.at('basket_top'),
    ear: room.at('ear'),
    doorIn: room.at('at_door_in'),
    doorOut: room.at('at_door_out'),
    hide: room.at('at_hide'),
    plaza: room.at('plaza_center'),
  };
  actor.root.position.copy(P.home);

  let heardLabel = null; // 話しかけられた言葉の札
  let saidLabel = null;  // 返事の札
  let mem = [];          // 短期記憶の札 [{ text, sprite }]
  let memCount = null;
  let incoming = null;   // 広場で出た吹き出し（次の hear でかごへ飛ぶ）
  let exploring = false;
  const door = room.object('door');
  const DOOR_AJAR = 0.35; // ふだんは少しだけ開けて、ドアだと分かるようにする
  door.rotation.y = DOOR_AJAR;
  const swingDoor = (to, ms) => {
    const from = door.rotation.y;
    return tween(ms, (k) => { door.rotation.y = from + (to - from) * ease(k); });
  };

  // 一時停止とコマ送り。トレースの 1 手順ごとに gate() で待つ
  let paused = false;
  let waiter = null;
  function gate() {
    if (!paused) return undefined;
    return new Promise((resolve) => { waiter = resolve; });
  }
  function release() {
    waiter?.();
    waiter = null;
  }
  function setPaused(value) {
    paused = value;
    if (!paused) release();
  }

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
  const above = (pos, dx, dy, dz) => new THREE.Vector3(pos.x + dx, pos.y + dy, pos.z + dz);

  function clearLines() {
    if (heardLabel) remove(heardLabel);
    if (saidLabel) remove(saidLabel);
    heardLabel = null;
    saidLabel = null;
  }

  // 家の黒板に育ち具合を書く
  function updateBoard() {
    const s = mind.stats();
    room.board.write('そだちぐあい', [
      { label: 'おぼえた文字', value: `${s.kinds} 種類` },
      { label: '文字のつながり', value: `${s.links} 本` },
      { label: '数えた回数', value: `${s.total} 回` },
      { label: '眠った回数', value: `${s.sleeps} 回` },
    ]);
    actor.setGrowth(s.kinds);
  }

  // ---- 短期記憶（かごの上の札） ----
  // 札を積む場所。家ではかごの上、お出かけ中はキャラクターのそば（メモ）
  let memBase = P.basketTop;
  const memSlot = (i) => new THREE.Vector3(memBase.x - 0.5, memBase.y + 0.2 + i * 0.36 * room.textScale, memBase.z);
  function memLabel(text) {
    const sprite = label(shorten(text, 9), { size: 0.3, border: '#9cc27c' });
    sprite.center.set(0, 0.5);
    return sprite;
  }
  function updateMemCount() {
    if (memCount) remove(memCount);
    memCount = label(`短期記憶 ${mem.length}/${MEMORY_CAPACITY}`, { size: 0.24, bg: '#eef5e6', border: '#9cc27c' });
    put(memCount, new THREE.Vector3(memBase.x, memBase === P.basketTop ? 0.28 : memBase.y - 0.15, memBase.z + 0.5));
  }
  function restack(ms) {
    return Promise.all(mem.map((m, i) => fly(m.sprite, memSlot(i), ms, 0)));
  }
  // 演出なしで、短期記憶・地図・黒板を今のモデルに合わせる
  function syncMemory(list) {
    clearLines();
    mem.forEach((m) => remove(m.sprite));
    mem = list.map((text, i) => ({ text, sprite: put(memLabel(text), memSlot(i)) }));
    updateMemCount();
    mind.sync();
    updateBoard();
  }

  // ---- 家と広場で見せるもの（聞く、忘れる） ----
  const handlers = {
    async hear(ev, step) {
      const slot = memSlot(mem.length);
      const sprite = memLabel(ev.text);
      // 会話の札（話しかけられた言葉・返事）がこの文なら、それがかごへ飛び込む
      let line = null;
      if (heardLabel?.userData.text === ev.text) {
        line = heardLabel;
        heardLabel = null;
      } else if (saidLabel?.userData.text === ev.text) {
        line = saidLabel;
        saidLabel = null;
      }
      if (line) {
        await fly(line, P.basketTop, step * 1.2, 1.2);
        remove(line);
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
  };

  const headOnScreen = () => room.screenPos(above(actor.root.position, 0, 1.25, 0));

  // ---- 推論: 頭の中の画面に切り替えて見せ、戻ってから返事をする ----
  async function playInfer(trace, getStep) {
    let step = getStep();
    clearLines();
    caption.textContent = '';
    const text = trace.find((ev) => ev.type === 'tokenize')?.tokens.join('') ?? '';
    await actor.walkTo(P.home, step, FRONT);
    heardLabel = put(label(shorten(text, lineMax()), { size: 0.4, bg: '#dcebf5', border: '#9fc3e0' }),
      tall() ? above(P.home, 0, 3.3, 0) : above(P.home, -1.5, 2.3, 0.6));
    heardLabel.userData.text = text;
    sfx('hear', step);
    await pop(heardLabel, step * 0.4);
    caption.textContent = 'うーん…（考えている）';
    await actor.hop(step, 0.2);

    const opening = mind.open('infer', headOnScreen(), step * 4);
    wait(step * 2).then(() => { caption.textContent = ''; });
    await opening;
    for (const ev of trace) {
      await gate();
      await mind.handle(ev, getStep());
    }
    await mind.close(getStep() * 2);

    step = getStep();
    const reason = trace.find((ev) => ev.type === 'end')?.reason;
    const reply = trace.filter((ev) => ev.type === 'emit').map((ev) => ev.token).join('') || EMPTY_REPLY;
    saidLabel = put(label(shorten(reply, lineMax()), { size: 0.46, bg: '#fff3cf', border: '#d9a441' }),
      tall() ? above(P.home, 0, 2.5, 0.3) : above(P.home, 0.9, 2.2, 0.3));
    saidLabel.userData.text = reply;
    sfx(reason === 'empty' ? 'empty' : 'done', step);
    actor.cheer = reason !== 'empty';
    caption.textContent = END_TEXT[reason] ?? '';
    await pop(saidLabel, step * 0.4);
    if (reason !== 'empty') await actor.hop(step);
    await wait(step * 1.2);
    actor.cheer = false;
  }

  // ---- 学習: ベッドで眠り、夢（頭の中の画面）の中で集計表を書き換える ----
  async function playSleep(trace, getStep) {
    let step = getStep();
    clearLines();
    caption.textContent = 'おやすみ…';
    sound.setTheme('night');
    sfx('sleep', step);
    await Promise.all([room.fadeNight(1, step * 2), actor.walkTo(P.bed, step)]);
    actor.eyesClosed = true;
    await actor.lieDown(P.bedTop, step);
    const zzz = put(label('Zzz', { size: 0.36, bg: '#3a4a7a', color: '#fff', border: '#8fa0d8' }),
      above(P.bedTop, 0, 0.9, -0.9));
    await pop(zzz, step * 0.4);
    await wait(step * 1.2);
    caption.textContent = '';

    // 眠る前の短期記憶（これから思い出す文）を夢の画面に渡す
    const remembered = trace.filter((ev) => ev.type === 'replay').map((ev) => ev.text);
    await mind.open('learn', room.screenPos(above(P.bedTop, 0, 0.5, -0.8)), getStep() * 4, remembered);
    for (const ev of trace) {
      await gate();
      await mind.handle(ev, getStep());
    }
    // 夢の中でおぼえた文は、かごからなくなる
    mem.forEach((m) => remove(m.sprite));
    mem = [];
    updateMemCount();
    mind.sync();
    updateBoard();
    await mind.close(getStep() * 2);

    step = getStep();
    remove(zzz);
    await actor.getUp(P.bed, step);
    sound.setTheme('day');
    sfx('wake', step);
    await room.fadeNight(0, step * 1.5);
    actor.eyesClosed = false;
    await actor.walkTo(P.home, step, FRONT);
    await actor.hop(step);
  }

  // trace を再生する。getStep() は 1 手順あたりの時間（ミリ秒）を返す
  async function play(trace, getStep) {
    const types = new Set(trace.map((ev) => ev.type));
    if (types.has('replay')) {
      await playSleep(trace, getStep);
    } else if (types.has('tokenize') || types.has('lookup')) {
      await playInfer(trace, getStep);
    } else {
      for (const ev of trace) {
        // 知らない type は無視する
        await gate();
        await handlers[ev.type]?.(ev, getStep());
      }
    }
    mind.sync();
    updateBoard();
  }

  function say(text) {
    caption.textContent = text;
  }

  function showIdle() {
    caption.textContent = '';
  }

  // ---- 盗み聞き ----
  // 外へ出て茂みの陰に隠れ、広場に count 人が現れる
  async function goListen(count, getStep) {
    clearLines();
    caption.textContent = '外の話し声を聞きに行く';
    sfx('pop', getStep());
    await Promise.all([swingDoor(1.5, getStep() * 0.8), actor.walkTo(P.doorIn, getStep())]);
    // 場面転換: まちの ひろば へ。聞いた文のメモは、隠れ場所のそばに積む
    await room.transition('まちの ひろば', getStep() * 2.5, () => {
      room.setScene('plaza');
      actor.root.position.copy(P.doorOut);
      memBase = above(P.hide, 1.6, 0.9, 0.5);
      mem.forEach((m, i) => m.sprite.position.copy(memSlot(i)));
      updateMemCount();
    });
    caption.textContent = '';
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
      return wait(i * step * 0.3).then(() => {
        sfx('pop', step);
        return tween(step * 0.6, (k) => npc.scale.setScalar(Math.max(0.001, ease(k))));
      });
    }));
    caption.textContent = 'しーっ… 茂みの陰で聞いている';
  }

  // index 番目の人が text を話し、それを聞く（trace は model.hear の結果）
  async function speak(index, text, trace, getStep) {
    const step = getStep();
    const npc = npcs[index];
    const bubble = put(label(shorten(text, lineMax()), { size: 0.44, border: NPC_COLORS[index] }),
      new THREE.Vector3(npc.position.x, 2.15, npc.position.z));
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
    caption.textContent = 'おうちへ帰る';
    await actor.walkTo(P.doorOut, getStep());
    await room.transition('おうち', getStep() * 2.5, () => {
      room.setScene('house');
      door.rotation.y = 1.5;
      actor.root.position.copy(P.doorIn);
      memBase = P.basketTop;
      mem.forEach((m, i) => m.sprite.position.copy(memSlot(i)));
      updateMemCount();
    });
    caption.textContent = '';
    await Promise.all([swingDoor(DOOR_AJAR, getStep() * 0.8), actor.walkTo(P.home, getStep(), FRONT)]);
  }

  // ---- 頭の中をのぞく（いつでも地図を見られる）。開いたら true を返す ----
  async function toggleExplore() {
    if (exploring) {
      await mind.close(500);
    } else {
      mind.sync();
      await mind.open('explore', headOnScreen(), 1100);
    }
    exploring = !exploring;
    return exploring;
  }

  // なでる: キャラクターを押すと、よろこぶ
  let petting = false;
  async function pet() {
    if (petting) return;
    petting = true;
    sound.play('pet');
    const heart = put(label('♥', { size: 0.4, bg: '#ffe3ea', color: '#e0507a', border: '#f3a6bd' }),
      above(actor.root.position, 0, 1.7, 0));
    actor.cheer = true;
    if (!actor.lying) actor.hop(300, 0.25);
    await fadeAway(heart, 900);
    actor.cheer = false;
    petting = false;
  }

  // ---- 部屋のものを押して操作する ----
  // キャラクター: 話す、ドア: 聞きに行く、ベッド: 眠る、黒板: 頭の中を見る
  // ボタンは置かず、もの自体を押す。マウスを乗せると、何が起きるかを小さな札で示す
  const bedPos = room.object('bed').getWorldPosition(new THREE.Vector3());
  const boardPos = room.board.mesh.position;
  const HOT = [
    { id: 'talk', label: '話しかける', objects: [actor.root], center: () => above(actor.root.position, 0, 0.8, 0), top: 1.2 },
    { id: 'listen', label: '外へ聞きに行く', objects: [door, room.object('door_top')],
      center: () => door.localToWorld(new THREE.Vector3(0, 1.3, 0.6)), top: 1.5 },
    { id: 'sleep', label: '眠る', objects: [room.object('bed')], center: () => above(bedPos, 0, 0.5, 0), top: 0.7 },
    { id: 'explore', label: '頭の中を見る', objects: [room.object('board'), room.object('board_slate'), room.board.mesh],
      center: () => boardPos.clone(), top: 1.35 },
  ];
  const tip = document.createElement('div');
  tip.className = 'hot-tip';
  tip.hidden = true;
  root.append(tip);
  let onAction = () => {};
  let interactive = false;
  let hovered = null;
  function trigger(id) {
    if (!interactive || mind.isOpen) return;
    if (id === 'talk') void pet();
    else if (id) sound.play('pop');
    onAction(id);
  }
  const raycaster = new THREE.Raycaster();
  function hotAt(ev) {
    const box = room.canvas.getBoundingClientRect();
    const point = new THREE.Vector2(
      (ev.clientX - box.left) / box.width * 2 - 1,
      -((ev.clientY - box.top) / box.height) * 2 + 1,
    );
    raycaster.setFromCamera(point, room.camera);
    let best = null;
    for (const hot of HOT) {
      const hit = raycaster.intersectObjects(hot.objects, true)[0];
      if (hit && (!best || hit.distance < best.distance)) best = { hot, distance: hit.distance };
    }
    return best?.hot ?? null;
  }
  function hover(hot) {
    hovered = interactive && !mind.isOpen ? hot : null;
    room.canvas.style.cursor = hovered ? 'pointer' : '';
    tip.hidden = !hovered;
    if (!hovered) return;
    tip.textContent = hovered.label;
    const p = room.screenPos(above(hovered.center(), 0, hovered.top, 0));
    tip.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px) translate(-50%, -100%)`;
  }
  room.canvas.addEventListener('click', (ev) => { hover(null); trigger(hotAt(ev)?.id ?? null); });
  room.canvas.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse') hover(hotAt(ev)); });
  room.canvas.addEventListener('pointerleave', () => hover(null));

  updateMemCount();
  updateBoard();
  return {
    play, say, showIdle, syncMemory, goListen, speak, comeBack, toggleExplore,
    setPaused, stepOnce: release, npcColors: NPC_COLORS,
    // 部屋のものが押されたら fn(id) を呼ぶ（何もないところを押したら id は null）
    onAction: (fn) => { onAction = fn; },
    setInteractive: (value) => { interactive = value; if (!value) hover(null); },
    // 押せるものの、画面上の位置（動作確認用）
    hotPoint: (id) => room.screenPos(HOT.find((hot) => hot.id === id).center()),
  };
}
