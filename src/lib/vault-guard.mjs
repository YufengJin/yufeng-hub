// @ts-check
import { posix } from 'node:path';

import { parse, serialize } from 'parse5';

/**
 * 私有站的 vault 门禁：未登录时，私密笔记在全站不存在。
 *
 * 公开站从来不需要这个——公开 CI 不 clone vault，那些字节压根没被生成
 * （scripts/check-privacy.mjs 守的就是这条）。私有站上 vault 挂载在位，
 * 页面、列表、搜索索引里全都有，所以要在运行时按身份挡一次。
 *
 * 为什么做在 vite 中间件层而不是 Astro middleware：站点是 output:'static'，
 * Astro 把页面当预渲染路由，喂给 middleware 的是一个合成的空 Request——
 * 实测连一个请求头都没有，更不用说 cookie。vite 这一层拿得到完整请求。
 *
 * 剥离规则只有一条，不依赖任何新增标记：**指向 vault 的链接所在的那一条
 * 列表项整个消失**。它同时覆盖了 NoteCard（li[data-id^=vault/]）、首页
 * 「最近更新」那种裸 li、以及导航里的 vault 入口。不在列表里的链接
 * （正文里指向私密笔记的 wikilink）降级成纯文本，字还在，路没了。
 *
 * 外加一条给「复制全文」的：笔记页把整个 .mdx 源码放在
 * `<template data-note-source>` 里，源码里的 `[[vault/x]]` 不是 <a>，剥链接
 * 剥不到它。凡源码提到 `vault/` 的页面，未登录时整个复制控件（模板 + 按钮）
 * 一起拿掉——宁可没得复制，不给私密 slug 露头。
 */

/** 私密命名空间：id 或路径里的 vault 段（与 src/lib/private.ts 同一个事实） */
const VAULT = 'vault';

/**
 * 这个站内路径属于私密命名空间吗？（/vault/x、/en/vault/x、/vault-static/x）
 *
 * 第二段的 vault 只在**已登记的语言前缀**之后才算私密——和 private.ts 的
 * 规则一致。否则一篇合法的公开笔记 `topic/vault/chapter` 会被误当私密挡掉。
 *
 * @param {string} pathname
 * @param {readonly string[]} locales 非默认语言的前缀段（如 ['en']）
 */
export function isPrivatePath(pathname, locales = []) {
  const segs = pathname.split('/').filter(Boolean);
  if (segs[0] === 'vault-static') return true;
  if (segs[0] === VAULT) return true;
  return segs.length > 1 && segs[1] === VAULT && locales.includes(segs[0] ?? '');
}

