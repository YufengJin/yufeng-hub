/**
 * Is the paper wall part of THIS build?
 *
 * The paper wall is private-site-only content. Its repository
 * (YufengJin/yufeng-papers) is private and the public CI never stages it, so
 * `public/papers/` is simply absent there — exactly how the private vault
 * works: privacy is a property of the BUILD, not of a flag. What does not
 * exist cannot be rendered, listed, linked or indexed.
 *
 * Every surface that shows papers reads this one fact, so an unmounted build
 * emits no /papers/ route, no nav entry, no landing-page tile and no search
 * record. `scripts/check-privacy.mjs` asserts that end to end.
 */
import { existsSync } from 'node:fs';

/**
 * Resolved against the working directory — the project root for both `astro
 * dev` and `astro build` — the same way PapersPage/LandingPage already look
 * up a poster's cover. NOT `new URL(..., import.meta.url)`: Vite bundles this
 * module, so `import.meta.url` points at a chunk rather than at this file and
 * the check silently reads false in every component that imports it.
 */
export const PAPERS_MOUNTED = existsSync('public/papers');
