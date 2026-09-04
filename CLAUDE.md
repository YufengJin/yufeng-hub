# yufeng-hub — agent 运营手册

这是 hub 的**壳仓库**，也是所有 agent 工作的**运营中心**：编排型 skill 全部住在
这里的 `.claude/skills/`（随仓库版本化，clone 即得）；各模块仓库只放内容和
自己的生产流水线。参考 chaser-hub 的形态：壳 = 大脑，内容仓 = 素材库。

## ws02 上的工作区布局（标准部署）

```
~/yufeng-hub/
├── hub-site/                  # 本仓库（壳 + skills + 运营手册）
│   ├── src/content/notes/     # ← YufengJin/yufeng-wiki（公开笔记，独立 git）
│   ├── src/content/vault/     # ← YufengJin/yufeng-vault（私密笔记，独立 git；
│                              #    与 notes 同属一个 collection，id 打进 vault/
│                              #    命名空间，写法与版式和公开笔记完全一致）
│   ├── public/papers/         # ← mount-papers.sh 装配的海报（勿手改，源在 yufeng-papers）
│   └── public/vault-static/   # ← mount-vault-static.sh 装配的私密静态站（勿手改，
│                              #    源在 vault 仓库各条目的 site/ 目录；公开 CI 无 vault
│                              #    挂载自动为空，隐私由构建方式保证）
├── pages/yufeng-papers/       # 论文墙模块仓库（海报流水线 + _src 工作目录 + 项目 skill）
├── yufeng-obsidian/           # 私人 Obsidian vault（独立 git）
├── inbox/                     # 统一收件箱：各机器投递的草稿（见 inbox-triage skill）
├── update-site.sh             # ↓ 三个都是软链 → hub-site/scripts/（本体随仓库版本化，
├── run-preview.sh             #   clone 即得；这一层不是 git 仓库，别把本体放这儿）
└── run-wiki.sh
```

运维脚本（都在 `hub-site/scripts/`，上层留同名软链）：

- `run-wiki.sh` — **私有站本体**，pm2 进程 `yufeng-hub-wiki`：
  `WIKI=1 astro dev` 常驻，带 inkbrush CMS（块编辑 / AI / 批注 / 同步），
  只绑 tailnet 地址 `100.81.38.119:4321`。读和写是同一个地址。
- `update-site.sh` — 拉全部挂载 + 过门禁 + 重启私有站。**内容更新后跑它**。
  内容热更本来就自动，这里的 `pnpm build` 是**公开站的预演关**（公开站用同一套
  build），不是给私有站产出 dist。
- `run-preview.sh` — 退路：`astro preview` 服务 `dist/` 的纯静态只读站。
  **和 wiki 抢 4321，一次只能起一个**；要用它得先
  `pm2 delete yufeng-hub-wiki`。

## 必知须知

- **PATH**：非交互 shell 没有 nvm——一切 node/pnpm/pm2 前先
  `export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH`。
- **内容质量门禁**：笔记改动后必须过 `pnpm check`（方言 + 链接，公开 wiki 与
  私密 vault 两边一起过），再 `pnpm build`（含 postbuild dist 检查）。
- **发布链路**：各内容仓 commit+push 后，**私有站**跑 `~/yufeng-hub/update-site.sh`
  立即生效；**公开站**由 GitHub Actions 构建（壳仓库 push 即触发；纯内容更新靠
  每日 03:17 UTC cron 兜底，急了在有 gh 的机器上
  `gh workflow run deploy.yml -R YufengJin/yufeng-hub`）。
- **git**：一律普通 commit + push，永不 force-push；提交信息中文、说清动机。
- **私有站怎么访问**：`http://chaser-ws02-u:4321/yufeng-hub/`（tailnet 内，
  MagicDNS 短名/全名/IP 均可；端口与 `/yufeng-hub/` 前缀不能省）。**在 ws02
  本机上短名连不上是正常的**——`/etc/hosts` 把它解析成 127.0.1.1，而服务只绑
  tailnet 地址；本机自测用 IP 或全名。主机名要能用，靠脚本里的 `SITE_HOST`
  喂给 Vite 的 `allowedHosts`——Vite 的 Host 头校验对 dev 与 preview 是两套
  配置，astro.config.mjs 把同一份名单同时喂给两者。加新主机名改脚本
  （逗号分隔）。
