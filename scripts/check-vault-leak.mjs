#!/usr/bin/env node
// @ts-check
/**
 * 私有站的防漏门禁：以**未登录**身份抓一遍站点，断言 vault 一个字都没漏。
 *
 * check-privacy.mjs 守的是另一半——公开构建的产物里不能有私密内容。那条
 * 靠「公开 CI 不 clone vault」保证，很硬。私有站上 vault 挂载在位，页面、
 * 列表卡片、搜索索引里全都有，只有运行时的门禁（src/lib/vault-guard.mjs）
 * 挡着。门禁的规则是「指向 vault 的链接所在的列表项整个消失」，而规则漏
 * 一处就是一次泄漏——靠人眼保证不住，所以在这里真抓一遍。
 *
 * 站点没跑就跳过（公开 CI 上本来就没有私有站，也没有 vault 可漏）。
 */
import { request } from 'node:http';
import { exit } from 'node:process';

const BASE = process.env.HUB_BASE ?? '/yufeng-hub';
const ORIGIN = process.env.WIKI_ORIGIN ?? 'http://100.81.38.119:4321';
const ROOT = `${ORIGIN}${BASE.replace(/\/$/, '')}`;

/** 未登录必须看不到任何 vault 痕迹的页面 */
const PAGES = ['/', '/all/', '/en/', '/papers/'];
/** 这些整页都不该给。带点段的写法是同一页的别名——vite/astro 会折叠
 *  `.` 与 `..`，门禁若只看字面就被绕过（修过一次的真漏洞） */
const BLOCKED = [
  '/vault/',
  '/vault/rlinf-learning/',
  '/vault-static/rlinf-learning/',
  '/./vault/rlinf-learning/',
  '/en/../vault/rlinf-learning/',
  '/./vault-static/rlinf-learning/index.html',
  '/vault/rlinf-learning/index.html',
];

const failures = [];

/**
 * 原样发请求：fetch 会先把 URL 里的点段折叠掉，`/./vault/` 到不了服务器，
 * 探不出门禁有没有自己折叠；所以直接用 node:http 按字面发。
 * @param {string} path
 * @param {string} [method]
 * @returns {Promise<{ status: number, location: string | null, body: string }>}
 */
function get(path, method = 'GET') {
  const origin = new URL(ORIGIN);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: origin.hostname,
        port: origin.port || 80,
        method,
        path: `${BASE.replace(/\/$/, '')}${path}`,
        // a fresh socket per request: connection reuse across these probes
        // can leave one response's bytes in front of the next's status line
        agent: false,
        headers: { cookie: '', connection: 'close', ...(method === 'POST' ? { 'content-length': '0' } : {}) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location ?? null,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** 一段 HTML 里指向 vault 的链接 */
function vaultLinks(html) {
  return [...html.matchAll(/href="([^"]*\/vault(?:-static)?\/[^"]*)"/g)].map((m) => m[1]);
}

try {
  await fetch(ROOT, { signal: AbortSignal.timeout(3000) });
} catch {
  console.log('· 私有站没在跑，跳过 vault 泄漏检查（公开构建本来就没有 vault）');
  exit(0);
}

// 1. 私密路径整页不可达
for (const path of BLOCKED) {
  const { status, location } = await get(path);
  if (status !== 302 && status !== 401 && status !== 403 && status !== 404) {
    failures.push(`${path} 未登录时返回 ${status}（应当挡住）`);
  } else if (status === 302 && location && /\/vault/.test(location)) {
    failures.push(`${path} 重定向到了另一个私密地址：${location}`);
  }
}

// 1b. 写方法不是后门：astro dev 对方法不挑，POST 一个公开页会把整页
//     原样吐回来（修过一次的真漏洞）——未登录的 POST 要么 405 要么照样剥
for (const path of PAGES) {
  const { status, body } = await get(path, 'POST');
  if (status === 200 && vaultLinks(body).length) {
    failures.push(`POST ${path} 未登录时返回了带 vault 链接的整页（${vaultLinks(body).length} 个）`);
  }
}

// 2. 公开页面里不得出现 vault 链接
for (const path of PAGES) {
  const { status, body } = await get(path);
  if (status !== 200) {
    failures.push(`${path} 返回 ${status}，无法检查`);
    continue;
  }
  const links = vaultLinks(body);
  if (links.length) {
    failures.push(`${path} 泄漏了 ${links.length} 个 vault 链接，例如 ${links.slice(0, 3).join(' , ')}`);
  }
}

// 2b. 笔记页的「复制全文」源码模板里不得提到 vault/（源码里的 [[vault/x]]
//     不是链接，剥链接剥不到它；门禁会把整个控件拿掉）。抽 /all/ 里前几篇
//     公开笔记来验，再加一篇明确提到 vault 的（若有）
{
  const { body } = await get('/all/');
  const notes = [...new Set([...body.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))]
    .filter((h) => h.startsWith(`${BASE}/`) && !/\/(?:vault|en|all|tag|kind|domain|status|papers|search)\b/.test(h.slice(BASE.length)))
    .map((h) => h.slice(BASE.length))
    .filter((h) => h.endsWith('/') && h.split('/').length <= 4)
    .slice(0, 5);
  for (const path of notes) {
    const { status, body: page } = await get(path);
    if (status !== 200) continue;
    const tpl = /<template data-note-source>([\s\S]*?)<\/template>/.exec(page);
    if (tpl && /\bvault\//.test(tpl[1])) {
      failures.push(`${path} 的复制全文源码里提到了 vault/（未登录时应连控件一起去掉）`);
    }
  }
}

// 2c. CMS 接口：清单里不得有 vault 笔记，指向 vault 的接口未登录必须拒绝
//     （修过一次的真漏洞：/api/wiki/notes、/meta、/comments 都是公开路由）
for (const path of [
  '/api/wiki/notes',
  '/api/wiki/meta/vault/rlinf-learning',
  '/api/wiki/comments/vault/rlinf-learning',
]) {
  const { status } = await get(path);
  if (status === 200) failures.push(`${path} 未登录时返回 200（应当拒绝）`);
}

// 3. 搜索索引里不得有私密记录
{
  const { status, body } = await get('/search-index.json');
  if (status !== 200) {
    failures.push(`/search-index.json 返回 ${status}`);
  } else {
    let records;
    try {
      records = JSON.parse(body);
    } catch {
      failures.push('/search-index.json 不是合法 JSON');
      records = [];
    }
    const priv = (Array.isArray(records) ? records : []).filter((r) =>
      /^(?:[a-z-]+\/)?vault\//.test(String(r?.id ?? '')),
    );
    if (priv.length) {
      failures.push(`搜索索引里有 ${priv.length} 条私密记录，例如 ${priv.slice(0, 3).map((r) => r.id).join(' , ')}`);
    }
  }
}

if (failures.length) {
  console.error('✗ vault 泄漏门禁未通过：');
  for (const f of failures) console.error(`  · ${f}`);
  console.error('\n  门禁在 src/lib/vault-guard.mjs；规则是「指向 vault 的链接所在的列表项整个消失」。');
  exit(1);
}
console.log(`✓ vault 泄漏门禁通过（${BLOCKED.length} 条私密路径已挡，${PAGES.length} 个公开页面 + 搜索索引零泄漏）`);
