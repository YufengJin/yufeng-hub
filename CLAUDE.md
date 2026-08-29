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

- `update-site.sh` — 拉全部挂载 + 构建 + 重启私有站。**内容更新后跑它**。
- `run-preview.sh` — 私有站本体，pm2 进程 `yufeng-hub-preview`，
  `astro preview` 服务 `dist/`，只绑 tailnet 地址 `100.81.38.119:4321`。
- `run-wiki.sh` — 编辑机模式（`WIKI=1 astro dev`，带 inkbrush CMS），
  **和 preview 抢 4321，一次只能起一个**。

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
  MagicDNS 短名/全名/IP 均可；端口与 `/yufeng-hub/` 前缀不能省）。主机名要能
  用，靠 `run-preview.sh` 里的 `SITE_HOST` 喂给 `vite.preview.allowedHosts`
  ——Vite 的 Host 头校验对 dev 与 preview 是两套配置，只配 server 的话
  IP 能开、主机名被挡。加新主机名改那里（逗号分隔）。
- **别让 astro preview 变孤儿**：`run-preview.sh` 里的
  `ASTRO_PREVIEW_BACKGROUND=0` 不能删。astro 检测到 agent 环境（`CLAUDECODE`
  等）会自动 detach 成后台进程，pm2 的前台进程随即退出、被判崩溃并无限重启，
  而真正在服务的是 pm2 管不到的孤儿。判断健康看一句话：`pm2 pid` 要等于
  `ss -tlnp | grep 4321` 里的 pid。
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

## Skills

- `inbox-triage` — 处理 `~/yufeng-hub/inbox/` 的统一收件箱：自动分拣到
  wiki / vault / 论文墙 / obsidian，产出、质检、提交、刷新站点。入口技能，
  「整理 inbox / update hub / 收件箱清一下」都走它。
- 海报单篇生产规范住在模块仓库：`pages/yufeng-papers/.claude/skills/`
  （paper-notes 编排 + paper-poster 单篇规范）——生产内幕跟着流水线走，
  编排入口在本仓库。