- **别让 astro 变孤儿**：`run-wiki.sh` 里的 `ASTRO_DEV_BACKGROUND=0`、
  `run-preview.sh` 里的 `ASTRO_PREVIEW_BACKGROUND=0`，都不能删。astro 检测到
  agent 环境（`CLAUDECODE` 等，pm2 会继承启动者的环境）会自动 detach 成后台
  进程，pm2 的前台进程随即退出、被判崩溃并无限重启，而真正在服务的是 pm2
  管不到的孤儿。判断健康看一句话：`pm2 pid` 要等于 `ss -tlnp | grep 4321`
  里的 pid。
- **一个项目只能有一个 astro dev**：astro 7 用 `.astro/` 下的锁文件保证这点，
  和端口无关。想在 4322 起个测试实例，得先 `astro dev stop`（或
  `pm2 stop yufeng-hub-wiki`），否则新实例直接报「Another astro dev server is
  already running」。
- **模块契约**（加新板块）见 README「模块契约」节。
- **隐私门禁**：`pnpm check` 与 `pnpm build` 都会跑 `scripts/check-privacy.mjs`。
  它管的是 `.gitignore` 管不到的那半边——私密文件被复制到挂载点之外再提交。
  两条：壳仓库不得跟踪 `src/content/vault/`、`public/vault-static/` 下的任何
  文件；没有 vault 挂载时（公开 CI）产物里不得有 `/vault/` 页面、
  `/vault-static/`、指向它们的链接或搜索索引记录。
  **私密资产要给笔记用，走 vault 自己的 `site/` 目录**（`mount-vault-static.sh`
  会装配到 `/vault-static/<slug>/`），绝不复制进壳仓库的 `public/`。
