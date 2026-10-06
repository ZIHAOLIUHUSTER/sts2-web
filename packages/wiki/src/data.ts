// Rule-layer models → wiki entries in one language (LocManager.SetLanguage first). Text goes through the game's own
// formatting (SmartFormat with the models' dynamic vars), so pages show the numbers the game shows.
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import { UI, asset, esc, link, plain, rt, type Lang } from './html';

export interface Item {
  slug: string;
  title: string;
  img?: string;
  imgKind?: 'card' | 'icon' | 'wide';
  /** The owning card pool's colour (CardPoolModel.DeckEntryCardColor). */
  accent?: string;
  /** Filter facets: key → [value, label] pairs (a monster can be in several acts). */
  facets: Record<string, [string, string][]>;
  /** List tile: a short plain-text line and BBCode text. */
  sub?: string;
  text?: string;
  /** Detail page: facts (label, HTML) and sections (heading, HTML). */
  meta: [string, string][];
  body: [string, string][];
  /** Plain text: meta description and the list's search text. */
  summary: string;
}
export interface Facet { key: string; label: string; options: [string, string][] }
export interface Category { key: string; items: Item[]; facets: Facet[] }

const list = (x: any): any[] => (x == null ? [] : Array.from(x));
const str = (x: any): string => (x == null ? '' : typeof x === 'string' ? x : x.GetFormattedText());
const slug = (id: string) => id.toLowerCase().replace(/_/g, '-');
/** Enum member name → localization key part (RestSite → REST_SITE). */
const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
const ids = (xs: any[]) => new Set(xs.map((x) => x.Id.Entry));
const color = (pool: any) => '#' + pool.DeckEntryCardColor.ToHtml(false);

