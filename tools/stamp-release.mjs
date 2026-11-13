// ソースと素材が変わったときだけ URL を更新し、旧キャッシュとの混在を防ぐ。
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function files(dir) {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(`${dir}/${e.name}`) : `${dir}/${e.name}`))).flat().sort();
}
const sources = await files('src');
const assets = await files('assets');
const hash = createHash('sha256');
for (const name of [...sources, ...assets]) {
  hash.update(name);
  const data = await readFile(path.join(root, name));
  hash.update(/\.(js|css)$/.test(name) ? data.toString().replaceAll('\r\n', '\n') : data);
}
const version = hash.digest('hex').slice(0, 12);
const file = path.join(root, 'index.html');
let html = await readFile(file, 'utf8');
const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
const map = JSON.parse(match[1]);
for (const key of Object.keys(map.imports)) if (key.startsWith('./src/')) delete map.imports[key];
for (const name of sources.filter(n => n.endsWith('.js'))) map.imports[`./${name}`] = `./${name}?v=${version}`;
html = html.replace(match[0], `<script type="importmap">\n${JSON.stringify(map, null, 2)}\n  </script>`)
  .replace(/\.\/src\/ui\/style\.css(?:\?v=[^"\s]+)?/, `./src/ui/style.css?v=${version}`)
  .replace(/src="\.\/src\/main\.js(?:\?v=[^"\s]+)?"/, `src="./src/main.js?v=${version}"`);
const meta = `<meta name="app-version" content="${version}">`;
html = html.includes('name="app-version"') ? html.replace(/<meta name="app-version"[^>]*>/, meta) : html.replace('</head>', `  ${meta}\n</head>`);
await writeFile(file, html);
console.log(`Release: ${version}`);
