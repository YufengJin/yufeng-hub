// @ts-check
import { realpathSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/**
 * dev-only：让 public/ 下的静态子站能按目录 URL 打开。
 *
 * 私有站是常驻的 `astro dev`，而 dev 下 catch-all 的
 * src/pages/[...slug].astro 会先匹配 /papers/<slug>/ 这类目录 URL——
 * getStaticPaths 只产出笔记路由，没有它，于是 router 直接 404，请求根本
 * 到不了 vite 的 public 静态服务。同一个文件显式写成
 * /papers/<slug>/index.html 反而 200：那条 URL 路由器不认，落到了静态
 * 服务。论文墙列表页上每张卡片链接的都是目录形式，336 篇海报因此在私有
 * 站上一篇都点不进去（/vault-static/<slug>/ 同病）。
 *
 * `astro build` 是把整个 public 拷进 dist 的，公开站从来没有这个问题——
 * 所以这一层只补 dev，让 dev 的行为向 build 看齐。
 *
 * 做法是**改写 req.url 再放行**，而不是自己发响应：中间件走 vite 插件的
 * configureServer 注册，因而排在 vite 自己那批内部中间件之前，命中后把
 * /papers/<slug>/ 改成 /papers/<slug>/index.html 交回去，ETag、304、
 * Range、HEAD、读取出错的处理就全是 vite 的了，这一层不碰 HTTP 语义。
 * 而 astro 的路由 handler 装在更后面（它是 configureServer 的 post hook），
 * 所以改写发生在 catch-all 抢走这条 URL 之前。
 *
 * 接管条件收得很紧：只有 public 下真的存在 <path>/index.html 才改写，
 * 所以 /papers/ 本身（public/papers/index.html 不存在）照旧走
 * src/pages/papers/index.astro 那个真实列表页。
 */
export function devPublicDirs() {
  return {
    name: 'hub:dev-public-dirs',
    hooks: {
      /** @param {{ config: any, command: string, updateConfig: (c: any) => void }} ctx */
      'astro:config:setup': ({ config, command, updateConfig }) => {
        if (command !== 'dev') return;
        const raw = config.base || '/';
        const base = raw.endsWith('/') ? raw : `${raw}/`;
        updateConfig({ vite: { plugins: [publicDirIndexPlugin(base)] } });
      },
    },
  };
}

/**
 * @param {string} base astro 的 base，保证带尾斜杠（'/yufeng-hub/'）
 */
function publicDirIndexPlugin(base) {
  return {
    name: 'hub:dev-public-dirs',
    apply: /** @type {const} */ ('serve'),
    /** @param {any} server */
    configureServer(server) {
      const publicDir = resolve(server.config.publicDir);
      let realPublicDir = publicDir;
      try {
        realPublicDir = realpathSync(publicDir);
      } catch {
        return; // 没有 public 目录，没什么可做的
      }

      server.middlewares.use((/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();

        // query / hash 原样留着——改写和重定向都不能把它们弄丢
        const url = req.url || '/';
        const cut = url.search(/[?#]/);
        const path = cut === -1 ? url : url.slice(0, cut);
        const suffix = cut === -1 ? '' : url.slice(cut);

        // 已经点名了文件的请求本来就走得通
        if (path.endsWith('/index.html')) return next();

        // 这个中间件排在 vite 的 base 中间件之前，所以前缀通常还在；
        // 剥掉后的那份只用来查文件，改写与重定向都在原样的 path 上做。
        const hasBase = base !== '/' && path.startsWith(base);
        const sitePath = hasBase ? path.slice(base.length - 1) : path;

        // 解码只喂给文件系统：拿它判断尾斜杠会把 %2F 当成真斜杠
        let decoded;
        try {
          decoded = decodeURIComponent(sitePath);
        } catch {
          return next();
        }
        if (decoded.includes('\0')) return next();

        const rel = decoded.replace(/\/+$/, '');
        if (rel === '') return next();

        const dir = resolve(publicDir, `.${rel}`);
        if (dir !== publicDir && !dir.startsWith(publicDir + sep)) return next();

        // realpath 之后再查一次归属：词法检查挡得住 ..，挡不住符号链接
        let file;
        try {
          file = realpathSync(join(dir, 'index.html'));
          if (!statSync(file).isFile()) return next();
        } catch {
          return next(); // public 下没有这个静态子站，交回 astro 路由
        }
        if (!file.startsWith(realPublicDir + sep)) return next();

        // 海报页里的资源是相对路径（img/…），少了尾斜杠会解析到上一层。
        // 用 302 而不是 301：dev 上的重定向不该被浏览器长期记住。
        if (!path.endsWith('/')) {
          res.statusCode = 302;
          res.setHeader('location', `${hasBase ? path : base.slice(0, -1) + rel}/${suffix}`);
          res.setHeader('cache-control', 'no-store');
          res.end();
          return;
        }

        req.url = `${path}index.html${suffix}`;
        next();
      });
    },
  };
}
