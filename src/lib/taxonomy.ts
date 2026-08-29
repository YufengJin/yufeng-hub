/**
 * Site binding of the package's taxonomy helpers — the reference
 * implementation of the three-line contract: registry in the content tree,
 * `createTaxonomy` from the package, bound helpers exported for every page.
 *
 * This garden's registry already uses `label` as its display field; a site
 * whose registry carries language-specific fields maps them here instead
 * (e.g. `KINDS.map((k) => ({ ...k, label: k.zh }))`).
 */
import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import { createTaxonomy, fmtMonth } from 'astro-inkstone/lib/taxonomy';

import { DEFAULT_LOCALE, LOCALE_DEFS, type Locale } from '../content/notes/_meta/locales';
import { DOMAINS, KINDS, STATUSES } from '../content/notes/_meta/taxonomy';
import { isPrivate, VAULT_SEGMENT, withoutVault } from './private';

export type NoteEntry = CollectionEntry<'notes'>;

const {
  stripLocale,
  resolveTaxonomy: resolveCore,
  groupByKind,
  groupByDomain,
  groupByPrimaryDomain,
  tagIndex,
  statusDef,
  kindDef,
  domainDef,
} = createTaxonomy<
  (typeof KINDS)[number],
  (typeof DOMAINS)[number],
  (typeof STATUSES)[number],
  NoteEntry
>(
  { kinds: KINDS, domains: DOMAINS, statuses: STATUSES },
  {
    collection: 'notes',
    locales: LOCALE_DEFS.filter((l) => l.prefix !== '').map(({ code, prefix }) => ({ code, prefix })),
    primary: DEFAULT_LOCALE,
  },
);

export {
  stripLocale,
  groupByKind,
  groupByDomain,
  groupByPrimaryDomain,
  tagIndex,
  statusDef,
  kindDef,
  domainDef,
  fmtMonth,
};

export type ResolvedNote = ReturnType<typeof resolveCore>;

/* ---------------------------------------------------------------------- *
 * The vault namespace
 *
 * Private notes are ordinary entries of this collection under `vault/`, so
 * every browse page, the search index and the note route see them without
 * knowing anything special. The engine's resolver, though, reads ids
 * positionally, and `vault/` is a namespace rather than a hub: read
 * literally, `vault/rlinf-learning` would be "chapter rlinf-learning of hub
 * vault" and would never appear on a shelf.
 *
 * So a private note is resolved against a VIEW of the collection holding
 * only private notes, their ids stripped of the namespace. Inside that view
 * the positional rules mean exactly what they should — `vault/rlinf/setup`
 * is chapter `setup` of hub `vault/rlinf`, inheriting its kind and domains
 * the way a public chapter does — and since the view contains no public
 * notes, a private id can never collide with a public one of the same name.
 * The namespace goes back on the way out.
 * ---------------------------------------------------------------------- */

const viewCache = new WeakMap<Map<string, NoteEntry>, Map<string, NoteEntry>>();

function vaultView(byId: Map<string, NoteEntry>): Map<string, NoteEntry> {
  const cached = viewCache.get(byId);
  if (cached) return cached;
  const view = new Map<string, NoteEntry>();
  for (const [id, entry] of byId) {
    if (!isPrivate(id)) continue;
    const localId = withoutVault(id);
    // the entry is re-keyed AND re-ided, so the resolver's "is this entry
    // its own canonical?" identity check still holds inside the view
    view.set(localId, { ...entry, id: localId });
  }
  viewCache.set(byId, view);
  return view;
}

/** Resolve one entry's taxonomy — namespace-aware. `byId` must contain the
 *  whole collection. */
export function resolveTaxonomy(entry: NoteEntry, byId: Map<string, NoteEntry>): ResolvedNote {
  if (!isPrivate(entry.id)) return resolveCore(entry, byId);
  const view = vaultView(byId);
  const localId = withoutVault(entry.id);
  const local = view.get(localId) ?? ({ ...entry, id: localId } as NoteEntry);
  const resolved = resolveCore(local, view);
  // the caller gets the real entry back and the real id: `id` is a route
  // key everywhere downstream (cards, mirrors, the search index)
  return { ...resolved, entry, id: `${VAULT_SEGMENT}/${resolved.id}` };
}

/**
 * The browse units, newest first: primary-locale top-level entries of BOTH
 * halves. Replaces the engine's `getWikiUnits`, whose top-level test is
 * `id has no slash` — true for a public note, never true for a private one.
 *
 * `locale` keeps only the notes that actually EXIST in that language. A
 * shelf must not offer what the reader cannot read: a card for a note with
 * no mirror in the page's language would link out of that language, and
 * from there the whole chrome is the other language and nothing remembers
 * where the reader wanted to be. Filtering here is what keeps a language,
 * once chosen, from silently ending — every browse surface reads this one
 * function. Omitting `locale` returns both halves of the corpus (the link
 * graph and the search index want everything).
 */
export async function getWikiUnits(locale?: Locale): Promise<ResolvedNote[]> {
  const notes = await getCollection('notes');
  const byId = new Map(notes.map((n) => [n.id, n]));
  return notes
    .filter((n) => !withoutVault(n.id).includes('/'))
    .map((n) => resolveTaxonomy(n, byId))
    .filter((u) => locale === undefined || u.locales.includes(locale))
    .sort(
      (a, b) => (b.updated?.getTime() ?? 0) - (a.updated?.getTime() ?? 0) || a.id.localeCompare(b.id),
    );
}
