// @ts-check
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

/** 搜索索引里剔掉私密记录（id 以 vault/ 或 <locale>/vault/ 开头的） */
export function stripPrivateRecords(json, locales = []) {
  if (!Array.isArray(json)) return json;
  return json.filter((rec) => {
    const id = rec && typeof rec === 'object' ? String(rec.id ?? '') : '';
    if (id === '') return true;
    return !isPrivatePath(`/${id}`, locales);
  });
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
  if (!html.includes(`${base}${VAULT}/`) && !html.includes(`${base}${VAULT}-static/`) && !/\/vault\//.test(html)) {
    return { html, emptied: false };
  }
  const cardsBefore = (html.match(/class="note-card"/g) ?? []).length;
  const doc = parse(html);
  let touched = false;

  /** @param {any} node @param {any[]} ancestors */
  const walk = (node, ancestors) => {
    // 子节点可能被删，所以先拷一份再遍历
    for (const child of [...(node.childNodes ?? [])]) {
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
  let astroBase = '/';
  return {
    name: 'hub:vault-guard',
    hooks: {
      /** @param {{ config: any, command: string, updateConfig: (c: any) => void }} ctx */
      'astro:config:setup': ({ config, command, updateConfig }) => {
        astroBase = config.base || '/';
        if (!enabled || command !== 'dev') return;
        const base = astroBase.endsWith('/') ? astroBase : `${astroBase}/`;
        updateConfig({ vite: { plugins: [guardPlugin(base, locales)] } });
      },
    },
  };
}

/** @param {string} base @param {readonly string[]} locales */
function guardPlugin(base, locales) {
  return {
    name: 'hub:vault-guard',
    apply: /** @type {const} */ ('serve'),
    /** @param {any} server */
    configureServer(server) {
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
        // 只有「改写响应」这件事才限于 GET/HEAD。
        const readOnlyMethod = req.method === 'GET' || req.method === 'HEAD';
        const url = req.url || '/';
        const cut = url.search(/[?#]/);
        const rawPath = cut === -1 ? url : url.slice(0, cut);
        let path;
        try {
          path = decodeURIComponent(rawPath);
        } catch {
          return next();
        }
        if (base !== '/' && path.startsWith(base)) path = path.slice(base.length - 1);

        // vite 自己的东西（HMR、模块图、内联资源）不经过门禁
        if (path.startsWith('/@') || path.startsWith('/node_modules/') || path.startsWith('/api/wiki/')) {
          return next();
        }

        const isIndex = path === '/search-index.json';
        const guarded = isPrivatePath(path, locales) || ((isIndex || looksLikePage(path)) && readOnlyMethod);
        if (!guarded) return next();

        void identityOf(req).then((identity) => {
          if (identity) return next();

          // 私密页面：整页不给，送回首页让登录浮层自己弹出来
          if (isPrivatePath(path, locales)) {
            res.statusCode = 302;
            res.setHeader('location', `${base}?needs_login=vault`);
            res.setHeader('cache-control', 'no-store');
            res.end();
            return;
          }

          // 其余页面照发，但发出去之前把私密痕迹摘掉
          if (!readOnlyMethod) return next();
          let emptiedPage = false;
          interceptBody(
            res,
            (buf, type) => {
            if (isIndex || type.includes('json')) {
              try {
                return Buffer.from(JSON.stringify(stripPrivateRecords(JSON.parse(buf.toString('utf8')), locales)));
              } catch {
                return buf;
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
            () => (emptiedPage ? `${base}?needs_login=vault` : null),
          );
          next();
        });
      });
    },
  };
}

/**
 * 把一次响应的 body 攒起来，交给 transform 改写后再发。
 * content-length 跟着改；chunked 的响应则保持 chunked。
 */
function interceptBody(res, transform, redirectIf) {
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
    } catch {
      body = Buffer.concat(chunks); // 改写失败就发原样，别把页面弄丢
    }

    // 剥空的页面不发空白页，改成和私密路径一样的 302。头要自己发全：
    // astro 那次 writeHead 被拦下了，这里不补就没有人发。
    const to = redirectIf?.();
    if (to && !res.headersSent) {
      pendingHead = null;
      writeHead(302, {
        location: to,
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