export function extract(G: any, lang: Lang, i18n: string): { cats: Category[]; problems: string[] } {
  const ui = UI[lang];
  const problems: string[] = [];
  const tables = new Map<string, Record<string, string>>();
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, JSON.parse(fs.readFileSync(path.join(i18n, lang, name + '.json'), 'utf8')));
    return tables.get(name)!;
  };
  /** Formats through the rule layer; on an exception, a logged error or a placeholder left over, the raw text without its {placeholders}. */
  const fmt = (what: string, f: () => any, raw: () => string | undefined): string => {
    let err = '';
    G.$.setGodotLogSink((level: string, msg: string) => { if (level === 'error' && !err) err = String(msg).split('\n')[0]; });
    try {
      const s = str(f());
      if (!err && !/\{\w/.test(s)) return s;
      err ||= 'placeholder left: ' + s;
    } catch (e) {
      err = String(e).split('\n')[0];
    } finally {
      G.$.setGodotLogSink(null);
    }
    problems.push(`${lang} ${what}: ${err.slice(0, 160)}`);
    return (raw() ?? '').replace(/\{[^}]*\}/g, '').replace(/\n{3,}/g, '\n\n');
  };
  const loc = (tbl: string, key: string) => fmt(`${tbl}/${key}`, () => G.LocString.GetIfExists(tbl, key), () => table(tbl)[key]);
  const titles = new Map<string, string>();
  /** Model title, formatted once per model (sort keys, pages and cross-links all ask for it). */
  const title = (m: any, tbl: string) => {
    const key = `${tbl}/${m.Id.Entry}`;
    if (!titles.has(key)) titles.set(key, fmt(m.Id.Entry, () => m.Title, () => table(tbl)[m.Id.Entry + (tbl === 'monsters' ? '.name' : '.title')]));
    return titles.get(key)!;
  };
  const enumLabel = (tbl: string, prefix: string, E: any, v: number) => {
    const name = G.$.enumStr(E, v);
    return { name, label: plain(table(tbl)[`${prefix}${snake(name)}${tbl === 'static_hover_tips' ? '.title' : ''}`] ?? name) };
  };
  const collator = new Intl.Collator(lang === 'zhs' ? 'zh-Hans' : 'en');
  /** Sorts by key tuples (numbers, then titles by locale). */
  const sorted = <T,>(xs: T[], key: (x: T) => (number | string)[]) => xs.map((x) => [key(x), x] as const).sort(([a], [b]) => {
    for (let i = 0; i < a.length; i++) {
      const d = typeof a[i] === 'number' ? (a[i] as number) - (b[i] as number) : collator.compare(String(a[i]), String(b[i]));
      if (d) return d;
    }
    return 0;
  }).map(([, x]) => x);
  const facets = (items: Item[], defs: [string, string][]): Facet[] => defs.map(([key, label]) => {
    const options = new Map<string, string>();
    for (const i of items) for (const [v, l] of i.facets[key] ?? []) if (!options.has(v)) options.set(v, l);
    return { key, label, options: [...options] };
  });
  const ln = (cat: string, m: any, label: string) => link(lang, cat, slug(m.Id.Entry), label);

  const chars = list(G.ModelDb.AllCharacters);
  const charTitle = new Map(chars.map((c) => [c.Id.Entry, title(c, 'characters')]));
  const charLink = (c: any) => ln('characters', c, charTitle.get(c.Id.Entry)!);
  // The compendium's act order: the two first acts, then Hive and Glory
  const acts = [G.Overgrowth, G.Underdocks, G.Hive, G.Glory].map((a) => G.ModelDb.Act(a));
  const actFacet = (has: (a: any) => boolean): [string, string][] => acts.filter(has).map((a) => [a.Id.Entry, title(a, 'acts')]);
  const actOrder = (f: [string, string][]) => (f.length ? acts.findIndex((a) => a.Id.Entry === f[0][0]) : acts.length);

  // ── Cards ──
  const cardPools = list(G.ModelDb.AllCardPools).filter((p) => p !== G.ModelDb.CardPool(G.DeprecatedCardPool));
  const SHARED_POOL: Record<string, string> = {
    CURSE_CARD_POOL: 'CARD_TYPE.CURSE', STATUS_CARD_POOL: 'CARD_TYPE.STATUS', EVENT_CARD_POOL: 'CARD_RARITY.EVENT', QUEST_CARD_POOL: 'CARD_TYPE.QUEST', TOKEN_CARD_POOL: 'CARD_RARITY.TOKEN',
  };
  const poolOwner = (p: any) => chars.find((c) => c.CardPool === p);
  const poolLabel = (p: any) => {
    const ch = poolOwner(p);
    if (ch) return charTitle.get(ch.Id.Entry)!;
    return p === G.ModelDb.CardPool(G.ColorlessCardPool) ? ui.colorless : plain(table('gameplay_ui')[SHARED_POOL[p.Id.Entry]] ?? p.Id.Entry);
  };
  const poolOf = new Map<string, any>();
  for (const p of cardPools) for (const c of list(p.AllCards)) if (!poolOf.has(c.Id.Entry)) poolOf.set(c.Id.Entry, p);
  const R = G.CardRarity;
  // NCardGrid's rarity sort: the regular rarities, then Status, Curse, Event, Quest, Token
  const rarityValue = (r: number) => (r <= R.Ancient ? r : ({ [R.Status]: 6, [R.Curse]: 7, [R.Event]: 8, [R.Quest]: 9, [R.Token]: 10 } as Record<number, number>)[r] ?? 11);
  /** The costs NCard shows; an upgrade changes the base (EnergyCost.UpgradeBy, BaseStarCost), not the canonical values. */
  const cost = (c: any) => {
    const parts: string[] = [];
    const energy = c.EnergyCost.GetWithModifiers(G.CostModifiers.All);
    if (c.EnergyCost.CostsX) parts.push('X');
    else if (energy >= 0) parts.push(String(energy));
    if (c.HasStarCostX) parts.push('X★');
    else if (c.BaseStarCost >= 0) parts.push(c.BaseStarCost + '★');
    return parts.join(' + ');
  };
  const keywordCards = new Map<string, any[]>();
  const cards = sorted(list(G.ModelDb.AllCards).filter((c) => poolOf.has(c.Id.Entry)),
    (c) => [cardPools.indexOf(poolOf.get(c.Id.Entry)), rarityValue(c.Rarity), c.Type, title(c, 'cards')]);
  const cardItems: Item[] = cards.map((c) => {
    const id = c.Id.Entry;
    const pool = poolOf.get(id);
    const type = enumLabel('gameplay_ui', 'CARD_TYPE.', G.CardType, c.Type);
    const rarity = enumLabel('gameplay_ui', 'CARD_RARITY.', R, c.Rarity);
    const raw = () => table('cards')[id + '.description'];
    const text = fmt(id, () => c.ToMutable().GetDescriptionForPile(G.PileType.None), raw);
    let up: { title: string; text: string; cost: string } | null = null;
    if (c.IsUpgradable) {
      try {
        // NInspectCardScreen's upgrade preview: a clone upgraded with UpgradePreviewType.Deck
        const m = c.ToMutable();
        m.UpgradePreviewType = G.CardUpgradePreviewType.Deck;
        m.UpgradeInternal();
        up = { title: str(m.Title), text: fmt(id + '+', () => m.GetDescriptionForUpgradePreview(), raw), cost: cost(m) };
      } catch (e) { problems.push(`${lang} ${id}+: ${String(e).split('\n')[0]}`); }
    }
    const kws = list(c.CanonicalKeywords).map((k) => snake(G.$.enumStr(G.CardKeyword, k)));
    for (const k of kws) keywordCards.set(k, [...(keywordCards.get(k) ?? []), c]);
    const owner = poolOwner(pool);
    const c0 = cost(c);
    return {
      slug: slug(id), title: title(c, 'cards'), img: asset(c.PortraitPngPath) ?? asset(c.BetaPortraitPngPath), imgKind: 'card', accent: color(pool),
      facets: { pool: [[pool.Id.Entry, poolLabel(pool)]], type: [[type.name, type.label]], rarity: [[rarity.name, rarity.label]] },
      sub: [c0 && `${ui.cost} ${c0}`, type.label, rarity.label].filter(Boolean).join(' · '),
      text,
      meta: [
        [ui.cost, esc(c0 || '—') + (up && up.cost !== c0 ? ` → ${esc(up.cost)}` : '')],
        [ui.type, esc(type.label)], [ui.rarity, esc(rarity.label)],
        [ui.pool, owner ? charLink(owner) : `<a href="wiki/${lang}/cards/?pool=${pool.Id.Entry}">${esc(poolLabel(pool))}</a>`],
      ],
      body: [
        [ui.description, rt(text)],
        ...(up ? [[`${ui.upgraded} · ${up.title}`, rt(up.text)] as [string, string]] : []),
        ...(kws.length ? [[ui.keywords, kws.map((k) => link(lang, 'keywords', slug(k), plain(table('card_keywords')[k + '.title'] ?? k))).join(' · ')] as [string, string]] : []),
      ],
      summary: plain(text),
    };
  });

  // ── Relics ──
  const ancients = list(G.ModelDb.AllAncients);
  const ancientRelics = new Map<string, any[]>(); // relic id → the ancients offering it
  for (const a of ancients) {
    let opts: any[] = [];
    try { opts = list(a.AllPossibleOptions); } catch (e) { problems.push(`${lang} ${a.Id.Entry} options: ${String(e).split('\n')[0]}`); }
    for (const o of opts) {
      const r = o.Relic?.CanonicalInstance;
      if (r && !(ancientRelics.get(r.Id.Entry) ?? []).includes(a)) ancientRelics.set(r.Id.Entry, [...(ancientRelics.get(r.Id.Entry) ?? []), a]);
    }
  }
  const relicPools = list(G.ModelDb.AllRelicPools).filter((p) => p !== G.ModelDb.RelicPool(G.DeprecatedRelicPool));
  const keptRelics = new Set([...relicPools.flatMap((p) => list(p.AllRelics)), ...chars.flatMap((c) => list(c.StartingRelics))].map((r) => r.Id.Entry));
  const relicOwner = (id: string) => chars.find((c) => ids(list(c.RelicPool.AllRelics)).has(id) || ids(list(c.StartingRelics)).has(id));
  const RR = G.RelicRarity;
  const relicOrder = [RR.Starter, RR.Common, RR.Uncommon, RR.Rare, RR.Shop, RR.Ancient, RR.Event];
  const relics = sorted(list(G.ModelDb.AllRelics).filter((r) => keptRelics.has(r.Id.Entry)), (r) => [(relicOrder.indexOf(r.Rarity) + 99) % 99, title(r, 'relics')]);
  const relicItems: Item[] = relics.map((r) => {
    const id = r.Id.Entry;
    const rarity = enumLabel('gameplay_ui', 'RELIC_RARITY.', RR, r.Rarity);
    const text = fmt(id, () => r.ToMutable().DynamicDescription, () => table('relics')[id + '.description']);
    const flavor = table('relics')[id + '.flavor'] != null ? loc('relics', id + '.flavor') : '';
    const owner = relicOwner(id);
    const from = ancientRelics.get(id) ?? [];
    return {
      slug: slug(id), title: title(r, 'relics'), img: asset(r.BigIconPath), imgKind: 'icon', accent: owner && color(owner.CardPool),
      facets: { rarity: [[rarity.name, rarity.label]], pool: [owner ? [owner.Id.Entry, charTitle.get(owner.Id.Entry)!] : ['SHARED', ui.shared]] },
      sub: rarity.label + (owner ? ` · ${charTitle.get(owner.Id.Entry)}` : ''),
      text,
      meta: [
        [ui.rarity, esc(rarity.label)], [ui.owner, owner ? charLink(owner) : esc(ui.shared)],
        ...(from.length ? [[ui.from, from.map((a) => ln('events', a, title(a, 'ancients'))).join(' · ')] as [string, string]] : []),
      ],
      body: [[ui.description, rt(text)], ...(flavor ? [[ui.flavor, `<i>${rt(flavor)}</i>`] as [string, string]] : [])],
      summary: plain(text),
    };
  });

  // ── Potions ──
  const potionPools = list(G.ModelDb.AllPotionPools).filter((p) => p !== G.ModelDb.PotionPool(G.DeprecatedPotionPool));
  const keptPotions = ids(potionPools.flatMap((p) => list(p.AllPotions)));
  const potionOwner = (id: string) => chars.find((c) => ids(list(c.PotionPool.AllPotions)).has(id));
  const PR = G.PotionRarity;
  const potionOrder = [PR.Common, PR.Uncommon, PR.Rare, PR.Event, PR.Token];
  const potions = sorted(list(G.ModelDb.AllPotions).filter((p) => keptPotions.has(p.Id.Entry)), (p) => [(potionOrder.indexOf(p.Rarity) + 99) % 99, title(p, 'potions')]);
  const potionItems: Item[] = potions.map((p) => {
    const id = p.Id.Entry;
    const rarity = enumLabel('gameplay_ui', 'POTION_RARITY.', PR, p.Rarity);
    const text = fmt(id, () => p.ToMutable().DynamicDescription, () => table('potions')[id + '.description']);
    const owner = potionOwner(id);
    return {
      slug: slug(id), title: title(p, 'potions'), img: asset(`images/potions/${id.toLowerCase()}`), imgKind: 'icon', accent: owner && color(owner.CardPool),
      facets: { rarity: [[rarity.name, rarity.label]], pool: [owner ? [owner.Id.Entry, charTitle.get(owner.Id.Entry)!] : ['SHARED', ui.shared]] },
      sub: rarity.label + (owner ? ` · ${charTitle.get(owner.Id.Entry)}` : ''),
      text,
      meta: [[ui.rarity, esc(rarity.label)], [ui.owner, owner ? charLink(owner) : esc(ui.shared)]],
      body: [[ui.description, rt(text)]],
      summary: plain(text),
    };
  });

  // ── Powers ── (test doubles and retired ones left out)
  const powers = sorted(list(G.ModelDb.AllPowers).filter((p) => !/^(MOCK|DEPRECATED)_/.test(p.Id.Entry)), (p) => [p.Type, title(p, 'powers')]);
  const powerItems: Item[] = powers.map((p) => {
    const id = p.Id.Entry;
    const type = G.$.enumStr(G.PowerType, p.Type);
    const typeLabel = ({ Buff: ui.buff, Debuff: ui.debuff } as Record<string, string>)[type] ?? ui.none;
    const stackLabel = ({ Counter: ui.counter, Single: ui.single } as Record<string, string>)[G.$.enumStr(G.PowerStackType, p.StackType)] ?? ui.none;
    // PowerModel.DumbHoverTip: the description with the icon variables, outside combat
    const text = fmt(id, () => { const d = p.Description; p.AddDumbVariablesToDescription(d); return d; }, () => table('powers')[id + '.description']);
    return {
      slug: slug(id), title: title(p, 'powers'), img: asset(p.BigIconPath), imgKind: 'icon',
      facets: { type: [[type, typeLabel]] }, sub: typeLabel, text,
      meta: [[ui.type, esc(typeLabel)], [ui.stack, esc(stackLabel)]],
      body: [[ui.description, rt(text)]],
      summary: plain(text),
    };
  });

  // ── Keywords ── (the card_keywords table: card keywords and a few other card terms)
  const kwTable = table('card_keywords');
  const keywordItems: Item[] = sorted(Object.keys(kwTable).filter((k) => k.endsWith('.title')).map((k) => k.slice(0, -6)), (k) => [kwTable[k + '.title']]).map((k) => {
    const text = loc('card_keywords', k + '.description');
    const with_ = keywordCards.get(k) ?? [];
    return {
      slug: slug(k), title: plain(kwTable[k + '.title']), facets: {}, text,
      meta: [],
      body: [[ui.description, rt(text)], ...(with_.length ? [[ui.cardsWith, with_.map((c) => ln('cards', c, title(c, 'cards'))).join(' · ')] as [string, string]] : [])],
      summary: plain(text),
    };
  });

  // ── Characters ──
  const counted = (xs: any[], cat: string, tbl: string) => {
    const n = new Map<any, number>();
    for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
    return [...n].map(([x, k]) => (k > 1 ? `${k} × ` : '') + ln(cat, x, title(x, tbl))).join(' · ');
  };
  const charItems: Item[] = chars.map((c) => {
    const id = c.Id.Entry;
    const text = loc('characters', id + '.description');
    const potions0 = list(c.StartingPotions);
    return {
      slug: slug(id), title: charTitle.get(id)!, img: asset(c.CharacterSelectIconPath) ?? asset(c.IconTexturePath), imgKind: 'icon', accent: color(c.CardPool),
      facets: {}, sub: `${ui.hp} ${c.StartingHp} · ${ui.gold} ${c.StartingGold}`, text,
      meta: [[ui.hp, String(c.StartingHp)], [ui.gold, String(c.StartingGold)]],
      body: [
        [ui.description, rt(text)],
        [ui.deck, counted(list(c.StartingDeck), 'cards', 'cards')],
        [ui.startRelics, counted(list(c.StartingRelics), 'relics', 'relics')],
        ...(potions0.length ? [[ui.startPotions, counted(potions0, 'potions', 'potions')] as [string, string]] : []),
        ['', [['cards', `?pool=${c.CardPool.Id.Entry}`, ui.allCards], ['relics', `?pool=${id}`, ui.allRelics], ['potions', `?pool=${id}`, ui.allPotions]]
          .map(([cat, q, l]) => `<a class="more" href="wiki/${lang}/${cat}/${q}">${esc(l)}</a>`).join('')],
      ],
      summary: plain(text),
    };
  });

  // ── Monsters and encounters ──
  const encounters = list(G.ModelDb.AllEncounters);
  const encMonsters = new Map(encounters.map((e) => {
    try { return [e, list(e.AllPossibleMonsters)]; } catch (e2) { problems.push(`${lang} ${e.Id.Entry} monsters: ${String(e2).split('\n')[0]}`); return [e, []]; }
  }));
  const ROOM: Record<string, string> = { Monster: 'ROOM_ENEMY', Elite: 'ROOM_ELITE', Boss: 'ROOM_BOSS' };
  const room = (e: any) => { const name = G.$.enumStr(G.RoomType, e.RoomType); return { name, label: plain(table('static_hover_tips')[`${ROOM[name]}.title`] ?? name) }; };
  const monTable = table('monsters');
  const monsters = sorted(list(G.ModelDb.Monsters), (m) => [actOrder(actFacet((a) => ids(list(a.AllMonsters)).has(m.Id.Entry))), title(m, 'monsters')]);
  const monsterItems: Item[] = monsters.map((m) => {
    const id = m.Id.Entry;
    const name = title(m, 'monsters');
    const actsF = actFacet((a) => ids(list(a.AllMonsters)).has(id));
    let hp = '';
    try { hp = m.MinInitialHp === m.MaxInitialHp ? String(m.MinInitialHp) : `${m.MinInitialHp}–${m.MaxInitialHp}`; } catch (e) { problems.push(`${lang} ${id} hp: ${String(e).split('\n')[0]}`); }
    const moves = Object.keys(monTable).filter((k) => k.startsWith(id + '.moves.') && k.endsWith('.title')).map((k) => plain(monTable[k]));
    const ins = encounters.filter((e) => ids(encMonsters.get(e)!).has(id));
    return {
      slug: slug(id), title: name, facets: { act: actsF },
      sub: [hp && `${ui.hp} ${hp}`, actsF.map(([, l]) => l).join(' / ')].filter(Boolean).join(' · '),
      meta: [[ui.hp, esc(hp || '—')], ...(actsF.length ? [[ui.act, esc(actsF.map(([, l]) => l).join(' / '))] as [string, string]] : [])],
      body: [
        ...(moves.length ? [[ui.moves, moves.map(esc).join(' · ')] as [string, string]] : []),
        ...(ins.length ? [[ui.foundIn, ins.map((e) => ln('encounters', e, title(e, 'encounters'))).join(' · ')] as [string, string]] : []),
      ],
      summary: [name, hp && `${ui.hp} ${hp}`, moves.join(' ')].filter(Boolean).join(' · '),
    };
  });
  const roomOrder = ['Monster', 'Elite', 'Boss'];
  const encounterItems: Item[] = sorted(encounters, (e) => [actOrder(actFacet((a) => ids(list(a.AllEncounters)).has(e.Id.Entry))), roomOrder.indexOf(room(e).name), title(e, 'encounters')]).map((e) => {
    const id = e.Id.Entry;
    const r = room(e);
    const actsF = actFacet((a) => ids(list(a.AllEncounters)).has(id));
    const mons = encMonsters.get(e)!;
    const monTitle = (m: any) => title(m, 'monsters');
    return {
      slug: slug(id), title: title(e, 'encounters'), img: asset(`images/ui/run_history/${id.toLowerCase()}`), imgKind: 'icon',
      facets: { act: actsF, room: [[r.name, r.label]] },
      sub: [r.label, actsF.map(([, l]) => l).join(' / ')].filter(Boolean).join(' · '),
      text: mons.map(monTitle).join(' · '),
      meta: [
        [ui.room, esc(r.label)], ...(actsF.length ? [[ui.act, esc(actsF.map(([, l]) => l).join(' / '))] as [string, string]] : []),
        [ui.gold, `${e.MinGoldReward}–${e.MaxGoldReward}`],
      ],
      body: [[ui.monstersIn, mons.map((m) => ln('monsters', m, monTitle(m))).join(' · ')]],
      summary: [r.label, ...mons.map(monTitle)].join(' · '),
    };
  });

  // ── Events and ancients ──
  const evTable = table('events');
  const evKeys = new Map<string, RegExpExecArray[]>(); // event id → its <id>.pages.<page>.(description|options.<option>.(title|description)) keys
  for (const k of Object.keys(evTable)) {
    const p = /^(\w+?)\.pages\.(\w+)\.(?:description|options\.(\w+)\.(title|description))$/.exec(k);
    if (p) evKeys.set(p[1], [...(evKeys.get(p[1]) ?? []), p]);
  }
  const eventItems: Item[] = list(G.ModelDb.AllEvents).map((ev) => {
    const id = ev.Id.Entry;
    const m = ev.ToMutable();
    // NEventLayout adds the event's dynamic vars to every description and option text
    const text = (key: string) => fmt(key, () => { const ls = G.LocString.GetIfExists('events', key); m.DynamicVars.AddTo(ls); return ls; }, () => evTable[key]);
    const pages = new Map<string, { desc?: string; options: Map<string, { title?: string; desc?: string }> }>();
    for (const [k, , pageKey, option, field] of evKeys.get(id) ?? []) {
      const page = pages.get(pageKey) ?? { options: new Map() };
      pages.set(pageKey, page);
      if (!option) page.desc = text(k);
      else {
        const o = page.options.get(option) ?? {};
        page.options.set(option, o);
        if (field === 'title') o.title = text(k); else o.desc = text(k);
      }
    }
    const optTitle = new Map([...pages.values()].flatMap((p) => [...p.options].map(([k, o]) => [k, o.title ?? k] as const)));
    const order = ['INITIAL', ...[...pages.keys()].filter((k) => k !== 'INITIAL')];
    const body: [string, string][] = order.filter((k) => pages.has(k)).map((k) => {
      const p = pages.get(k)!;
      const opts = [...p.options.values()].map((o) => `<li><b>${rt(o.title ?? '')}</b>${o.desc ? ` <span>${rt(o.desc)}</span>` : ''}</li>`).join('');
      const heading = k === 'INITIAL' ? ui.description : `→ ${plain(optTitle.get(k) ?? k.toLowerCase().replace(/_/g, ' '))}`;
      return [heading, (p.desc ? `<p>${rt(p.desc)}</p>` : '') + (opts ? `<ul class="opts">${opts}</ul>` : '')];
    });
    const actsF = actFacet((a) => ids(list(a.AllEvents)).has(id));
    const intro = pages.get('INITIAL')?.desc ?? '';
    return {
      slug: slug(id), title: title(ev, 'events'), img: asset(`images/events/${id.toLowerCase()}`), imgKind: 'wide',
      facets: { kind: [['EVENT', ui.event]], act: actsF.length ? actsF : [['SHARED', ui.shared]] },
      sub: actsF.length ? actsF.map(([, l]) => l).join(' / ') : ui.shared,
      meta: [[ui.act, esc(actsF.length ? actsF.map(([, l]) => l).join(' / ') : ui.shared)]],
      body,
      summary: plain(intro),
    };
  });
  const ancientItems: Item[] = ancients.map((a) => {
    const id = a.Id.Entry;
    const epithet = table('ancients')[id + '.epithet'] ?? '';
    const actsF = actFacet((x) => ids(list(x.AllAncients)).has(id));
    const offers = relics.filter((r) => (ancientRelics.get(r.Id.Entry) ?? []).includes(a));
    return {
      slug: slug(id), title: title(a, 'ancients'), img: asset(`images/ui/run_history/${id.toLowerCase()}`), imgKind: 'icon',
      facets: { kind: [['ANCIENT', ui.ancient]], act: actsF.length ? actsF : [['SHARED', ui.shared]] },
      sub: [plain(epithet), ui.ancient].filter(Boolean).join(' · '),
      meta: [[ui.kind, esc([ui.ancient, plain(epithet)].filter(Boolean).join(' · '))], [ui.act, esc(actsF.length ? actsF.map(([, l]) => l).join(' / ') : ui.shared)]],
      body: offers.length ? [[ui.offers, offers.map((r) => ln('relics', r, title(r, 'relics'))).join(' · ')]] : [],
      summary: [plain(epithet), ...offers.map((r) => title(r, 'relics'))].join(' · '),
    };
  });
  const events = sorted([...eventItems, ...ancientItems], (i) => [i.facets.kind[0][0] === 'EVENT' ? 0 : 1, actOrder(i.facets.act[0][0] === 'SHARED' ? [] : i.facets.act), i.title]);

  const cats: Category[] = [
    { key: 'cards', items: cardItems, facets: facets(cardItems, [['pool', ui.pool], ['type', ui.type], ['rarity', ui.rarity]]) },
    { key: 'relics', items: relicItems, facets: facets(relicItems, [['rarity', ui.rarity], ['pool', ui.owner]]) },
    { key: 'potions', items: potionItems, facets: facets(potionItems, [['rarity', ui.rarity], ['pool', ui.owner]]) },
    { key: 'powers', items: powerItems, facets: facets(powerItems, [['type', ui.type]]) },
    { key: 'keywords', items: keywordItems, facets: [] },
    { key: 'characters', items: charItems, facets: [] },
    { key: 'monsters', items: monsterItems, facets: facets(monsterItems, [['act', ui.act]]) },
    { key: 'encounters', items: encounterItems, facets: facets(encounterItems, [['act', ui.act], ['room', ui.room]]) },
    { key: 'events', items: events, facets: facets(events, [['kind', ui.kind], ['act', ui.act]]) },
  ];
  return { cats, problems };
}
