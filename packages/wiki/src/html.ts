// Page templates and the game's BBCode → HTML. Every page sets <base href> to the site root, so links and asset URLs are
// written from there (`wiki/zhs/cards/bash/`, `assets/images/…`) and still work when the site is served under a subpath.
// The depth assumes the trailing-slash URL, which Cloudflare and nginx redirect to (at the site root extra ../ stop at /).
import type { Category, Item } from './data';

export type Lang = 'zhs' | 'eng';
export const LANGS: Lang[] = ['zhs', 'eng'];
export const HTML_LANG: Record<Lang, string> = { zhs: 'zh-Hans', eng: 'en' };

export const UI = {
  zhs: {
    site: '杀戮尖塔 2 Wiki', play: '开始游戏', other: 'English', search: '搜索名称或描述', all: '全部', shown: '条',
    cards: '卡牌', relics: '遗物', potions: '药水', powers: '能力', keywords: '关键词', characters: '角色', monsters: '怪物', encounters: '遭遇战', events: '事件',
    pool: '卡池', type: '类型', rarity: '稀有度', cost: '费用', owner: '所属', act: '章节', room: '房间', kind: '分类', stack: '叠加',
    description: '描述', upgraded: '升级后', flavor: '风味', hp: '生命值', gold: '金币', moves: '招式', monstersIn: '怪物', foundIn: '出现于',
    deck: '初始牌组', startRelics: '初始遗物', startPotions: '初始药水', cardsWith: '带有此关键词的卡牌', offers: '可提供的遗物', from: '来源',
    shared: '通用', colorless: '无色', buff: '增益', debuff: '减益', none: '无', counter: '可叠加', single: '不叠加',
    event: '事件', ancient: '先古之民', pages: '后续',
    allCards: '查看全部卡牌', allRelics: '查看全部遗物', allPotions: '查看全部药水',
    footer: '非官方学习项目，仅供学习使用。游戏资源与文本版权归 Mega Crit 所有。',
    landing: '选择语言',
  },
  eng: {
    site: 'Slay the Spire 2 Wiki', play: 'Play', other: '中文', search: 'Search name or text', all: 'All', shown: 'shown',
    cards: 'Cards', relics: 'Relics', potions: 'Potions', powers: 'Powers', keywords: 'Keywords', characters: 'Characters', monsters: 'Monsters', encounters: 'Encounters', events: 'Events',
    pool: 'Pool', type: 'Type', rarity: 'Rarity', cost: 'Cost', owner: 'Character', act: 'Act', room: 'Room', kind: 'Kind', stack: 'Stacks',
    description: 'Description', upgraded: 'Upgraded', flavor: 'Flavor', hp: 'HP', gold: 'Gold', moves: 'Moves', monstersIn: 'Monsters', foundIn: 'Appears in',
    deck: 'Starting deck', startRelics: 'Starting relics', startPotions: 'Starting potions', cardsWith: 'Cards with this keyword', offers: 'Relics offered', from: 'Source',
    shared: 'Shared', colorless: 'Colorless', buff: 'Buff', debuff: 'Debuff', none: 'None', counter: 'Counter', single: 'Single',
    event: 'Event', ancient: 'Ancient', pages: 'Outcomes',
    allCards: 'All cards', allRelics: 'All relics', allPotions: 'All potions',
    footer: 'Unofficial learning project. Game assets and text © Mega Crit.',
    landing: 'Choose a language',
  },
};
export type Ui = typeof UI.zhs;

