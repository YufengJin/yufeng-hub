#!/usr/bin/env node
/**
 * Dialect + content-guard compile gate over every note the site can render —
 * the public wiki and, where it is mounted, the private vault.
 *
 * Private notes are written in the same dialect as public ones and go
 * through the same gate: hand-typed heading numbers, single-line `$$`,
 * unpaired emphasis and formulas KaTeX cannot render fail there too. A
 * private draft that would not compile in the wiki must not compile here —
 * that is what "one wiki, two halves" has to mean to be worth anything.
 *
 * The vault pass is skipped when the repository is not mounted (the public
 * CI), where there is nothing private to check.
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
    ['packages/astro-inkbrush/scripts/check-content.mjs', dir, '--math'],
    { cwd: siteDir, stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
