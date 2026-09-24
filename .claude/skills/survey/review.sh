#!/bin/bash
# codex 审稿一轮。报告写到 <outdir>/cx-<slug>-<round>.md。
# usage: review.sh <outdir> <mdx-path-relative-to-hub-site> <round> <research-notes> [prev-report...]
# 一轮 10–15 分钟；放后台跑。坑见 memory codex-review-cli-flags：报告在 stderr、
# .nautilus/hold-turn 会把 codex 的 Stop 钩子卡死。
set -u
out=$1; mdx=$2; round=$3; notes=$4; shift 4
HUB=$HOME/yufeng-hub/hub-site
STYLE=$HUB/.claude/skills/hub-style/SKILL.md
slug=$(basename "$(dirname "$mdx")")
prev=""; for p in "$@"; do prev="$prev
- $p"; done
mkdir -p "$out"
rm -f "$HUB/.nautilus/hold-turn"
prompt="你是一位严格的综述审稿人（第 ${round} 轮）。

被审文件：${mdx}（只审这一个文件，忽略工作区其它改动；不要修改任何文件，只输出审稿报告）。
文风与结构规范（作者须遵守的硬要求）：${STYLE}（重点看「风格底线」「引用格式」「方向综述」三节）
作者的调研笔记（每篇论文的 ID、贡献、数字）：${notes}
上一轮报告（若有，请先逐条核对是否落实）：${prev:-无}

读者是聪明但不在这个方向的研究者；目标是「简单表达复杂」且事实严谨。逐条挑错，每条给：严重程度（致命/重要/建议）、位置（引用原句）、问题与依据（事实错误请给出论文原文或 arXiv 页面依据；可以联网查 arxiv.org 核对）、可直接替换的「原句 → 新句」。

重点：数字是否与论文一致且带实验条件（百分点/百分比）；引用编号是否指向正确文献；参考文献条目有无编造；推断是否标注；汇总表/加粗句是否强于正文；局限是否公允；分类是否站得住；术语首次出现是否解释；文风底线（人称、空话、手写节号、引号）；MDX 方言（裸 < { }、表格内 |、callout 类型）。

最后给总体评价：是否达到可发布水准；若否，列出阻止发布的条目；以及最该先改的三条。中文写报告。"
cd "$HUB" && codex exec -s read-only -C "$HUB" "$prompt" > "$out/cx-$slug-$round.out" 2> "$out/cx-$slug-$round.err"
L=$(grep -n '^codex$' "$out/cx-$slug-$round.err" | tail -1 | cut -d: -f1)
sed -n "${L:-1},\$p" "$out/cx-$slug-$round.err" | tr -d '\r' | grep -v '^hook:' > "$out/cx-$slug-$round.md"
rm -f "$HUB/.nautilus/hold-turn"; rmdir "$HUB/.nautilus" 2>/dev/null
echo "done $slug $round: $(wc -l < "$out/cx-$slug-$round.md") lines -> $out/cx-$slug-$round.md"
