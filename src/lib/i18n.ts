/**
 * i18n.ts — locale model shared by routes, layout and chrome, driven
 * entirely by the registry in `../content/notes/_meta/locales.ts`.
 *
 * The default locale's note ids carry NO prefix and are served at root
 * paths; every other locale's ids carry `<code>/` and are served under
 * `/<code>/…`. The id↔route identity (route = `/${id}/`) is load-bearing:
 * it is what makes the single inkbrush-note-url template `${base}{id}/`
 * work for the language-switch jump in astro-inkbrush (whose locale
 * registry likewise treats the default locale as unprefixed). Mirrors are
 * materialized only where a file exists — there is no fallback route tree.
 *
 * UI strings live in one file per locale under ./ui/; the UIStrings type
 * keeps every file total, so a missing string is a type error, never a
 * silent fallback.
 */
import {
  DEFAULT_LOCALE,
  LOCALE_DEFS,
  type Locale,
  type LocaleDef,
} from '../content/notes/_meta/locales';
import type { UIStrings } from './ui/types';
import { strings as en } from './ui/en';
import { strings as zh } from './ui/zh';

export { DEFAULT_LOCALE, LOCALE_DEFS as LOCALES };
export type { Locale, LocaleDef };

/** UI chrome strings, one total table per locale */
export const UI: Record<Locale, UIStrings> = { zh, en };

/** the site's name — chrome brand, identical in every language */
export const SITE_NAME = 'Yufeng Hub';

const byCode = new Map<Locale, LocaleDef>(LOCALE_DEFS.map((l) => [l.code, l]));
const mirrors = LOCALE_DEFS.filter((l) => l.prefix !== '');

export function localeDef(locale: Locale): LocaleDef {
  return byCode.get(locale)!;
}

export function localeOfId(noteId: string): Locale {
  for (const l of mirrors) {
    if (noteId === l.code || noteId.startsWith(l.prefix)) return l.code;
  }
  return DEFAULT_LOCALE;
}

/** strip the locale prefix: 'en/design/tokens' → 'design/tokens' */
export function baseIdOf(noteId: string): string {
  const l = localeDef(localeOfId(noteId));
  return noteId === l.code ? '' : noteId.slice(l.prefix.length);
}

/** the note's id in another locale (whether or not that file exists) */
export function idIn(locale: Locale, baseId: string): string {
  return `${localeDef(locale).prefix}${baseId}`;
}

/** site-root-relative route of a page id ('' = home) */
export function routeOfId(noteId: string): string {
  return noteId === '' ? '' : `${noteId}/`;
}

/** route prefix of a locale's page tree: '' for the default, '<code>/' else */
export function localePrefix(locale: Locale): string {
  return localeDef(locale).prefix;
}

/** the locale's landing page route — where a language switch lands when the
 *  current page has no twin in that locale */
export function landingRoute(locale: Locale): string {
  return localePrefix(locale);
}

/** one language-menu / hreflang entry: a locale and the page's route in it */
export interface Alternate {
  code: Locale;
  route: string;
}

/** a browse page's routes across every locale (browse trees are complete by
 *  construction — one parameterized route file serves all locales) */
export function browseAlternates(subpath: string): Alternate[] {
  return LOCALE_DEFS.map((l) => ({ code: l.code, route: `${l.prefix}${subpath}` }));
}

/** join a root-relative route with the deploy base */
export function href(route: string): string {
  const base = import.meta.env.BASE_URL;
  const b = base.endsWith('/') ? base : `${base}/`;
  return b + route.replace(/^\//, '');
}

/** this hub's shell repository */
export const GITHUB_URL = 'https://github.com/YufengJin/yufeng-hub';
