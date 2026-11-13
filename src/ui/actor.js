// キャラクターの動き。部品（体、目、足、腕）を名前で取り出して three.js 側で動かす。

import { sound } from './sound.js';

const ease = (k) => k * k * (3 - 2 * k);

export function createActor(room) {
  const root = room.character;
  const part = (name) => root.getObjectByName(name);
  const body = part('body');
  const eyes = [part('eyeL'), part('eyeR')];
  const feet = [part('footL'), part('footR')];
  const arms = [part('armL'), part('armR')];
  const sprout = part('sprout');
  const head = part('head');
  const bodyY = body.position.y;
  const eyeScaleY = eyes[0].scale.y;
  const footBase = feet.map((f) => f.position.clone());

  root.scale.setScalar(1.25); // 画面で見やすい大きさにする

  const actor = {
    root,
    cheer: false,     // 両腕を上げる
    eyesClosed: false,
    lying: false,
    walkTo,
    turnTo,
    hop,
    lieDown,
    getUp,
    setGrowth,
  };

  let walking = 0; // 歩きの進み具合（足を動かす用）。歩いていないときは 0
  let armsUp = 0;

  room.onFrame((t) => {
    // 待機の動き: 呼吸、まばたき、芽のゆれ
    const breath = Math.sin(t * 2.2) * 0.012;
    body.scale.set(1 - breath, 1 + breath, 1 - breath);
    sprout.rotation.z = Math.sin(t * 1.7) * 0.12;
    head.rotation.z = Math.sin(t * 0.9) * 0.04;
    head.rotation.x = actor.lying ? 0 : -0.12; // 低めのカメラへ自然に顔を向ける
    const blink = actor.eyesClosed || (t % 3.4) < 0.12;
    for (const e of eyes) e.scale.y = eyeScaleY * (blink ? 0.12 : 1);

    // 足: 歩いているときは交互に前後と上下
    feet.forEach((f, i) => {
      const phase = walking * Math.PI * 2 + i * Math.PI;
      const on = walking > 0 ? 1 : 0;
      f.position.z = footBase[i].z + Math.sin(phase) * 0.14 * on;
      f.position.y = footBase[i].y + Math.max(0, Math.cos(phase)) * 0.08 * on;
    });

    // 腕: 肩を中心に回す。歩くときは前後に振り、よろこぶときは上げる
    armsUp += ((actor.cheer ? 1 : 0) - armsUp) * 0.2;
    arms.forEach((a, i) => {
      const side = i === 0 ? -1 : 1;
      a.rotation.z = side * (0.15 + armsUp * 2.5);
      a.rotation.x = walking > 0 ? Math.sin(walking * Math.PI * 2 + i * Math.PI) * 0.6 : 0;
    });
  });

  // 育ち具合（おぼえた文字の種類）に合わせて、頭の芽を大きくする
  function setGrowth(kinds) {
    sprout.scale.setScalar(1 + Math.min(kinds, 80) / 40);
  }

  function turnTo(angle, ms) {
    const from = root.rotation.y;
    let d = (angle - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return room.tween(ms, (k) => { root.rotation.y = from + d * ease(k); });
  }

  // pos まで歩く。着いたら faceAngle（省略時は進行方向のまま）を向く
  async function walkTo(pos, step, faceAngle) {
    const from = root.position.clone();
    const dx = pos.x - from.x;
    const dz = pos.z - from.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.05) {
      await turnTo(Math.atan2(dx, dz), step * 0.25);
      const steps = Math.max(1, Math.round(dist / 0.55));
      let stepsDone = 0;
      await room.tween(step * (0.3 + dist * 0.28), (k) => {
        if (step > 0 && Math.floor(k * steps * 2) > stepsDone) {
          stepsDone = Math.floor(k * steps * 2);
          sound.play('step');
        }
        root.position.x = from.x + dx * k;
        root.position.z = from.z + dz * k;
        walking = k * steps;
        body.position.y = bodyY + Math.abs(Math.sin(k * steps * Math.PI * 2)) * 0.05;
      });
      walking = 0;
      body.position.y = bodyY;
    }
    if (faceAngle !== undefined) await turnTo(faceAngle, step * 0.25);
  }

  function hop(step, height = 0.35) {
    const y = root.position.y;
    if (step > 0) sound.play('hop');
    return room.tween(step * 0.6, (k) => { root.position.y = y + Math.sin(k * Math.PI) * height; });
  }

  // ベッドの上にあおむけになる
  async function lieDown(pos, step) {
    const from = root.position.clone();
    await turnTo(Math.PI, step * 0.25);
    await room.tween(step * 0.8, (k) => {
      const e = ease(k);
      root.position.lerpVectors(from, pos, e);
      root.position.y += Math.sin(k * Math.PI) * 0.5;
      root.rotation.x = -Math.PI / 2 * e;
      root.rotation.y = Math.PI * (1 - e);
    });
    actor.lying = true;
  }

  async function getUp(pos, step) {
    const from = root.position.clone();
    await room.tween(step * 0.8, (k) => {
      const e = ease(k);
      root.position.lerpVectors(from, pos, e);
      root.position.y += Math.sin(k * Math.PI) * 0.5;
      root.rotation.x = -Math.PI / 2 * (1 - e);
    });
    actor.lying = false;
  }

  return actor;
}
