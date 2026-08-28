#!/usr/bin/env node
/**
 * Strict wikilink check over every note the site can render — the public
 * wiki and, where it is mounted, the private vault.
 *
 * Both passes resolve through the site's own wiring (scripts/wikilinks.config.ts
 * → src/lib/wikilinks.ts), so the corpus, the locale table and the path→id
 * rule are the page's, not the CLI's defaults, and the two mounts form ONE
 * graph: a private note may link to a public one and the link resolves.
 *
 * The scan itself is per-directory, hence two passes. The vault pass is
 * skipped when the repository is not mounted — which is exactly the public
 * CI, where the first pass then also proves the public half stands alone:
 * a public note linking into `vault/` fails there, as it should.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const siteDir = fileURLToPath(new URL('..', import.meta.url));
const dirs = ['src/content/notes', 'src/content/vault'].filter((d) =>
  existsSync(new URL(`../${d}`, import.meta.url)),
);

for (const dir of dirs) {
  const result = spawnSync(
    process.execPath,
    [
      'packages/astro-inkbrush/scripts/check-wikilinks.mjs',
      dir,
      '--config',
      'scripts/wikilinks.config.ts',
      '--strict',
    ],
    { cwd: siteDir, stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
