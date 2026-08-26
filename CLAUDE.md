# yufeng-hub — agent 运营手册

这是 hub 的**壳仓库**，也是所有 agent 工作的**运营中心**：编排型 skill 全部住在
这里的 `.claude/skills/`（随仓库版本化，clone 即得）；各模块仓库只放内容和
自己的生产流水线。参考 chaser-hub 的形态：壳 = 大脑，内容仓 = 素材库。

## ws02 上的工作区布局（标准部署）

```
~/yufeng-hub/
├── hub-site/                  # 本仓库（壳 + skills + 运营手册）
│   ├── src/content/notes/     # ← YufengJin/yufeng-wiki（公开笔记，独立 git）
│   ├── src/content/vault/     # ← YufengJin/yufeng-vault（私密笔记，独立 git）
│   ├── public/papers/         # ← mount-papers.sh 装配的海报（勿手改，源在 yufeng-papers）
│   └── public/vault-static/   # ← mount-vault-static.sh 装配的私密静态站（勿手改，
│                              #    源在 vault 仓库各条目的 site/ 目录；公开 CI 无 vault
│                              #    挂载自动为空，隐私由构建方式保证）
├── pages/yufeng-papers/       # 论文墙模块仓库（海报流水线 + _src 工作目录 + 项目 skill）
├── yufeng-obsidian/           # 私人 Obsidian vault（独立 git）
├── inbox/                     # 统一收件箱：各机器投递的草稿（见 inbox-triage skill）
└── update-site.sh             # 拉全部挂载 + 构建 + 重启私有站
```

## 必知须知

- **PATH**：非交互 shell 没有 nvm——一切 node/pnpm/pm2 前先
  `export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH`。
- **内容质量门禁**：wiki 笔记改动后必须过
  `node packages/astro-inkbrush/scripts/check-content.mjs src/content/notes --math`
  和 `node scripts/check-links.mjs`，再 `pnpm build`（含 postbuild dist 检查）。
- **发布链路**：各内容仓 commit+push 后，**私有站**跑 `~/yufeng-hub/update-site.sh`
  立即生效；**公开站**由 GitHub Actions 构建（壳仓库 push 即触发；纯内容更新靠
  每日 03:17 UTC cron 兜底，急了在有 gh 的机器上
  `gh workflow run deploy.yml -R YufengJin/yufeng-hub`）。
- **git**：一律普通 commit + push，永不 force-push；提交信息中文、说清动机。
- **模块契约**（加新板块）见 README「模块契约」节。
- 笔记方言易错点：手写章节编号会被拒（构建自动编号）；`[[x]]` 是 wikilink；
  display 数学必须三行 `$$` 形式；callout 只认
  note/info/tip/hint/warn(ing)/caution/danger/important/system/abstract/summary/quote。

## Skills

- `inbox-triage` — 处理 `~/yufeng-hub/inbox/` 的统一收件箱：自动分拣到
  wiki / vault / 论文墙 / obsidian，产出、质检、提交、刷新站点。入口技能，
  「整理 inbox / update hub / 收件箱清一下」都走它。
- 海报单篇生产规范住在模块仓库：`pages/yufeng-papers/.claude/skills/`
  （paper-notes 编排 + paper-poster 单篇规范）——生产内幕跟着流水线走，
  编排入口在本仓库。