export const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Game resource path (res://images/foo.png, any extension) → URL of its compressed copy under assets/, from manifest.json.
 * `@` written as %40: Cloudflare redirects a path with a literal @ (the …@0.5x images) to that form (as in sw.js). */
const textures = new Map<string, string>();
export function setTextures(list: { src: string; out: string; error?: unknown }[]) {
  for (const t of list) if (!t.error) textures.set(t.src.replace(/\.\w+$/, ''), 'assets/' + t.out.replaceAll('@', '%40'));
}
export function asset(res: string | null | undefined): string | undefined {
  return res ? textures.get(String(res).replace(/^res:\/\//, '').replace(/\.\w+$/, '')) : undefined;
}

const COLORS: Record<string, string> = {
  gold: '#efc851', blue: '#87ceeb', green: '#7fff00', red: '#ff5555', purple: '#ee82ee', pink: '#ff78a0', aqua: '#2aebbe',
  orange: '#ffa518', gray: '#a0a0a0', grey: '#a0a0a0', white: '#ffffff', yellow: '#fff27a', cream: '#fff6e2',
};
/** Game BBCode → HTML: colours, [b], [i] and [img] icons; effect and layout tags ([sine], [center], [font_size]) keep only their text. */
export function rt(src: string): string {
  const re = /\[(\/?)([a-z_]+)([^\]]*)\]/gi;
  const text = (s: string) => esc(s).replace(/\n/g, '<br>');
  const close: string[] = [];
  let out = '', last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out += text(src.slice(last, m.index));
    last = re.lastIndex;
    const [, end, tag0, arg] = m;
    const tag = tag0.toLowerCase();
    if (tag === 'img' && !end) {
      const e = src.indexOf('[/img]', last);
      const url = asset(src.slice(last, e < 0 ? undefined : e));
      last = re.lastIndex = e < 0 ? src.length : e + 6;
      if (url) out += `<img class="ic" src="${esc(url)}" alt="">`;
      continue;
    }
    if (end) { out += close.pop() ?? ''; continue; }
    const color = COLORS[tag] ?? (tag === 'color' && /^=#?\w+$/.test(arg) ? arg.slice(1) : null);
    const [o, c] = color ? [`<span style="color:${color}">`, '</span>'] : tag === 'b' ? ['<b>', '</b>'] : tag === 'i' ? ['<i>', '</i>'] : ['', ''];
    out += o;
    close.push(c);
  }
  return out + text(src.slice(last)) + close.reverse().join('');
}
/** BBCode → one-line plain text (meta descriptions, search). */
export const plain = (src: string) => src.replace(/\[img\].*?\[\/img\]/gi, '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();

export const link = (lang: Lang, cat: string, slug: string, label: string) => `<a href="wiki/${lang}/${cat}/${slug}/">${esc(label)}</a>`;

export interface Page {
  lang: Lang | null; // null: the bilingual landing page
  path: string; // under wiki/, with trailing slash ('' for the landing page)
  title: string;
  description: string;
  body: string;
  script?: boolean;
}
export const CATEGORIES = ['cards', 'relics', 'potions', 'powers', 'keywords', 'characters', 'monsters', 'encounters', 'events'] as const;

const pageTitle = (lang: Lang, ...parts: string[]) => [...parts, UI[lang].site].join(' - ');
const img = (src: string | undefined, kind = 'icon', alt = '') => (src ? `<img class="${kind}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy">` : '');

export function landingPage(): Page {
  const tiles = LANGS.map((l) => `<a class="tile" href="wiki/${l}/" hreflang="${HTML_LANG[l]}"><b>${esc(UI[l].site)}</b></a>`).join('');
  return {
    lang: null, path: '', title: `${UI.eng.site} · ${UI.zhs.site}`, description: `${UI.eng.site} · ${UI.zhs.site}`,
    body: `<div class="landing"><img src="assets/images/ui/sts2_logo_static%400.5x.webp" alt="Slay the Spire 2"><h1>Wiki</h1><p>${esc(UI.zhs.landing)} · ${esc(UI.eng.landing)}</p><div class="tiles">${tiles}</div></div>`,
  };
}

export function homePage(lang: Lang, cats: Category[]): Page {
  const ui = UI[lang];
  const tiles = cats.map((c) => `<a class="tile" href="wiki/${lang}/${c.key}/"><b>${esc(ui[c.key as keyof Ui])}</b><small>${c.items.length}</small>`
    + `<span>${esc(c.items.slice(0, 3).map((i) => i.title).join(lang === 'zhs' ? '、' : ', '))}…</span></a>`).join('');
  return { lang, path: `${lang}/`, title: ui.site, description: cats.map((c) => ui[c.key as keyof Ui]).join(' · '), body: `<h1>${esc(ui.site)}</h1><div class="tiles">${tiles}</div>` };
}

export function listPage(lang: Lang, c: Category): Page {
  const ui = UI[lang];
  const name = ui[c.key as keyof Ui];
  const selects = c.facets.map((f) => `<label><span>${esc(f.label)}</span><select name="${f.key}"><option value="">${esc(ui.all)}</option>`
    + f.options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('') + '</select></label>').join('');
  const items = c.items.map((i) => {
    const data = Object.entries(i.facets).map(([k, vs]) => ` data-${k}="${esc(vs.map(([v]) => v).join(' '))}"`).join('');
    return `<li${data}${i.accent ? ` style="--accent:${i.accent}"` : ''} data-q="${esc(`${i.title} ${i.summary}`.toLowerCase())}"><a href="wiki/${lang}/${c.key}/${i.slug}/">${img(i.img, i.imgKind)}`
      + `<span class="t"><b>${esc(i.title)}</b>${i.sub ? `<small>${esc(i.sub)}</small>` : ''}${i.text ? `<span class="tx">${rt(i.text)}</span>` : ''}</span></a></li>`;
  }).join('');
  return {
    lang, path: `${lang}/${c.key}/`, title: pageTitle(lang, name), description: c.items.slice(0, 30).map((i) => i.title).join(' · '), script: true,
    body: `<h1>${esc(name)}</h1><div class="filters">${selects}<label class="q"><input type="search" name="q" placeholder="${esc(ui.search)}" aria-label="${esc(ui.search)}"></label>`
      + `<output>${c.items.length}</output></div><ul class="grid ${c.key}">${items}</ul>`,
  };
}

export function detailPage(lang: Lang, c: Category, i: Item): Page {
  const ui = UI[lang];
  const name = ui[c.key as keyof Ui];
  const meta = i.meta.length ? `<dl>${i.meta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>` : '';
  const sections = i.body.map(([h, html]) => `<section>${h ? `<h2>${esc(h)}</h2>` : ''}<div>${html}</div></section>`).join('');
  return {
    lang, path: `${lang}/${c.key}/${i.slug}/`, title: pageTitle(lang, i.title, name), description: i.summary || i.title,
    body: `<nav class="crumbs"><a href="wiki/${lang}/">${esc(ui.site)}</a> › <a href="wiki/${lang}/${c.key}/">${esc(name)}</a></nav>`
      + `<article class="entry ${c.key}"${i.accent ? ` style="--accent:${i.accent}"` : ''}><header>${img(i.img, i.imgKind, i.title)}<div><h1>${esc(i.title)}</h1>${meta}</div></header>${sections}</article>`,
  };
}

export function layout(p: Page, origin: string): string {
  const depth = 1 + p.path.split('/').filter(Boolean).length; // wiki/ + path segments
  const url = (path: string) => `${origin}/wiki/${path}`;
  const swap = (l: Lang) => p.path.replace(/^(zhs|eng)\//, `${l}/`);
  const ui = UI[p.lang ?? 'eng'];
  const alternates = p.lang
    ? LANGS.map((l) => `<link rel="alternate" hreflang="${HTML_LANG[l]}" href="${url(swap(l))}">`).join('') + `<link rel="alternate" hreflang="x-default" href="${url('')}">`
    : '';
  const header = p.lang
    ? `<header class="top"><a class="brand" href="wiki/${p.lang}/"><img src="assets/images/ui/sts2_logo_static%400.5x.webp" alt="" width="64" height="32"><span>${esc(ui.site)}</span></a>`
      + `<nav>${CATEGORIES.map((c) => `<a href="wiki/${p.lang}/${c}/">${esc(ui[c])}</a>`).join('')}</nav>`
      + `<div class="tools"><a href="wiki/${swap(p.lang === 'zhs' ? 'eng' : 'zhs')}" hreflang="${HTML_LANG[p.lang === 'zhs' ? 'eng' : 'zhs']}">${esc(ui.other)}</a><a class="play" href="./">${esc(ui.play)}</a></div></header>`
    : '';
  return `<!doctype html>
<html lang="${HTML_LANG[p.lang ?? 'eng']}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="${'../'.repeat(depth)}">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description.slice(0, 200))}">
<meta name="color-scheme" content="dark">
<link rel="canonical" href="${url(p.path)}">${alternates}
<link rel="icon" href="assets/images/icon_1024%400.5x.webp">
<link rel="stylesheet" href="wiki/wiki.css">
</head>
<body>
${header}
<main>${p.body}</main>
<footer>${esc(p.lang ? ui.footer : `${UI.zhs.footer} ${UI.eng.footer}`)}</footer>
${p.script ? '<script src="wiki/wiki.js" defer></script>\n' : ''}</body>
</html>
`;
}
