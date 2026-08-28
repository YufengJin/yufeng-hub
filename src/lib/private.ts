/**
 * The vault namespace — the one fact that says "this note is private".
 *
 * A private note is an ordinary `notes` entry whose id sits under the
 * `vault/` segment (`vault/rlinf-learning`, `en/vault/rlinf-learning`), so
 * it walks the same route, the same layout, the same taxonomy and the same
 * link graph as every public note. The namespace is stamped by the content
 * config from the MOUNT a file came from — never by frontmatter. A note is
 * private because of where it lives, so no author can publish one by
 * mistyping a flag, and no public note can claim a privacy it does not have.
 *
 * This module does NOT enforce privacy. The build does: the public CI never
 * clones the vault repository, `src/content/vault` does not exist there, its
 * loader is dropped, and not one of these ids is ever generated — no page,
 * no card, no search record, no link. What follows only tells the private
 * site how to LABEL what only the private site has.
 *
 * Deliberately free of heavy imports: `content.config.ts` loads it too.
 */
import { LOCALE_DEFS } from '../content/notes/_meta/locales.ts';

/** the id segment that marks the private namespace */
export const VAULT_SEGMENT = 'vault';

/** id prefixes of the non-default locales ('en/'), longest first so a
 *  locale whose code prefixes another still matches its own */
const PREFIXES = LOCALE_DEFS.map((l) => l.prefix)
  .filter((p) => p !== '')
  .sort((a, b) => b.length - a.length);

/** the locale prefix an id carries; '' for the default locale */
function prefixOf(id: string): string {
  return PREFIXES.find((p) => id.startsWith(p)) ?? '';
}

/**
 * The note id of a file in the vault mount. The locale prefix keeps its
 * leading position and `vault/` goes after it, so a private mirror lands in
 * the same locale tree as every other mirror and `baseIdOf` still strips a
 * locale the way it does everywhere else:
 *
 *   'hello'    → 'vault/hello'
 *   'en/hello' → 'en/vault/hello'
 */
export function vaultIdOf(relId: string): string {
  const p = prefixOf(relId);
  return `${p}${VAULT_SEGMENT}/${relId.slice(p.length)}`;
}

/** is this note id in the vault namespace? */
export function isPrivate(noteId: string): boolean {
  const rest = noteId.slice(prefixOf(noteId).length);
  return rest === VAULT_SEGMENT || rest.startsWith(`${VAULT_SEGMENT}/`);
}

/**
 * The id with the namespace segment taken out and the locale prefix left
 * where it is — the inverse of `vaultIdOf`:
 *
 *   'vault/hello'      → 'hello'
 *   'en/vault/hello'   → 'en/hello'
 *   'vault/rlinf/setup'→ 'rlinf/setup'
 *
 * This is what lets the private half be read by rules written for the
 * public one. The engine's taxonomy resolver reads ids POSITIONALLY — `a/b`
 * is chapter `b` of hub `a`, and only an id without a slash is a top-level
 * note — so a private note read literally would come out as a chapter of a
 * hub named "vault" and would never reach a shelf. Stripping the namespace
 * first makes those positional rules mean what they should.
 */
export function withoutVault(noteId: string): string {
  if (!isPrivate(noteId)) return noteId;
  const p = prefixOf(noteId);
  return p + noteId.slice(p.length + VAULT_SEGMENT.length).replace(/^\//, '');
}
