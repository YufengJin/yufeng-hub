---
name: paper-digest
description: 对一篇特定文章做整理——arXiv 论文进论文墙做海报，其他文章（博客、技术报告、文档、网页）写成私密 vault 笔记。用户说「整理一下这篇」「读一下 <链接/arXiv ID>」「把这篇文章记下来」时使用。结果默认私密，不进公开站。
---

# paper-digest — 单篇整理

先 Read `.claude/skills/hub-style/SKILL.md`（统一文风），本 skill 只管路由与收尾。

## 1. 判断走哪条线

- **有 arXiv ID / arXiv 链接 / 论文 PDF** → 论文墙海报。
  先查重：`grep -lE '"arxiv_id"[: ]+"<id>"' ~/yufeng-hub/pages/paper-snapshots/*/meta.json`，
  命中就告诉用户已有海报的地址，不重做。
- **其他**（博客、技术报告、产品文档、网页、没有 arXiv 的论文） → vault 笔记。
- 用户点名要「写成笔记」的 arXiv 论文（通常因为要和别的笔记互链、要加自己的实验）→ vault 笔记，
  同时可以另做海报，两者互不替代。

## 2a. 海报线

把材料放进 `~/yufeng-hub/pages/paper-snapshots/_src/_inbox/`，然后 Read 并严格执行
`~/yufeng-hub/pages/paper-snapshots/.claude/skills/paper-notes/SKILL.md`（它会派单篇子代理，
子代理读 paper-poster 规范；paper-poster 规范要求同时遵守 hub-style 底线）。
收尾按 paper-notes 的纪律 commit + push yufeng-papers（私有仓库），再跑
`bash ~/yufeng-hub/update-site.sh`。

## 2b. vault 笔记线

1. 抓全文（WebFetch / curl / PDF 读取），把原文存档到
   `~/yufeng-hub/inbox/_processed/$(date +%F)/<slug>-source/`（网页会消失，存档不会）。
2. 写 `~/yufeng-hub/hub-site/src/content/vault/<slug>/index.mdx`，按 hub-style 的「单篇整理」骨架。
   frontmatter：`kind: paper`（论文/报告）或 `reference`（文档类），`status: growing`。
   图：原文关键图转 WebP 放 `img/`。
3. 质检：
   ```bash
   cd ~/yufeng-hub/hub-site && export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
   pnpm check
   ```
   再按 hub-style 末尾的自查清单过一遍。
4. `git -C src/content/vault add <slug> && git -C src/content/vault commit -m "新增单篇整理：…" && git -C src/content/vault push`
5. `bash ~/yufeng-hub/update-site.sh`

## 3. 汇报

一句话结论 + 落点（私有站地址 `http://chaser-ws02-u:4321/yufeng-hub/vault/<slug>/` 或
`/papers/<slug>/`）+ 最不确定的一两处。不主动提议公开；用户要公开就走 `publish` skill。
