# 私有站授权用户系统 — 设计

日期：2026-09-04 · 状态：待审

## 一、要解决什么

私有站现在是**敞开的**：`inkbrush.config.ts` 里 `auth: { dev: true }`，tailnet 内任何人
打开站点点一下登录、随便填个名字邮箱，就能编辑笔记、跑 AI、写批注。私密 vault 的
正文、标题、全文搜索索引也都对未登录者可见。

要的是：**只有在册用户能写，未登录看不到 vault，且有地方管账号。**

## 二、现状盘点（已实测）

inkbrush 已经有的，不重做：

- **成员注册表**：`users.json` = `[{email, name, role}]`，角色词汇表可配，
  `defaultRole`/`adminRole`，服务端强制「至少留一个 admin」。
- **账号管理面板**：`client/identity.ts` + 服务端 `auth: 'admin'` 路由。
- **写操作的门**：块编辑、AI、批注、评论 POST、sync、share、inbox 全部 `auth: true`。
- **会话**：HMAC 签名 cookie `wiki_session`，`Path=/`（**全站有效**，实测确认），30 天。
- **只读身份契约**：包导出 `astro-inkbrush/session` 的 `currentUser(req)`，模块注释明说
  这是给「同进程的兄弟应用」判断「谁在请求」用的，且**授权决策归调用方**。

缺的：

- **没有密码登录**。只有 dev 快速登录（无密码）、Google OAuth、SAML。
- **没有角色语义分级**。`auth` 只有 `true`（登录即可）和 `'admin'` 两档。
- **vault 阅读不设防**。

## 三、地基约束（实测得出，决定了方案形状）

站点是 `output: 'static'`。实测探针：

```
x-probe-prerender: true      ← 页面是预渲染路由
x-probe-headers:  (空)        ← middleware 一个请求头都拿不到
x-probe-cookie-len: 0
```

**Astro 喂给 middleware 的是合成的空 Request**——预渲染的输出必须与请求无关，这是它的
设计。所以「middleware 读会话 → 页面按身份渲染」这条路走不通。

改 `output: 'server'` 能解决，但 `getStaticPaths` 会全部失效，`[...slug].astro` 和所有
browse 页要重写成运行时路由。**否决**：代价远大于收益。

结论：**门禁只能做在 vite 中间件层**（那一层拿得到完整请求，`dev-public-dirs` 已经证明）。

## 四、泄漏面（未登录，实测数字）

| 位置 | 泄漏 |
|---|---|
| `search-index.json` | 52 条 vault 记录（全文） |
| `/all/` | 10 个 vault 链接 |
| `/vault/` | 9 个 |
| `/` 首页 | 3 个 ← 首页不能整个挡，否则等于整站门禁 |
| `/tag/<x>/` 等 facet 页 | 2 个 |
| `/en/`、`/papers/` | 0 |

首页那 3 个是关键：它让「只挡整页」这种简单做法不够。

## 五、目标与非目标

**目标**

1. 用户名/密码登录，首个账号 `yjin`（admin）。
2. 三级角色：`reader` / `editor` / `admin`。
3. 网页上能管账号（加人、改角色、重置密码）。
4. 未登录时 vault **在全站不存在**：页面打不开、列表无卡片、搜索索引无记录。
5. 写操作（编辑 / AI / 批注 / 评论 / sync / share / inbox）要 `editor` 以上。

**非目标**

- 公开站（GitHub Pages）**零改动**。它压根不 clone vault，现有保证不变。
- 不上 SSR，不改路由架构。
- 不做找回密码、邮件验证、2FA。tailnet 内的单人站，admin 直接重置即可。

## 六、阶段一：inkbrush 上游（密码登录 + 角色分级）

改动落在 `packages/astro-inkbrush`（独立仓库，按它的质量标准：类型、测试、文档）。

### A1 密码存储

`IdentityUser` 加可选字段 `passwordHash`。算法用 **scrypt**（node 内置 `crypto`，
零新依赖；包现有依赖里没有 bcrypt/argon2，不为这个引一个）。

存储格式单行自描述，便于将来换算法：

```
scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>
```

