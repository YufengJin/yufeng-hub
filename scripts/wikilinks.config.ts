/**
 * The `--config` module for the engine's check-wikilinks CLI: it hands the
 * lint the SITE's own resolver (both mounts, the site's locale table, the
 * site's path→id rule) instead of the CLI's built-in one, so a link the
 * gate accepts is exactly a link the page renders.
 *
 * The deploy base is irrelevant to the lint — it compares ids, never URLs —
 * so the resolver is bound to the empty base.
 */
import { noteIdOf, resolverFor } from '../src/lib/wikilinks.ts';

export const wikilinks = { resolve: resolverFor(''), noteIdOf };
