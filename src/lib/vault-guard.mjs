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

/** 源码里对私密命名空间的任何提法：`[[vault/x]]`、`/vault/x/`、`src/content/vault/` */
const SOURCE_MENTION = /\bvault\//;

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
  if (
    !html.includes(`${base}${VAULT}/`) &&
    !html.includes(`${base}${VAULT}-static/`) &&
    !/\/vault\//.test(html) &&
    !SOURCE_MENTION.test(html)
  ) {
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
      if (child.tagName === 'a') {
        const href = child.attrs?.find((a) => a.name === 'href')?.value;
        if (hrefIsPrivate(href, base, locales)) {
          const item = [...ancestors, node].reverse().find((n) => n.tagName === 'li');
          if (item) {
            remove(item);
          } else {
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
  const out = serialize(doc);
  const cardsAfter = (out.match(/class="note-card"/g) ?? []).length;
  return { html: out, emptied: cardsBefore > 0 && cardsAfter === 0 };
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

        // vite 自己的东西（HMR、模块图、内联资源）不经过门禁
        if (path.startsWith('/@') || path.startsWith('/node_modules/')) return next();

        // CMS 接口：几条公开路由（/meta、/comments、/notes）本来会把 vault
        // 笔记的 id、标题、文件路径交给任何人——实测未登录 /api/wiki/notes
        // 列出全部 26 篇。指向私密笔记的接口未登录一律 401；清单接口改写。
        // 其余接口（登录、编辑、同步……）自己有鉴权，照旧放行。
        const api = variants.map((v) => privateApi(v, locales)).find((k) => k !== null) ?? null;
        if (path.startsWith('/api/wiki/') && api === null) return next();

        const isIndex = path === '/search-index.json';
        // 私密与否看路径的每一种形态（折叠点段前后、剥 base 前后）
        const privatePath = api === null && variants.some((v) => isPrivatePath(v, locales));
        const guarded = api !== null || privatePath || isIndex || looksLikePage(path);
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

  res.end = (chunk, encoding, cb) => {
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