参数 `N=16384, r=8, p=1`，盐 16 字节随机，输出 64 字节。校验用
`crypto.timingSafeEqual`，长度不等时也要走满比较路径，不能提前 return。

`users.json` 里没有 `passwordHash` 的成员 = 还没设密码，密码登录对他直接失败
（而不是「空密码放行」）。

### A2 登录路由

`POST /auth/password`，body `{identifier, password}`。

**登录标识符可以是 email 或 name。** 你说的是用 `yjin` 登录，而注册表的主键是 email，
所以两者都收：先按 email 精确匹配，不中再按 name 匹配。代价是 `name` 必须唯一——
现在 `identity-records.ts` 只保证「无重复 email」，**要加一条「无重复 name」的校验**
（空 name 回退成 email 前缀的逻辑不变，回退后同样参与唯一性检查）。

- **限流**：按 `email` 和来源 IP 两个维度各自计数，连续失败 5 次锁 15 分钟，
  内存计数即可（进程重启清零可以接受，这是 tailnet 内的单机站）。
  锁定时返回 429 且不透露账号是否存在。
- 失败一律回同一句 `Invalid email or password`，不区分「无此人」和「密码错」。
- 成功 → 签发现有那套 session cookie，`provider: 'password'`。
- `WikiUser['provider']` 联合类型加 `'password'`；`session-payload.ts` 的形状校验
  同步放行这个值（否则签发出来的会话自己认不得）。

### A3 配置

```ts
auth: { password?: boolean }   // 默认 off
```

开启时**必须**同时配了 `identity`（密码存在 users.json 里）。配置自检
（`config-checks.ts` 已有这类检查）在启动时把「开了 password 但没有 identity」
报成致命错误，而不是默默不工作。

### A4 角色语义

现在门只有两档，扩成三档：

```ts
auth: boolean | 'editor' | 'admin'
```

- `reader`：能登录、能读（含 vault），**不能写**。
- `editor`：+ 块编辑、AI、批注、评论、sync、share、inbox。
- `admin`：+ 账号管理。

现有所有 `auth: true` 的写路由改成 `auth: 'editor'`；`auth: 'admin'` 不动。

**向后兼容**（这是开源包，别人在用）：identity registry **关闭**时，`'editor'` 退化为
「登录即可」，与今天的 `true` 行为完全一致。只有开了注册表，角色才真正生效。

`identity.roles` 默认词汇表从 `[defaultRole, adminRole]` 扩成
`['reader', 'editor', 'admin']`，`defaultRole` 默认 `'reader'`——**新人默认只读**，
要写得由 admin 抬一级。这是比现在（新人默认能写）更安全的默认值。

### A5 账号面板

已有面板上加：

- admin：给成员**设/重置密码**、改角色（三选下拉）、删成员。
- 本人：**改自己的密码**（要验证旧密码）。
- 已有的「至少留一个 admin」保护不动。

### A6 session 契约扩展（阶段二要用）

`astro-inkbrush/session` 现在只导出 `currentUser(req: IncomingMessage)`，而且返回的
`WikiUser` **没有 role**（role 在注册表里）。阶段二的中间件需要「谁 + 什么角色」，
且它拿到的是 cookie 字符串而不是 `IncomingMessage`。

所以这个只读契约扩两个导出：

```ts
userFromCookie(cookie: string): Promise<WikiUser | null>
roleOf(email: string): string | null      // 注册表关闭时返回 null
```

`sessionUser` 内部只用到 `req.headers.cookie`（已确认），所以
`userFromCookie` 是把现有实现的入参换个形状，不是新逻辑。

## 七、阶段二：hub-site 的 vault 门禁

### B1 私密标记

渲染 vault 卡片/链接的地方，用 `isPrivate(id)` 判定并打上 `data-private` 属性。
`isPrivate` 是「什么是私密」的唯一事实来源（`src/lib/private.ts`，由挂载决定，
不由 frontmatter 决定），已经存在，直接用。

涉及：`AllNotesPage.astro`、`FacetPage.astro`、`LandingPage.astro`，以及
`[...slug].astro` 里公开笔记页可能列出的**反向链接与局部链接图**。

