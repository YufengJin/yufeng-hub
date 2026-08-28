import { existsSync } from 'node:fs';

import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

import { DOMAIN_IDS, KIND_IDS, STATUS_IDS } from './content/notes/_meta/taxonomy';
import { isPrivate, vaultIdOf } from './lib/private';

type Loader = ReturnType<typeof glob>;

/**
 * A view of the data store restricted to one loader's id namespace.
 *
 * The glob loader treats every id in the store that its own scan did not
 * touch as an orphan and deletes it (`store.keys()` at entry, the leftovers
 * dropped at exit). Two globs sharing one store would therefore annihilate
 * each other: whichever ran second would wipe the first's entries. Hiding
 * the other namespace's keys confines each loader's cleanup to its own —
 * every other method passes straight through, so incremental rebuilds,
 * digests and asset imports behave exactly as they do for a lone glob.
 *
 * A Proxy rather than a hand-written object: only `keys` is overridden and
 * everything else — including methods the public DataStore type does not
 * declare — reaches the real store untouched, bound to it, so nothing here
 * has to track the store's surface as it changes.
 */
function scoped(loader: Loader, owns: (id: string) => boolean): Loader {
  return {
    name: loader.name,
    load: (ctx) =>
      loader.load({
        ...ctx,
        store: new Proxy(ctx.store, {
          get(target, prop) {
            if (prop === 'keys') return () => [...target.keys()].filter(owns);
            // bound to the real store, never to the proxy: a method reading
            // private state must see its own instance
            const value = Reflect.get(target, prop, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }),
      }),
  };
}

/**
 * One note = one `<id>/index.mdx`, and the id IS the route.
 *
 *   notes/design-tokens/index.mdx        → /design-tokens/        (zh, canonical)
 *   notes/components/index.mdx           → /components/           (a hub note)
 *   notes/components/content/index.mdx   → /components/content/   (hub chapter)
 *   notes/en/design-tokens/index.mdx     → /en/design-tokens/     (en mirror)
 *   vault/rlinf-learning/index.mdx       → /vault/rlinf-learning/ (private)
 *
 * zh is the primary locale and its ids carry no prefix; en mirrors carry
 * `en/`. Taxonomy fields are validated against the registry in
 * `_meta/taxonomy.ts` — a typo in `kind:` fails the build instead of
 * silently dropping the note from its shelf.
 *
 * TWO MOUNTS, ONE COLLECTION. The public wiki (`src/content/notes`, the
 * public repo YufengJin/yufeng-wiki) and the private vault
 * (`src/content/vault`, the PRIVATE repo YufengJin/yufeng-vault, gitignored)
 * are separate git repositories that load into a single collection; the
 * vault's ids are stamped into the `vault/` namespace (see lib/private.ts).
 * One collection is what makes the two halves genuinely one wiki: browse
 * pages, the search index, backlinks, the link graph and the note route all
 * read this collection and therefore see both, with nothing to keep in sync.
 *
 * Privacy is a property of the BUILD, not of a flag. The public CI never
 * clones the vault repo, so `src/content/vault` is absent, the second loader
 * is dropped entirely, and the public site cannot render, list, link or
 * index a private note because no such entry ever exists there.
 */
const notesGlob = glob({
  pattern: ['**/index.mdx', '!_meta/**'],
  base: './src/content/notes',
  generateId: ({ entry }) => entry.replace(/\/index\.mdx$/, ''),
});

const vaultMounted = existsSync(new URL('./content/vault', import.meta.url));
const vaultGlob = glob({
  pattern: ['**/index.mdx', '!_meta/**'],
  base: './src/content/vault',
  generateId: ({ entry }) => vaultIdOf(entry.replace(/\/index\.mdx$/, '')),
});

const notes = defineCollection({
  loader: vaultMounted
    ? {
        name: 'notes+vault',
        load: async (ctx) => {
          await scoped(notesGlob, (id) => !isPrivate(id)).load(ctx);
          await scoped(vaultGlob, isPrivate).load(ctx);
        },
      }
    : notesGlob,
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    /** sidebar brand line; falls back to title */
    brand: z.string().optional(),
    subtitle: z.string().optional(),
    /** classification (see _meta/taxonomy.ts). A chapter or mirror inherits
     *  a field it leaves out; a field it sets — `[]` included — is its own.
     *  Inheritable arrays are therefore optional, never defaulted. Aliases
     *  are the exception: entry-local, never inherited (an alias identifies
     *  exactly one note), so they may default to `[]`. */
    kind: z.enum(KIND_IDS).optional(),
    domains: z.array(z.enum(DOMAIN_IDS)).optional(),
    /** free tags; slug-safe so a tag is also its browse route segment, and
     *  unique — a repeated tag would double-count the note in facets */
    tags: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'tag must be a lowercase slug'))
      .refine((tags) => new Set(tags).size === tags.length, { message: 'tags must be unique' })
      .optional(),
    status: z.enum(STATUS_IDS).optional(),
    created: z.coerce.date().optional(),
    updated: z.coerce.date().optional(),
    aliases: z.array(z.string()).default([]),
    sources: z.array(z.object({ title: z.string(), href: z.string().optional() })).optional(),
    /** hubs only: chapter membership and order (ids relative to the hub) */
    nav: z.array(z.object({ group: z.string(), pages: z.array(z.string()) })).optional(),
    /** hub chapters: 1-based position, equal to the chapter's position in
     *  the hub's nav (the build fails on a mismatch or a missing value) */
    part: z.number().int().positive().optional(),
    /** sidebar row label for hub chapters; falls back to title */
    navLabel: z.string().optional(),
    /** how deep the sidebar ToC goes */
    tocDepth: z.union([z.literal(2), z.literal(3)]).default(2),
    /** `false` switches chapter numbering off (a hub's overview page) */
    chapters: z.boolean().default(true),
    /** interactive demo scripts this note mounts (files in public/demos/) */
    demos: z.array(z.string().regex(/^[a-z0-9-]+$/)).optional(),
  }),
});

/**
 * The paper wall: poster pages staged into `public/papers/<slug>/`
 * (scripts/mount-papers.sh — self-contained static HTML + WebP, published
 * verbatim), and this collection reads the same tree's meta.json for the
 * index cards. One mount, both uses.
 */
const papersMounted = existsSync(new URL('../public/papers', import.meta.url));
const papers = defineCollection({
  loader: papersMounted
    ? glob({ pattern: ['*/meta.json'], base: './public/papers' })
    : { name: 'papers-absent', load: async () => {} },
  schema: z.object({
    slug: z.string(),
    title: z.string().optional(),
    title_zh: z.string().optional(),
    title_en: z.string().optional(),
    arxiv_id: z.string().optional(),
    url: z.string().optional(),
    category: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    summary_zh: z.string().optional(),
    summary_en: z.string().optional(),
    date: z.string().optional(),
    source: z.string().optional(),
  }),
});

export const collections = { notes, papers };
