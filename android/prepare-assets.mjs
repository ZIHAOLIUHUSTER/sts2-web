#!/usr/bin/env node
// Trim only the staging copy; game sources, IDs and saved data are never rewritten.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'packages/app/dist');
const target = path.join(root, 'android/build/assets/web');
const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => {
  const p = path.join(dir, e.name);
  return n + (e.isDirectory() ? size(p) : fs.statSync(p).size);
}, 0);
const before = size(source);
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
const assets = path.join(target, 'assets');
const i18n = path.join(assets, 'i18n');
const indexPath = path.join(i18n, 'index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
index.languages = ['eng', 'zhs'];
fs.writeFileSync(indexPath, JSON.stringify(index));
for (const e of fs.readdirSync(i18n, { withFileTypes: true })) {
  if (e.isDirectory() && !index.languages.includes(e.name)) fs.rmSync(path.join(i18n, e.name), { recursive: true });
}
const fonts = path.join(assets, 'fonts');
for (const name of fs.readdirSync(fonts)) {
  if (/^(NotoSansCJKjp|Gyeonggi|CSChatThai|FiraSansExtra)/.test(name)) fs.unlinkSync(path.join(fonts, name));
}
const audioDir = path.join(assets, 'audio');
const audioIndexPath = path.join(audioDir, 'index.json');
const audio = JSON.parse(fs.readFileSync(audioIndexPath, 'utf8'));
const compat = process.env.AUDIO_COMPAT === '1';
audio.formats = compat ? ['ogg', 'mp3'] : ['ogg'];
fs.writeFileSync(audioIndexPath, JSON.stringify(audio));
const walk = (dir, fn) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, fn); else fn(p);
  }
};
if (!compat) walk(audioDir, (p) => { if (p.endsWith('.mp3')) fs.unlinkSync(p); });
// Fail before packaging if trimming broke any physical sample or alias. Index/event identities stay Ogg.
for (const sample of [...audio.files, ...Object.values(audio.aliases ?? {})]) {
  if (!fs.existsSync(path.join(audioDir, sample))) throw new Error(`Missing packaged audio: ${sample}`);
  if (compat && sample.endsWith('.ogg') && !fs.existsSync(path.join(audioDir, sample.slice(0, -4) + '.mp3'))) {
    throw new Error(`Missing compatibility audio: ${sample}`);
  }
}
for (const lang of index.languages) for (const table of index.tables) {
  if (!fs.existsSync(path.join(i18n, lang, table + '.json'))) throw new Error(`Missing language table: ${lang}/${table}`);
}
// Check every texture and atlas page; dynamically visited rooms/cards must remain available offline.
const manifest = JSON.parse(fs.readFileSync(path.join(assets, 'manifest.json'), 'utf8'));
for (const texture of manifest.textures) {
  if (!texture.error && !fs.existsSync(path.join(assets, texture.out))) throw new Error(`Missing texture: ${texture.out}`);
}
for (const atlas of manifest.atlases) for (let page = 0; page < atlas.pages; page++) {
  const json = path.join(assets, 'atlases', `${atlas.name}-${page}.json`);
  const image = JSON.parse(fs.readFileSync(json, 'utf8')).meta.image;
  if (!fs.existsSync(path.join(assets, 'atlases', image))) throw new Error(`Missing atlas page: ${image}`);
}
const report = { sourceBytes: before, stagedBytes: size(target), languages: index.languages, audioFormats: audio.formats, wikiIncluded: fs.existsSync(path.join(target, 'wiki/eng/index.html')) };
fs.writeFileSync(path.join(root, 'android/build/assets-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
