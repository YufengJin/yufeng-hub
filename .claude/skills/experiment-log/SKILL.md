---
name: experiment-log
description: 根据一次具体实验（训练、评测、复现、调试、环境搭建）写私密实验记录到 vault。用户说「把这次实验记下来」「写个实验记录」「记录一下这个结果/这次调试」时使用；也用于把会话里跑出来的实验结论落盘。结果默认私密。
---

# experiment-log — 实验记录

先 Read `.claude/skills/hub-style/SKILL.md`，按其中「实验记录」骨架写。本 skill 管取材、资产与收尾。

## 1. 取材（事实先于文字）

从会话、日志、配置、W&B、代码里收集，**每条事实都要能指回出处**：

- 代码仓库路径 + `git rev-parse HEAD`（有未提交改动就注明）
- 硬件（GPU 型号 × 数量）、容器镜像、关键依赖版本
- 完整命令行与关键配置项（只摘影响结论的，不贴整份 yaml）
- 数字：从日志/结果文件里取，写明步数、种子数、评测集、episode 数
- 实验日期（不是写作日期）

材料不够下结论的地方，写进「仍未知」，不要补全。

## 2. 同一方向的实验放在一起

先看 vault 里有没有这个项目的记录：`ls ~/yufeng-hub/hub-site/src/content/vault/`。

- 已有同项目笔记 → 新实验作为新的一节追加，或建成多章节 hub 的一章
  （多章节写法见 hub-site/CLAUDE.md「多章节 hub 怎么写」，范例 `vault/rlinf-learning/`）。
- 新项目 → 新建 `vault/<project-slug>/index.mdx`。第三次往同一项目追加时，考虑拆成 hub。

## 3. 资产

- 曲线/截图：`cwebp -q 80 -resize 1600 0 in.png -o img/x.webp`，放笔记目录 `img/`，正文写
  `![一句话说明这张图显示了什么](img/x.webp)`。示意图优先手写 SVG（体积小、可改）。
- 日志：只截关键段落进正文的代码块；需要整份给人翻的，放 `site/`（会装配到
  `/vault-static/<slug>/`，同样受登录门禁保护），单文件 < 1 MB。
- **不进 git**：权重、数据集、原始视频、完整训练日志——写本机绝对路径或 W&B 链接。
  `pnpm check` 里的 `check-content-size` 会拦。

## 4. 收尾

```bash
cd ~/yufeng-hub/hub-site && export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
pnpm check
git -C src/content/vault add <slug> && git -C src/content/vault commit -m "实验记录：<结论一句话>" && git -C src/content/vault push
bash ~/yufeng-hub/update-site.sh
```

汇报：结论一句话 + 私有站地址 + 「仍未知」里最关键的一条。
