/**
 * The site's wikilink wiring in one place: the note corpus (BOTH mounts),
 * the resolver over it, and the path→id rule.
 *
 * `astro.config.mjs` mounts these in the Markdown pipeline and
 * `scripts/check-links.mjs` hands the same objects to the engine's lint
 * through `--config`, so the gate and the page can never disagree about
 * what `[[x]]` means — which is the whole point of having one module.
 */
import { buildWikilinkResolver, cachedScan } from 'astro-inkbrush/wikilinks';

import { LOCALE_DEFS } from '../content/notes/_meta/locales.ts';
import { vaultIdOf } from './private.ts';

export const NOTES_DIR = 'src/content/notes';
export const VAULT_DIR = 'src/content/vault';

const scanPublic = cachedScan(NOTES_DIR);
const scanVault = cachedScan(VAULT_DIR);

/**
 * Every note of both mounts, the vault's ids stamped into their namespace —
 * one graph, so a private note can link to a public one, backlinks and the
 * local graph come out right on both sides, and an alias is unambiguous
 * across the whole corpus.
 *
 * `scanNotes` returns [] for a directory that is not there, so the public
 * build's graph simply contains no private notes. The corollary is
 * deliberate: a PUBLIC note that links to a private one is a dead link in
 * public CI, and the lint fails there. The public half must stand alone.
 */
export const noteCorpus = () => [
  ...scanPublic(),
  ...scanVault().map((note) => ({ ...note, id: vaultIdOf(note.id) })),
];

/** source path → note id, for both mounts */
export function noteIdOf(path?: string): string | undefined {
  const pub = path?.match(/src\/content\/notes\/(.+)\/index\.mdx?$/)?.[1];
  if (pub) return pub;
  const priv = path?.match(/src\/content\/vault\/(.+)\/index\.mdx?$/)?.[1];
  return priv ? vaultIdOf(priv) : undefined;
}

/** the resolver, bound to a deploy base prefix (''/'/yufeng-hub') */
export const resolverFor = (basePrefix: string) =>
  buildWikilinkResolver({
    notes: noteCorpus,
    urlFor: (id) => `${basePrefix}/${id}/`,
    locales: LOCALE_DEFS.map(({ code, prefix }) => ({ code, prefix })),
  });