- 笔记方言易错点：
  - 手写章节编号会被拒（构建自动编号）；`[[x]]` 是 wikilink；display 数学必须
    三行 `$$` 形式；callout 只认 note/info/tip/hint/warn(ing)/caution/danger/
    important/system/abstract/summary/quote。
  - **表格单元格里的 `|` 必须写成 `\|`**——行内 code 里的管道符尤其致命，
    一个 `awk '{print $1}'` 里的管道符就能把单元格切断，露出的花括号又被
    MDX 当成表达式。
  - **正文里裸的 `<` `{` `}` 会被 MDX 当 JSX**（`<1%` 直接报错，因为 `1` 不能
    起标签名），写成 `&lt;` `&#123;` `&#125;`。代码块内不受影响。
  - **表格里别用带标签的 wikilink**：为躲表格分隔符而写的 `\|` 会被 wikilink
    解析器吃进 target，`[[a\|b]]` 变成找不到的 `a\`。表格里用普通链接。
- **多章节 hub 怎么写**（`vault/rlinf-learning/` 是第一个范例）：hub 笔记给
  `nav: [{group, pages}]` 并设 `chapters: false`；每章一个子目录，frontmatter
  写 `part: N` 和 `navLabel`。约束有两条，破了直接构建失败：`part` 必须等于该
  章在 nav 里的**全局**位置（跨 group 连续数），nav 里引用的页面必须真实存在。
  分组只能按顺序切连续段——nav 的顺序就是 part 的顺序，也就是阅读顺序。

## 私有站上的阅读环（inkbrush CMS）

私有站现在是可写的。一篇笔记页上，逐块的工具条给四件事：✎ 改源码、
✦ 问 Claude（**改写**或**就这一块提问**两个页签）、💬 写批注、⟲ 修订史回滚。
读完之后，右下角 💬 面板列出全篇批注，一个「✦ 按批注改稿」把它们**一次性**
交给 Claude 改全文——结果照样过 `pnpm check` 那套构建关、入修订账、
按仓库 autocommit + autopush。批注锚在块的源码上而不是行号，笔记变长会自动
跟随；原文被改掉就标成「原文已不在」并在改稿时跳过。

- **批注不是内容**：存在 `hub-site/.wiki/data/annotations/`（gitignored），
  只在这台机器上，永远不进任何内容仓。
- **两个内容仓各提交各的**：inkbrush 配了 `content.mounts`
  （`vault/` → `src/content/vault`），所以改 vault 笔记提交进 yufeng-vault，
  改公开笔记提交进 yufeng-wiki，翻译镜像也留在自己那棵树里
  （`vault/en/x`，不会变成 `en/vault/x`）。
- **发布状态**：浮钮上方那枚药丸报「有几个提交没推上去 / 上次推送失败没有」，
  点开可以手动推。autopush 是发完就返回的，失败本来只进服务端日志。
- `inkbrush.config.ts` 是**一机一份、gitignored** 的：换机器要照
  `packages/astro-inkbrush/inkbrush.config.example.ts` 重写一份，别忘了
  `content.mounts` 和 `identity` 两段，否则 vault 笔记在 CMS 里打不开、
  或者谁都登不进来。

## 谁能进来（授权用户）

私有站不再是敞开的。`auth.dev` **已关闭**——以前 tailnet 内任何人填个名字
邮箱就能编辑，正是这个洞。现在只有 `.wiki/users.json` 里、且管理员给设过
密码的人能登录。

- **登录**：右下角账号 chip → 账号或邮箱 + 密码。`yjin` 和邮箱都能当登录名
  （名字在册中唯一时才行）。密码 scrypt 存储，明文不落任何文件；连错 5 次
  锁 15 分钟（按账号和来源地址两路计数）。
- **三级角色**，`roles` 的顺序就是权限高低：
  - `reader` —— 登录进来只能读（**包括私密 vault**），改稿 / AI / 批注 /
    评论 / 同步 / 分享一律拒绝，而且这些入口在界面上直接不显示。
  - `editor` —— 能写。
  - `admin` —— 还能管账号：加人、改角色、设/重置/清除别人的密码。
    服务端保证至少留一个 admin。
- **账号管理**在账号面板里（登录后 chip → 成员管理），admin 可见。每个人
  也能在自己的面板里改自己的密码（要验旧密码）。
- **`.wiki/users.json` 是 gitignored 的**，和批注一样只在这台机器上，
  永远不进任何内容仓。里面存的是 scrypt 哈希，不是密码。

## 私密 vault 的阅读门禁

未登录时 **vault 在全站不存在**：页面打不开、列表里没有卡片、搜索索引里
没有记录、导航上没有入口。登录且在册（任何角色）就照常看见。

- 门禁在 `src/lib/vault-guard.mjs`，装在 vite 中间件层。**为什么不用 Astro
  middleware**：站点是 `output: 'static'`，Astro 把页面当预渲染路由，喂给
  middleware 的是一个合成的空 Request——实测连一个请求头都没有，拿不到
  cookie。vite 那一层才有完整请求。
- 规则只有一条：**指向 vault 的链接所在的那一条列表项整个消失**。它同时
  覆盖了 NoteCard、首页「最近更新」、导航入口；不在列表里的（正文里指向
  私密笔记的 wikilink）降级成纯文本，字还在，路没了。所以 hub-site 的渲染
  代码一行都不用改。
- **剥空即整页挡**：一个只由私密笔记撑起来的页面（比如只有 vault 笔记用过的
  标签 `/tag/ik/`），光是「它存在、标题写着几篇」就已经泄漏。剥完卡片一张
  不剩就整页 302。**不能改成构建时不生成这些页**——vault 笔记自己要链过去，
  不生成就是死链，dist 门禁会当场拒绝（试过，构建直接失败）。
- **`/vault-static/` 必须在这一层挡**：那些请求会被静态子站中间件直接接管，
  根本不过 astro 路由。
- **源文件也得挡**：vite 还有 `/@fs/`、`/src/…`、`/public/…` 三条直达文件的
  路——未登录本来能整篇读到 `src/content/vault/<id>/index.mdx`。
  `astro.config.mjs` 的 `secureFsDeny` 里点名了这两个挂载目录。
- **方法不设限**：vite 的静态中间件不挑方法，只放行 GET/HEAD 的话一个
  `POST /vault-static/<slug>/index.html` 就能原样取走私密内容。
- **防漏门禁**：`scripts/check-vault-leak.mjs`（已挂进 `pnpm check`）以未
  登录身份真抓一遍站点，断言零 vault 链接、零私密搜索记录。规则漏一处就是
  一次泄漏，靠人眼保证不住。站点没跑时自动跳过（公开 CI 本来就没有 vault）。
- 公开站不受影响：它压根不 clone vault，那半边由 `check-privacy.mjs` 守着。

## Skills

- `inbox-triage` — 处理 `~/yufeng-hub/inbox/` 的统一收件箱：自动分拣到
  wiki / vault / 论文墙 / obsidian，产出、质检、提交、刷新站点。入口技能，
  「整理 inbox / update hub / 收件箱清一下」都走它。
- 海报单篇生产规范住在模块仓库：`pages/yufeng-papers/.claude/skills/`
  （paper-notes 编排 + paper-poster 单篇规范）——生产内幕跟着流水线走，
  编排入口在本仓库。
