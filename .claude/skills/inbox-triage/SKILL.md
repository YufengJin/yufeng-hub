---
name: inbox-triage
description: 处理 ~/yufeng-hub/inbox/ 统一收件箱——把各机器投来的草稿自动分拣到 vault（私密，默认）/ 论文墙（arXiv 海报，私有）/ obsidian（原始素材）/ wiki（公开，仅限明确标 #public 的），逐项产出、质检、提交推送并刷新站点。触发语句如「整理 inbox」「update hub」「收件箱清一下」。
---

# inbox-triage — 统一收件箱分拣

**收件箱（写死）**：`/home/yjin/yufeng-hub/inbox/`
投递方不分模块——分类是本 skill 的职责。逐项处理，宁可挂起也不误分。

## 0. 准备

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
ls -la ~/yufeng-hub/inbox/
```

忽略 `_processed/`、`.DS_Store`、`._*`。空箱直接汇报收工。

## 1. 逐项分类（判据按优先级）

**默认私密。** 公开 wiki 只收用户明确要求公开的条目（文首标 `#public` / `#publish`，或用户
这次调用时点名「X 发布到公开」）。没有明确指示的一律不进公开 wiki。

1. **论文** → 内容含 arXiv 链接/ID，或 PDF 论文，或「读一下这篇」类请求
   → **论文墙模块**（私有）。按 `paper-digest` skill 的海报线走。
2. **非 arXiv 的单篇文章**（博客、技术报告、文档链接）要求整理的 → `paper-digest` 的 vault 线。
3. **方向综述请求**（「综述 X 方向」「从这几篇出发」）→ 不在收件箱里就地做，按 `survey` skill
   开一条线，汇报里说明已启动。
4. **实验材料**（日志、曲线、结果表、复现记录）→ `experiment-log` skill → vault。
5. **成型知识草稿**（讲一个主题的笔记素材，有干货结构）→ **vault**。
   带 `#public` 标记的才进 **wiki**——并且走 `publish` skill 的扫描那一步再落盘。
6. **原始素材** → 日记、随手记、剪藏、会议记录等还不成型的 → **obsidian 收件箱**。
7. **判不准** → 留在原地，最终汇报里列出并给出建议分类，等主人定夺。

所有写作都遵守 `hub-style` skill（先 Read `.claude/skills/hub-style/SKILL.md`）。

## 2. 各线处理

### 论文 → yufeng-papers（模块自带流水线）

1. 把该条目移入 `~/yufeng-hub/pages/paper-snapshots/_src/_inbox/`。
2. 先 Read `~/yufeng-hub/pages/paper-snapshots/.claude/skills/paper-notes/SKILL.md`
   并严格遵循（含 per-paper 子 agent 要先读 paper-poster 规范、路径绝对化、
   发布前 meta.json 校验等全部纪律）。
3. 流水线跑完（海报落地 + `publish_to_site.sh` + 索引重建）后：
   `git -C ~/yufeng-hub/pages/paper-snapshots` add/commit/push。

### 公开笔记 → yufeng-wiki（仅限带 `#public` 或用户点名公开的条目）

0. 落盘前跑一次 `bash .claude/skills/publish/scan.sh <草稿所在目录>`，命中项先给用户过目。
1. 在 `~/yufeng-hub/hub-site/src/content/notes/<slug>/index.mdx` 建笔记目录
   （slug 用小写连字符英文；正文中文优先）。
2. Frontmatter 必填：title/description/kind/domains/tags/status/created/updated；
   词表见 `src/content/notes/_meta/taxonomy.ts`（kind: note|paper|project|reference；
   domains: ml|robotics|math|programming|infra；status 新稿用 seedling 或 growing）。
3. 方言纪律：不要手写章节编号；display 数学三行 `$$`；站内互链用 `[[slug]]`；
   callout 用 `> [!note] 标题` 体（词表见 CLAUDE.md）。
4. 质检后提交：

```bash
cd ~/yufeng-hub/hub-site
pnpm check          # 方言 + 链接门禁，公开与私密两边一起过
git -C src/content/notes add -A && git -C src/content/notes commit -m "..." && git -C src/content/notes push
```

### 私密 → yufeng-vault（默认落点）

同 wiki 流程，落 `~/yufeng-hub/hub-site/src/content/vault/<slug>/index.mdx`
（**.mdx，不是 .md**）。私密笔记就是 `vault/` 命名空间下的普通笔记，
**frontmatter 与公开笔记完全一致**：title / description / kind / domains /
tags / status / created / updated，多章节还有 nav / part。同一套版式、
同一张链接图、同一套质检——`pnpm check` 一条命令两边都过。
`git -C src/content/vault` add/commit/push。

> 别在**公开**笔记里 `[[链接]]` 私密笔记：公开构建里目标不存在，CI 会红。
> 反向（私密链公开）完全正常。

### 原始素材 → obsidian

移入 `~/yufeng-hub/yufeng-obsidian/00 Inbox/`（文件名保留原意，冲突加日期后缀），
`git -C ~/yufeng-hub/yufeng-obsidian` add/commit/push。不在本 skill 里做
vault 内部整理——那是 obsidian 自己的 triage 流程。

## 3. 收尾（有任何内容变动才做）

```bash
bash ~/yufeng-hub/update-site.sh          # 私有站立即生效（公开站等 CI cron）
```

处理完的原始条目移入 `~/yufeng-hub/inbox/_processed/$(date +%F)/`——**永不删除**。

## 4. 汇报

逐项列表：条目 → 判为什么类 → 产出落在哪（路径/URL）→ 哪些挂起待定夺。
有公开条目时提醒：最迟次日 03:17 UTC 自动上线，急了 `gh workflow run deploy.yml -R YufengJin/yufeng-hub`。