/** 一个 href 指向私密内容吗？base 前缀会先剥掉 */
export function hrefIsPrivate(href, base, locales = []) {
  if (typeof href !== 'string' || href === '') return false;
  // 只看站内链接；协议开头的外链不管
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
  let path = href.split(/[?#]/)[0] ?? '';
  if (!path.startsWith('/')) return false;
  if (base !== '/' && path.startsWith(base)) path = path.slice(base.length - 1);
  return isPrivatePath(path, locales);
}

/**
 * 从一份 JSON 里剔掉私密记录（id 以 vault/ 或 <locale>/vault/ 开头的）。
 * 认两种形状：搜索索引是一个数组；CMS 的 `/api/wiki/notes` 是 `{ notes: [...] }`
 * （给 [[ 自动补全和链接解析用的全站清单，公开路由，vault 笔记也在里面）。
 */
export function stripPrivateRecords(json, locales = []) {
  const keep = (rec) => {
    const id = rec && typeof rec === 'object' ? String(rec.id ?? '') : '';
    if (id === '') return true;
    return !isPrivatePath(`/${id}`, locales);
  };
  if (Array.isArray(json)) return json.filter(keep);
  if (json && typeof json === 'object' && Array.isArray(json.notes)) {
    return { ...json, notes: json.notes.filter(keep) };
  }
  return json;
}

/**
 * CMS 接口里未登录不该看到的那些。两类都直接挡（401），不改写响应体——
 * 改写 API 的 body 会破坏 HTTP 分帧（status line 丢失），得不偿失。
 *
 *  - 指向私密笔记的：`/api/wiki/<route>/<note id>`（meta、block、comments、
 *    annotations、revisions……id 都在路径尾巴上），id 以 vault/ 开头即私密；
 *  - 全站清单 `/api/wiki/notes`：它会连标题带 id 交出每一篇私密笔记。这个
 *    接口只有登录后的自动补全用得到，未登录一律挡。
 *
 * @param {string} path 已剥 base 的路径
 * @param {readonly string[]} locales
 * @returns {'private' | null}
 */
export function privateApi(path, locales = []) {
  const segs = path.split('/').filter(Boolean);
  if (segs[0] !== 'api' || segs[1] !== 'wiki') return null;
  if (segs.length === 3 && segs[2] === 'notes') return 'private';
  if (segs.length > 3 && isPrivatePath(`/${segs.slice(3).join('/')}`, locales)) return 'private';
  return null;
}

/**
 * 第二条剥离规则的标记：带 `data-private-only` 的元素，未登录时整个消失。
 * 给那些**不是链接**却按全量集合算出来的东西用——首页「15 篇 · 5 个方向」、
 * 只有私密笔记用过的方向瓦片、/all/ 上只属于私密笔记的筛选药丸。页面把
 * 全量版打上这个标记、公开版紧跟其后打 `data-public-twin`，登录者靠 CSS
 * 只看见前者（site.css），访客经门禁只剩后者。
 */
export const PRIVATE_ONLY_ATTR = 'data-private-only';

/** 源码里对私密命名空间的任何提法：`[[vault/x]]`、`/vault/x/`、
 *  `src/content/vault/`，以及私密静态子站 `/vault-static/x/` */
const SOURCE_MENTION = /\bvault(-static)?\//;

/** 一段 parse5 节点树的纯文本（template 的内容在 node.content 里） */
function textOf(node) {
  if (!node) return '';
  if (node.nodeName === '#text') return node.value ?? '';
  const kids = node.content ? node.content.childNodes : node.childNodes;
  return (kids ?? []).map(textOf).join('');
}

/**
 * 从一份页面 HTML 里拿掉所有私密痕迹。
 *
 * 返回 `{ html, emptied }`。`emptied` 表示这一页原本有笔记卡片、剥完一张不剩
 * ——那说明它是个只由私密笔记撑起来的页面（比如只有 vault 笔记用过的标签），
 * 光是「它存在、标题里写着几篇」就已经泄漏。这种页面整页挡掉。
 *
 * 为什么不在构建时干脆不生成这些页：vault 笔记自己要链过去，不生成就是死链，
 * dist 门禁会当场拒绝。
 */
export function stripPrivateHtml(html, base, locales = []) {
  // 快速路径要和 hrefIsPrivate 一样宽：它认 `/vault`（无尾斜杠）也是私密，
  // 这里若只找 `vault/` 就会放过一条手写的 `[x](/yufeng-hub/vault)`
  // 标记只认标签上的属性：site.css 那条孪生选择器会随内联样式出现在每一页
  if (!/\bvault(-static)?\b/.test(html) && !/<[a-z][^>]*\sdata-private-only(?=[\s>=])/.test(html)) {
    return { html, emptied: false };
  }
  const cardsBefore = (html.match(/class="note-card"/g) ?? []).length;
  const doc = parse(html);
  let touched = false;

  /** @param {any} node @param {any[]} ancestors */
  const walk = (node, ancestors) => {
    // 子节点可能被删，所以先拷一份再遍历
    for (const child of [...(node.childNodes ?? [])]) {
      // 「复制全文」的源码模板：提到 vault/ 就连同它的控件一起拿掉
      if (child.tagName === 'template' && child.attrs?.some((a) => a.name === 'data-note-source')) {
        if (SOURCE_MENTION.test(textOf(child))) {
          const tools = [...ancestors, node]
            .reverse()
            .find((n) => n.attrs?.some((a) => a.name === 'class' && /\bnote-tools\b/.test(a.value)));
          remove(tools ?? child);
          touched = true;
        }
        continue;
      }
      if (child.tagName && child.attrs?.some((/** @type {any} */ a) => a.name === PRIVATE_ONLY_ATTR)) {
        remove(child);
        touched = true;
        continue;
      }
      if (child.tagName) {
        // 每一个属性都看，不只 href：<img src>、<iframe src>、srcset 里的每个
        // 候选、data-src / data-full 这类懒加载属性，指向私密内容的一样要拿掉。
        // 挑属性名是挑不完的（一个 href="/public" 排在前面就把 src 挡住了），
        // 所以扫全部属性值、srcset 再按逗号拆开。<a> 会降级成文字（unlink 把
        // 子节点提上来），无子节点的 img/iframe 于是原地消失。
        if (attrsPointPrivate(child, base, locales)) {
          const chain = [...ancestors, node];
          const item = chain.reverse().find((n) => n.tagName === 'li');
          if (item) {
            remove(item);
          } else if (chain.some((n) => n.tagName === 'svg')) {
            // 本地图谱把每个邻居画成 <svg> 里的 <a>（圆点 + 标题文字），
            // 没有 <li> 可剥；降级成文字会把私密笔记的标题原样留在图上
            remove(child);
          } else {
            // 先把里面清干净再提上来：<a href=私密><img src=私密></a> 这种，
            // 只 unlink 会把那张私密图片原样留在页面上（提上来的节点不再被遍历）
            walk(child, [...ancestors, node]);
            unlink(child);
          }
          touched = true;
          continue;
        }
      }
      walk(child, [...ancestors, node]);
    }
  };

  /** 整条列表项拿掉 */
  const remove = (node) => {
    const siblings = node.parentNode?.childNodes;
    if (!siblings) return;
    const at = siblings.indexOf(node);
    if (at >= 0) siblings.splice(at, 1);
  };

  /** 链接降级成它自己的文字 */
  const unlink = (node) => {
    const siblings = node.parentNode?.childNodes;
    if (!siblings) return;
    const at = siblings.indexOf(node);
    if (at < 0) return;
    const kids = node.childNodes ?? [];
    for (const k of kids) k.parentNode = node.parentNode;
    siblings.splice(at, 1, ...kids);
  };

  walk(doc, []);
  if (!touched) return { html, emptied: false };
  // 被剥空的面板整块拿掉：只剩标题的「链入本文」和只剩圆心的本地图谱，
  // 都是「有东西链到这里，只是不给你看」的告示
  prunePanels(doc);
  const out = serialize(doc);
  const cardsAfter = (out.match(/class="note-card"/g) ?? []).length;
  return { html: out, emptied: cardsBefore > 0 && cardsAfter === 0 };
}

/**
 * 这个元素的属性里，有指向私密内容的 URL 吗？
 *
 * 扫的是**每一个**属性值而不是点名的几个：`<iframe href="/public"
 * src="/vault-static/x">` 里点名 href 就会先命中公开的那个而漏掉 src，而
 * srcset / data-src / poster 这些名字列也列不全。srcset 再按逗号拆开，取每个
 * 候选的 URL 部分。
 *
 * @param {any} node @param {string} base @param {readonly string[]} locales
 */
function attrsPointPrivate(node, base, locales) {
  for (const attr of node.attrs ?? []) {
    const raw = String(attr.value ?? '');
    if (raw === '') continue;
    const candidates = raw.includes(',')
      ? [raw, ...raw.split(',').map((part) => part.trim().split(/\s+/)[0] ?? '')]
      : [raw];
    if (candidates.some((c) => hrefIsPrivate(c, base, locales))) return true;
  }
  return false;
}

/** 一个 parse5 元素节点带这个 class 吗
 *  @param {any} node @param {string} cls */
function hasClass(node, cls) {
  return node.attrs?.some((/** @type {any} */ a) => a.name === 'class' && a.value.split(/\s+/).includes(cls)) ?? false;
}

/**
 * 剥完链接后，把只剩壳的面板整块删掉：`aside.backlinks` 里 `li` 一个不剩，
 * 或 `nav.lg-wrap`（本地图谱）的 `.lg-list` 里 `li` 一个不剩。
 */
/** @param {any} doc */
function prunePanels(doc) {
  /** @param {any} node @param {string} tag @returns {number} */
  const countTag = (node, tag) => {
    let n = 0;
    for (const c of node.childNodes ?? []) {
      if (c.tagName === tag) n++;
      n += countTag(c, tag);
    }
    return n;
  };
  /** @param {any} node */
  const visit = (node) => {
    for (const child of [...(node.childNodes ?? [])]) {
      if (child.tagName && (hasClass(child, 'backlinks') || hasClass(child, 'lg-wrap'))) {
        if (countTag(child, 'li') === 0) {
          const siblings = node.childNodes;
          siblings.splice(siblings.indexOf(child), 1);
          continue;
        }
      }
      visit(child);
    }
  };
  visit(doc);
}

/**
 * 把一次请求的路径规整成门禁要判断的样子：去掉 query，百分号解码，折叠
 * `.` 与 `..` 段，剥掉 base 前缀。
 *
 * 为什么必须折叠点段：vite 与 astro 自己会折叠，`/./vault/x/` 和
 * `/en/../vault/x/` 打到的都是 `/vault/x/`；门禁若只看字面就被绕过——
 * 实测未登录用这两种写法能整页拿到私密笔记。解码做两遍，双重编码的
 * `%252e%252e` 也现形。返回的 `variants` 是每一步的形态（折叠前后、剥
 * base 前后），私密判断对它们**任一**成立即挡；`path` 是折叠并剥了 base
 * 的那一个，给路由类判断（是不是页面、是不是索引）用。解码失败返回 null
 * ——畸形路径不放行。
 *
 * @param {string} rawUrl
 * @param {string} base 以 / 结尾的 base（'/' 表示无前缀）
 * @returns {{ path: string, variants: string[] } | null}
 */
export function requestPath(rawUrl, base) {
  const cut = rawUrl.search(/[?#]/);
  let p = cut === -1 ? rawUrl : rawUrl.slice(0, cut);
  const stripBase = (/** @type {string} */ x) =>
    base !== '/' && x.startsWith(base) ? x.slice(base.length - 1) : x;
  /** @type {Set<string>} */
  const variants = new Set();
  let path = '';
  try {
    for (let round = 0; round < 2; round++) {
      p = decodeURIComponent(p);
      const norm = posix.normalize(p.startsWith('/') ? p : `/${p}`);
      for (const v of [p, norm, stripBase(p), stripBase(norm)]) variants.add(v);
      if (round === 0) path = stripBase(norm);
      if (!p.includes('%')) break;
    }
  } catch {
    return null;
  }
  return { path, variants: [...variants] };
}

/**
 * 这次请求碰到 vault 的**源文件**了吗？——路径或 query 里，解码两遍、折叠
 * 点段之后，出现 `src/content/vault/` 或 `/vault-static/`。
 *
 * 为什么不能靠 vite 的 `server.fs.deny` 把 vault 目录整个拒掉：astro dev
 * 的图片端点 `/_image?href=/@fs/…/src/content/vault/x/img/fig.svg` 先拿
 * 同一份 deny 名单自检，被拒就退回去用 HTTP 抓 `/@fs/…`，再被拒，最后 500
 * ——私密笔记里的每一张插图都挂，**登录了也一样**（2026-09-07 实测）。
 * deny 名单不认人，而门禁认：登录者放行，未登录一律不给。它覆盖的三条路
 * ——`/@fs/<绝对路径>/src/content/vault/…`、`/src/content/vault/…`、以及
 * `/_image?href=…` 里藏着的这两种——都是同一个正则的事。畸形 URL 解不开
 * 就当碰到了：保密边界往关的方向失败。
 *
 * @param {string} rawUrl
 */
export function mentionsVaultSource(rawUrl) {
  const HIT = /(^|\/)(src\/)?content\/vault(\/|$)|(^|\/)vault-static(\/|$)/;
  let u = rawUrl;
  for (let round = 0; round < 2; round++) {
    try {
      u = decodeURIComponent(u);
    } catch {
      return true;
    }
    if (HIT.test(u)) return true;
    // query 里的每个值、路径本身：折叠 `.`/`..` 之后再看一眼
    for (const piece of u.split(/[?&=#]/)) {
      if (piece.includes('/') && HIT.test(posix.normalize(piece))) return true;
    }
    if (!u.includes('%')) break;
  }
  return false;
}

/* ---------------- the dev-server middleware ---------------- */

/** 只缓冲可能是页面的响应；图片、脚本、样式一律直通 */
function looksLikePage(pathname) {
  const last = pathname.split('/').pop() ?? '';
  return last === '' || !last.includes('.') || last.endsWith('.html');
}

/**
 * 门禁 integration。只在 WIKI 模式的 dev server 上装：公开构建里 vault
 * 根本不存在，没有可挡的东西。
 */
export function vaultGuard({ enabled = true, locales = [] } = {}) {
  let base = '/';
  return {
    name: 'hub:vault-guard',
    hooks: {
      /** @param {{ config: any }} ctx */
      'astro:config:setup': ({ config }) => {
        const b = config.base || '/';
        base = b.endsWith('/') ? b : `${b}/`;
      },
      // 装在 astro:server:setup 而不是 vite 插件的 configureServer 里：门禁
      // 必须排在 inkbrush 的 /api/wiki 中间件**之前**，否则 /api/wiki/notes、
      // /meta/vault/x 这些公开路由会先把私密 id、标题、评论交给未登录的人
      // （实测漏过）。inkbrush 也在 astro:server:setup 里挂中间件，而 astro
      // 按 integrations 顺序跑这个钩子——本 integration 在 astro.config 里
      // 排在 inkbrush 前面，所以它的中间件先入栈、先执行。vite 插件那条路
      // 反而排在 inkbrush 之后（实测），挡得住页面却挡不住 API。
      /** @param {{ server: any }} ctx */
      'astro:server:setup': ({ server }) => {
        if (!enabled) return;
        installGuard(server, base, locales);
      },
    },
  };
}

/** @param {any} server @param {string} base @param {readonly string[]} locales */
function installGuard(server, base, locales) {
      /** 谁在请求？null = 没有有效会话，或不是本站成员 */
      const identityOf = async (req) => {
        try {
          const mod = await server.ssrLoadModule('astro-inkbrush/session');
          const id = await mod.currentIdentity(req.headers.cookie ?? '');
          // 注册表开着时，role 为 null 表示登录了但不在名单里——按未登录处理
          return id && id.role !== null ? id : null;
        } catch (err) {
          // 认证模块加载不了就当没人登录：失败要往关的方向失败
          server.config.logger.error(`vault-guard: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }
      };

      server.middlewares.use((req, res, next) => {
        // 方法不设限：vite 的静态中间件不挑方法，只放行 GET/HEAD 的话
        // 一个 POST /vault-static/<slug>/index.html 就能原样取走私密内容。
        const readOnlyMethod = req.method === 'GET' || req.method === 'HEAD';
        const seen = requestPath(req.url || '/', base);
        if (!seen) {
          // 解码不了的路径：不知道它指向哪，就不放行
          res.statusCode = 400;
          res.setHeader('cache-control', 'no-store');
          res.end();
          return;
        }
        const { path, variants } = seen;
        // vault 源文件与图片端点：见 mentionsVaultSource
        const touchesSource = mentionsVaultSource(req.url || '/');

        // vite 自己的东西（HMR、模块图、内联资源）不经过门禁——除非它指向
        // vault 的源文件（/@fs/…/src/content/vault/…）
        if ((path.startsWith('/@') || path.startsWith('/node_modules/')) && !touchesSource) return next();

        // CMS 接口：几条公开路由（/meta、/comments、/notes）本来会把 vault
        // 笔记的 id、标题、文件路径交给任何人——实测未登录 /api/wiki/notes
        // 列出全部 26 篇。指向私密笔记的接口未登录一律 401；清单接口改写。
        // 其余接口（登录、编辑、同步……）自己有鉴权，照旧放行。
        const api = variants.map((v) => privateApi(v, locales)).find((k) => k !== null) ?? null;
        if (path.startsWith('/api/wiki/') && api === null) return next();

        const isIndex = path === '/search-index.json';
        // 私密与否看路径的每一种形态（折叠点段前后、剥 base 前后）
        const privatePath = api === null && variants.some((v) => isPrivatePath(v, locales));
        const guarded = api !== null || privatePath || touchesSource || isIndex || looksLikePage(path);
        if (!guarded) return next();

        void identityOf(req).then((identity) => {
          if (identity) return next();

          if (api === 'private') {
            res.statusCode = 401;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.setHeader('cache-control', 'no-store');
            res.end(JSON.stringify({ error: 'Sign in required' }));
            return;
          }

          // 私密源文件 / 图片：不是页面，没有登录浮层可弹，直接 403
          if (touchesSource && !privatePath) {
            res.statusCode = 403;
            res.setHeader('cache-control', 'no-store');
            res.end();
            return;
          }

          // 私密页面：整页不给，送回首页让登录浮层自己弹出来
          if (privatePath) {
            res.statusCode = 302;
            res.setHeader('location', `${base}?needs_login=vault`);
            res.setHeader('cache-control', 'no-store');
            res.end();
            return;
          }

          // 公开页面 + 写方法：静态页面本来就不接受 POST，而 astro dev 对
          // 方法不挑，会把整页原样吐回来——实测 POST / 带着 vault 卡片回来。
          // 改写只做给 GET/HEAD；其余方法不改写也不放行，直接 405。
          if (!readOnlyMethod) {
            res.statusCode = 405;
            res.setHeader('allow', 'GET, HEAD');
            res.setHeader('cache-control', 'no-store');
            res.end();
            return;
          }

          // 其余页面照发，但发出去之前把私密痕迹摘掉
          let emptiedPage = false;
          interceptBody(
            res,
            (buf, type) => {
            if (isIndex || type.includes('json')) {
              try {
                return Buffer.from(JSON.stringify(stripPrivateRecords(JSON.parse(buf.toString('utf8')), locales)));
              } catch {
                // 这是保密边界，解析不了就不能原样放行——那份 JSON 里可能
                // 正躺着 52 条私密记录。发一个空数组，宁可让搜索没结果。
                return Buffer.from('[]');
              }
            }
            if (type.includes('html')) {
              const { html, emptied } = stripPrivateHtml(buf.toString('utf8'), base, locales);
              // 剥空 = 这一页只有私密笔记撑着，它的存在本身就是泄漏
              if (emptied) {
                emptiedPage = true;
                return Buffer.from('', 'utf8');
              }
              return Buffer.from(html, 'utf8');
            }
            return buf;
            },
            () => emptiedPage,
            `${base}?needs_login=vault`,
          );
          next();
        });
      });
}

/**
 * 把一次响应的 body 攒起来，交给 transform 改写后再发。
 * content-length 跟着改；chunked 的响应则保持 chunked。
 */
function interceptBody(res, transform, shouldBlock, blockedUrl) {
  /** 改写抛错时记下来：它和"剥空"一样要挡住，不能原样放行 */
  let failedToStrip = null;
  const chunks = [];
  const write = res.write.bind(res);
  const end = res.end.bind(res);
  const writeHead = res.writeHead.bind(res);

  // astro 走的是 writeHead(status, headers)，而那样传进去的头
  // getHeader() 是读不到的——只看 getHeader 会让整个改写静默失效。
  let headHeaders = null;
  let pendingHead = null;
  res.writeHead = (status, reasonOrHeaders, maybeHeaders) => {
    const headers = typeof reasonOrHeaders === 'string' ? maybeHeaders : reasonOrHeaders;
    if (headers) headHeaders = headers;
    // 头要等 body 改写完、content-length 定下来之后再发
    pendingHead = [status, reasonOrHeaders, maybeHeaders];
    return res;
  };

  /** 无论头是怎么设的，都能问出 content-type */
  const contentType = () => {
    const fromHead = headHeaders
      ? Object.entries(headHeaders).find(([k]) => k.toLowerCase() === 'content-type')?.[1]
      : undefined;
    return String(fromHead ?? res.getHeader('content-type') ?? '');
  };

  const push = (chunk, encoding) => {
    if (chunk === undefined || chunk === null) return;
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
  };

  res.write = (chunk, encoding, cb) => {
    push(chunk, encoding);
    const done = typeof encoding === 'function' ? encoding : cb;
    // 回调是异步契约，同步调用会打乱调用方的顺序假设
    if (typeof done === 'function') queueMicrotask(done);
    return true;
  };

  let ended = false;
  res.end = (chunk, encoding, cb) => {
    // 二次 end()：body 已经发过了，再走一遍会重跑 transform 并再次 writeHead
    // （ERR_HTTP_HEADERS_SENT）。转发给原始实现也不行——带 chunk 的那个重载会
    // 触发 ERR_STREAM_WRITE_AFTER_END。丢掉 body，只把回调按异步契约兑现。
    if (ended) {
      const again = typeof chunk === 'function' ? chunk : typeof encoding === 'function' ? encoding : cb;
      if (typeof again === 'function') queueMicrotask(again);
      return res;
    }
    ended = true;
    let done;
    if (typeof chunk === 'function') {
      done = chunk;
    } else if (typeof encoding === 'function') {
      done = encoding;
      push(chunk, undefined);
    } else {
      done = cb;
      push(chunk, encoding);
    }

    let body;
    try {
      body = transform(Buffer.concat(chunks), contentType());
    } catch (err) {
      // 剥离失败时发原样，等于把带 vault 的整页交给未登录的人。保密边界
      // 只能往关的方向失败：当作"剥空"处理，走和私密页面一样的 302。
      failedToStrip = err;
      body = Buffer.alloc(0);
    }

    // 剥空的页面不发空白页，改成和私密路径一样的 302。头要自己发全：
    // astro 那次 writeHead 被拦下了，这里不补就没有人发。
    // 挡住的两种情形：剥空（这一页只有私密内容撑着）和剥离本身出错
    // （保密边界只能往关的方向失败）。去处是同一个。
    const blocked = failedToStrip !== null || shouldBlock();
    if (blocked && !res.headersSent) {
      pendingHead = null;
      writeHead(302, {
        location: blockedUrl,
        'cache-control': 'no-store',
        'content-length': '0',
      });
      return end(typeof done === 'function' ? done : undefined);
    }

    if (pendingHead) {
      const [status, reasonOrHeaders, maybeHeaders] = pendingHead;
      const headers = typeof reasonOrHeaders === 'string' ? maybeHeaders : reasonOrHeaders;
      if (headers) {
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'content-length') headers[key] = String(body.length);
        }
      }
      writeHead(status, reasonOrHeaders, maybeHeaders);
    } else if (!res.headersSent && res.getHeader('content-length') !== undefined) {
      res.setHeader('content-length', String(body.length));
    }

    write(body);
    return end(typeof done === 'function' ? done : undefined);
  };
}
