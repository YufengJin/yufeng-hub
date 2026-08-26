import { existsSync } from 'node:fs';

import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

import { DOMAIN_IDS, KIND_IDS, STATUS_IDS } from './content/notes/_meta/taxonomy';

/**
 * One note = one `<id>/index.mdx`, and the id IS the route.
 *
 *   notes/design-tokens/index.mdx        → /design-tokens/        (en, canonical)
 *   notes/components/index.mdx           → /components/           (a hub note)
 *   notes/components/content/index.mdx   → /components/content/   (hub chapter)
 *   notes/zh/design-tokens/index.mdx     → /zh/design-tokens/     (zh mirror)
 *
 * en is the primary locale and its ids carry no prefix; zh mirrors carry
 * `zh/`. Taxonomy fields are validated against the registry in
 * `_meta/taxonomy.ts` — a typo in `kind:` fails the build instead of
 * silently dropping the note from its shelf.
 */
const notes = defineCollection({
  loader: glob({
    pattern: ['**/index.mdx', '!_meta/**'],
    base: './src/content/notes',
    generateId: ({ entry }) => entry.replace(/\/index\.mdx$/, ''),
  }),
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
 * The private vault — a separate PRIVATE repository cloned into
 * `src/content/vault` (gitignored). The public CI build never clones it, so
 * the whole collection is empty there and no /vault/ page is generated:
 * privacy by construction, not by access control. The loader is swapped for
 * a no-op when the mount is absent — a glob over a missing base would warn
 * on every build.
 */
const vaultMounted = existsSync(new URL('./content/vault', import.meta.url));
const vault = defineCollection({
  loader: vaultMounted
    ? glob({
        pattern: ['**/index.mdx', '**/index.md', '!_meta/**'],
        base: './src/content/vault',
        generateId: ({ entry }) => entry.replace(/\/index\.mdx?$/, ''),
      })
    : { name: 'vault-absent', load: async () => {} },
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    created: z.coerce.date().optional(),
    updated: z.coerce.date().optional(),
  }),
});

/**
 * The paper wall's data: every poster's meta.json from the paper-snapshots
 * repo, sparse-cloned into `src/content/papers` (gitignored) by CI and by
 * the ws02 mount script. Posters themselves stay on the published site —
 * the hub renders the index and links out.
 */
const papersMounted = existsSync(new URL('./content/papers', import.meta.url));
const papers = defineCollection({
  loader: papersMounted
    ? glob({ pattern: ['*/meta.json', '!_src/**'], base: './src/content/papers' })
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

export const collections = { notes, vault, papers };
