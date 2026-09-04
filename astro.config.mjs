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
const { devPublicDirs } = await import('./src/lib/dev-public-dirs.mjs');
const { vaultGuard } = await import('./src/lib/vault-guard.mjs');
// 已登记的非默认语言前缀：门禁据此判断 `en/vault/x` 是私密，而一篇公开的
// `topic/vault/chapter` 不是。
const { LOCALE_CODES } = await import('./src/content/notes/_meta/locales.ts');
const inkbrush = WIKI_MODE ? (await import('astro-inkbrush')).inkbrush : null;

// Deploy target: on GitHub Pages the site lives under the /yufeng-hub/
// project path; the ws02 editing machine and local dev serve the same base
// so note URLs match between the two. HUB_BASE accepts any spelling
// ('/docs', 'docs/'); links are built from the normalized prefix.
const SITE = process.env.HUB_SITE || 'https://yufengjin.github.io';
const BASE = process.env.HUB_BASE || '/yufeng-hub';
const BASE_PREFIX = normalizeBase(BASE);

// Hostnames the dev server and the static preview may be reached by (see the
// vite block at the bottom); empty means IP-only access.
const ALLOWED_HOSTS = (process.env.SITE_HOST ?? '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

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
    // 私有站的 vault 门禁：未登录时私密笔记在全站不存在（页面、列表卡片、
    // 搜索索引一起挡）。必须排在 devPublicDirs 之前——/vault-static/ 会被
    // 那一层直接接管，晚了就挡不住了。公开构建不装：那边没有 vault。
    ...(WIKI_MODE ? [vaultGuard({ locales: LOCALE_CODES })] : []),
    // dev-only：public/ 下的静态子站（论文墙、私密静态站）按目录 URL
    // 打开时会被 catch-all 路由抢走并 404；build 无此问题，见模块注释。
    devPublicDirs(),
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
  //
  // allowedHosts is Vite's Host-header check (DNS-rebinding protection).
  // Both long-running servers on this box are reached by their tailnet NAME,
  // and dev and preview take SEPARATE config: the editing server is `server`,
  // the private static site is `preview`. Configuring only `server` is why
  // http://<name>:4321 answered "Blocked request" while the IP still worked —
  // an IP host is never checked. SITE_HOST takes a comma-separated list, so
  // the MagicDNS short name and the full name can both be named.
  vite: {
    // 私密挂载的源文件绝不能经 HTTP 出去。vault-guard 挡的是页面路由，
    // 而 vite 还有 /@fs/、/src/…、/public/… 三条直达文件的路——实测未登录
    // 能整篇读到 src/content/vault/<id>/index.mdx。这一层对所有人关闭它们：
    // 渲染页面走的是 node 直接读文件，不经过这条 HTTP 通道。
    server: {
      allowedHosts: ALLOWED_HOSTS,
      ...secureFsDeny(['**/src/content/vault/**', '**/public/vault-static/**']),
    },
    preview: { allowedHosts: ALLOWED_HOSTS },
  },
});
