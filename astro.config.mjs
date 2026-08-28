// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

// The demo consumes the package one directory up via `file:..`; the package's
// own dependencies resolve from the repo-root node_modules (the engine is
// supplied through the root `workspaces` field). WIKI=1 astro dev is editing
// mode: the astro-inkbrush integration is imported and mounted. A static
// build never imports it, so the output carries zero CMS bytes; the Markdown
// dialect and content guard come from the engine in both modes, through
// siteMarkdown, so the editor and the page share one grammar.
const WIKI_MODE = Boolean(process.env.WIKI);
const { siteMarkdown, sitePluginSets } = await import('astro-inkstone/markdown-preset');
const { secureFsDeny } = await import('astro-inkstone/lib/vite-security');
const { normalizeBase } = await import('astro-inkstone/lib/base');
const inkbrush = WIKI_MODE ? (await import('astro-inkbrush')).inkbrush : null;

// Deploy target: on GitHub Pages the site lives under the /yufeng-hub/
// project path; the ws02 editing machine and local dev serve the same base
// so note URLs match between the two. HUB_BASE accepts any spelling
// ('/docs', 'docs/'); links are built from the normalized prefix.
const SITE = process.env.HUB_SITE || 'https://yufengjin.github.io';
const BASE = process.env.HUB_BASE || '/yufeng-hub';
const BASE_PREFIX = normalizeBase(BASE);

// [[wikilinks]] resolve against the note corpus with the engine's own
// resolver — the same alias/brand/locale rules the CMS preview and the
// check-wikilinks CLI use, so the three can never drift. Both mounts feed
// that one graph; the wiring lives in src/lib/wikilinks.ts, which
// scripts/check-links.mjs loads too, so the gate and the page resolve
// [[x]] with the very same resolver.
const { noteIdOf, resolverFor } = await import('./src/lib/wikilinks.ts');
const resolve = resolverFor(BASE_PREFIX);

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'ignore',
  integrations: [
    mdx(),
    // The CMS preview and save gate get the page's own plugin set (table
    // wrapper, callouts, math, …) rather than the bare dialect; numbering
    // and reading time need the whole document, and the engine mounts its
    // own wikilink resolver.
    ...(inkbrush
      ? [
          inkbrush({
            markdown: {
              ...sitePluginSets({
                math: true,
                callouts: true,
                gemoji: true,
                mermaid: true,
                base: BASE_PREFIX,
                numbering: false,
                readingTime: false,
              }),
              guard: { autoNumberedHeadings: true },
              urlFor: (id) => `${BASE_PREFIX}/${id}/`,
            },
          }),
        ]
      : []),
  ],

  // The whole Markdown pipeline in one call: chapter numbering (hub chapters
  // read frontmatter `part:` for their §k.n heading numbers), math, callouts,
  // mermaid, code frames, :gemoji:, reading time, wikilinks, and the
  // build-failing content guard, whose autoNumberedHeadings switch rejects
  // hand-typed heading numbers (numbering belongs to the build).
  markdown: {
    ...siteMarkdown({
      base: BASE_PREFIX,
      numbering: 'chapters',
      math: true,
      codeFrame: true,
      mermaid: true,
      callouts: true,
      gemoji: true,
      readingTime: true,
      wikiBlocks: WIKI_MODE,
      guard: { autoNumberedHeadings: true },
      wikilinks: {
        resolve,
        noteIdOf,
        onBroken: ({ file, target, kind }) =>
          console.warn(`[wikilinks] ${kind}: [[${target}]] ← ${file ?? '(unknown)'}`),
      },
    }),
  },

  // An editing host is a permanent dev server: Vite's /@fs route must never
  // serve the CMS state, env files or key material. The deny list is the
  // package's; a site adds its own sensitive paths via extraDeny.
  vite: {
    server: {
      allowedHosts: process.env.SITE_HOST ? [process.env.SITE_HOST] : [],
      ...secureFsDeny(),
    },
  },
});
