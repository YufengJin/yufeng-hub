/**
 * Build-time search index for the ⌘K palette.
 *
 * The endpoint FACTORY lives in the package (body cleanup, truncation, the
 * SearchDoc shape shared with the client); this file only answers the
 * site-specific questions — which documents, what route, which locale, what
 * crumb label. Two pools feed it: the note collection, and the paper wall
 * (one zh + one en record per poster, built from its meta.json — the poster
 * HTML itself stays out; title/summary/keywords are the searchable surface).
 */
import { getCollection } from 'astro:content';
import { buildSearchIndexEndpoint } from 'astro-inkstone/lib/search-index';

import { localeOfId, routeOfId, UI } from '../lib/i18n';
import { resolveTaxonomy } from '../lib/taxonomy';

export const GET = buildSearchIndexEndpoint({
  loadDocs: async () => {
    const notes = await getCollection('notes');
    const byId = new Map(notes.map((n) => [n.id, n]));
    const noteDocs = notes.map((entry) => {
      // full taxonomy resolution: a chapter inherits its kind from the hub
      // and a mirror from the primary entry, so every page gets its crumb.
      // The crumb is written in the document's own locale — the palette
      // filters the pool by page locale, so it doubles as the scope key.
      const locale = localeOfId(entry.id);
      const { kind } = resolveTaxonomy(entry, byId);
      return {
        id: entry.id,
        route: routeOfId(entry.id),
        locale,
        title: entry.data.title,
        crumb: kind ? UI[locale].kinds[kind].label : '',
        body: entry.body ?? '',
      };
    });

    const papers = (await getCollection('papers')).map((p) => p.data);
    const paperDocs = papers.flatMap((p) => {
      const kw = (p.keywords ?? []).join(' ');
      const zhTitle = p.title_zh ?? p.title ?? p.title_en ?? p.slug;
      const shared = [kw, p.category, p.arxiv_id].filter(Boolean).join('\n');
      return [
        {
          id: `papers/${p.slug}`,
          route: `papers/${p.slug}/`,
          locale: 'zh',
          title: zhTitle,
          crumb: UI.zh.navPapers,
          body: [p.summary_zh, p.title_en, shared].filter(Boolean).join('\n'),
        },
        {
          id: `papers/${p.slug}#en`,
          route: `papers/${p.slug}/`,
          locale: 'en',
          title: p.title_en ?? zhTitle,
          crumb: UI.en.navPapers,
          body: [p.summary_en ?? p.summary_zh, zhTitle, shared].filter(Boolean).join('\n'),
        },
      ];
    });

    return [...noteDocs, ...paperDocs];
  },
});
