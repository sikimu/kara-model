import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// 実際に配信するGLBの境界を調べる。交差する絨毯の同じ高さの面を再発させない。
const data = await readFile(new URL('../assets/mind-space.glb', import.meta.url));
const gltf = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
const bounds = node => {
  assert.ok(!node.rotation && !node.matrix && !node.scale, `${node.name}: 境界検証に変換の追加対応が必要`);
  const accessor = gltf.accessors[gltf.meshes[node.mesh].primitives[0].attributes.POSITION];
  return { min: accessor.min.map((v, i) => v + node.translation[i]), max: accessor.max.map((v, i) => v + node.translation[i]) };
};
const horizontal = gltf.nodes.filter(n => /^mind_runner_h\d+_edge$/.test(n.name));
const vertical = gltf.nodes.filter(n => /^mind_runner_v\d+_\d+_edge$/.test(n.name));
assert.equal(horizontal.length, 3);
assert.equal(vertical.length, 10);
for (const h of horizontal) for (const v of vertical) {
  const a = bounds(h), b = bounds(v);
  assert.ok([0, 2].some(i => a.max[i] <= b.min[i] || b.max[i] <= a.min[i]), `${h.name} と ${v.name} が重なる`);
}
for (const edge of [...horizontal, ...vertical]) {
  const fill = gltf.nodes.find(n => n.name === edge.name.replace(/_edge$/, ''));
  assert.ok(bounds(fill).min[1] > bounds(edge).max[1], `${fill.name}: 縁と表面が交差する`);
}
console.log('OK 廊下の分岐で絨毯が重ならず、縁と表面も交差しない');