这是**显式契约**，不是让中间件去猜 HTML 结构。

### B2 中间件剥离

在 `dev-public-dirs` 同一层（vite 插件的 `configureServer`，拿得到完整请求）。
身份用 A6 的 `userFromCookie` + `roleOf`。未登录、或注册表里没这个人时：

- `/vault/*`、`/en/vault/*` → 302 到 `/?needs_login=vault`。**inkbrush 没有独立登录页**，
  登录是挂在右下角 chip 上的浮层（`wiki-auth-panel`），所以只能送回首页并让前端
  据这个参数自动弹出浮层 + 一句「这篇要登录才能看」。这跟它现有的
  `/?login_error=<code>` 提示走同一套机制。
- `/vault-static/*` → 302 同上。**必须在这一层做**：实测这些请求被静态子站中间件接管，
  根本不过 astro，靠 astro 那边挡不住。
- `search-index.json` → 过滤掉 id 以 `vault/` 开头的记录（JSON，干净）
- 其余 HTML 响应 → 用 **parse5**（inkbrush 已依赖）剥掉 `[data-private]` 子树

已登录且角色 ≥ `reader` 的请求**原样放行，零开销**——剥离只发生在未登录路径上。

**前提**：`roleOf` 在注册表关闭时一律返回 `null`，那样全站会对所有人挡住 vault。
所以 hub-site 的 `inkbrush.config.ts` 必须开着 `identity`；中间件启动时自检这一条，
配置不全就把话说清楚而不是默默全挡。

### B3 防漏门禁（关键）

B1 的标记漏了一处就是一次泄漏，靠人眼保证不住。所以配一个检查脚本
`scripts/check-vault-leak.mjs`：以**未登录**身份抓取 `/`、`/all/`、`/vault/`、
`/en/`、`/papers/`、若干 facet 页和 `search-index.json`，断言**零** vault 链接、
零 `vault/` 记录。挂进 `pnpm check`。

这把「标记有没有漏」从人工审查变成可验证的门禁——和 `check-privacy.mjs` 守
公开站的方式是同一个思路。

## 八、初始账号

`users.json` 首条：

```json
[{ "email": "yufeng.jin@chaserrobotics.com", "name": "yjin", "role": "admin",
   "passwordHash": "scrypt$16384$8$1$…" }]
```

email 用你的工作邮箱（会话、git 作者、账号面板都认它），`name` 是 `yjin`——按 A2，
**两个都能用来登录**，日常敲 `yjin` 就行。

密码 `220996`，用 scrypt 哈希写入，**明文不进任何文件、不进 git**。
`users.json` 放在 `.wiki/` 下（已 gitignored），与批注同处，永不入内容仓。

> 记录在案：这个密码是 6 位纯数字，且在生成它的那次对话里明文出现过。tailnet 内的
> 站点、且有登录限流，风险可接受；真要提高，在账号面板上自己改一个就行。

## 九、测试

- **inkbrush**（已有 vitest）：scrypt 往返与格式解析、时序安全比较、限流计数与解锁、
  三级角色门（含注册表关闭时的向后兼容退化）、`userFromCookie` 与 `roleOf`、
  「至少留一个 admin」在角色改动下仍成立。
- **hub-site**：curl 断言矩阵——四种身份（未登录 / reader / editor / admin）×
  关键路径（vault 页、vault-static、search-index、/all/、首页、写 API），
  外加 B3 的防漏脚本。

## 十、风险与缓解

| 风险 | 缓解 |
|---|---|
| `data-private` 标记漏一处 = 泄漏 | B3 的防漏脚本进 `pnpm check` |
| 未登录时 HTML 要过 parse5 | 只在未登录路径；私有站流量极小；登录后零开销 |
| 改 inkbrush 影响其他使用者 | 角色在注册表关闭时退化为现有行为；密码登录默认 off |
| 限流状态在内存，重启清零 | tailnet 内单机站，可接受；不为它引数据库 |
| 阶段一改了 `defaultRole` 默认值 | 这是**更安全**的方向（新人默认只读）；在 CHANGELOG 里写明 |
