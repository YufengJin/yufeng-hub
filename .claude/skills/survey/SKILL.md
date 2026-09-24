---
name: survey
description: 对一个研究方向做综述——从种子论文或方向名出发，并行调研 20–40 篇、写成私密 vault 综述、用 codex 多轮审稿到收敛。用户说「做个 survey」「综述一下 X 方向」「从这几篇出发搜相关工作写综述」时使用。结果默认私密。
---

# survey — 方向综述

文风与骨架：Read `.claude/skills/hub-style/SKILL.md`（「方向综述」节）。本 skill 管流程。
这套流程 2026-09-22/24 跑通过四篇（memory-and-reuse / rsi / continual-robot-learning /
llm-memory），存档在 `~/yufeng-hub/inbox/_processed/2026-09-2{2,4}/`，可以翻来参考。

## 0. 定范围（开工前和用户对齐一次）

方向名、种子论文（若有）、目标读者、篇数上限（默认 20–40，**写进 brief**——没有上限子代理会收 60+ 篇）、
要不要同时给种子论文做海报（要就另走 `paper-digest`）。一次多个方向就每个方向一条线并行。

工作目录：`W=~/yufeng-hub/inbox/_processed/$(date +%F)/<slug>-research/`（scratchpad 会被清，这里不会）。

## 1. 写 brief

`$W/brief.md`：方向与范围、读者、篇数上限、落点 `src/content/vault/<slug>/index.mdx`、
「遵守 hub-style 全文」、可以互链的已有笔记清单（`ls src/content/notes src/content/vault`）、
交付物（调研笔记 `$W/research.md` + 正文 + 自评最不确定的 3 处）、
禁止事项（不 commit、不 push、不跑 `pnpm build`、不改别的文件）。

## 2. 作者子代理：调研 → 写到定稿

每个方向一个 general-purpose 子代理（后台），prompt 指向 brief。它负责：

1. 调研：从种子论文读全文、追引用、arXiv 检索；每篇在 `$W/research.md` 记 ID / 标题 / 年份 /
   一句话贡献 / 关键数字与条件 / 局限 / 放在哪一节。arXiv ID 全部用 API 核。
2. 写作：先写「引用键占位」草稿（`[@key]`），再用一个小 build 脚本按首次出现顺序替换成
   `<sup><a href="#refs">[n]</a></sup>` 并生成 References——改稿时编号不会乱。
3. 自检：`node scripts/check-content.mjs && node scripts/check-links.mjs` 通过。

## 3. codex 审稿循环

```bash
bash ~/yufeng-hub/hub-site/.claude/skills/survey/review.sh "$W" src/content/vault/<slug>/index.mdx <round> "$W/research.md" [上一轮报告...]
```

后台跑，一轮 10–15 分钟。报告交回**原作者子代理**（SendMessage）逐条核实后修改——事实类
意见要它回原文核对，不盲从。主代理只看结论。

**收手条件**：问题降到个位数且无「致命」后，让作者做一轮「定稿轮」（改完 + 自己通读一遍）即停。
codex 每轮都会冒出新的小问题，永远不会主动说「可发布」；通常 3–5 轮。

## 4. 收尾（主代理）

```bash
cd ~/yufeng-hub/hub-site && export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
pnpm check && pnpm build
git -C src/content/vault add <slug> && git -C src/content/vault commit -m "新增综述：<方向>" && git -C src/content/vault push
bash ~/yufeng-hub/update-site.sh
```

汇报：收录篇数、审了几轮、最后一轮剩下的问题、私有站地址。不主动公开；用户要公开走 `publish`。
