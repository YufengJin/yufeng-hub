#!/bin/bash
# 发布前扫描：列出一篇 vault 笔记里不该出现在公开站的东西。只报告，不改文件。
# usage: scan.sh <note-dir>     例：scan.sh src/content/vault/foo
# 退出码 1 = 有必须处理的命中（私密链接 / 凭据）；其余命中是提醒，由人判断。
dir=${1:?usage: scan.sh <note-dir>}
slug=$(basename "${dir%/}")
hard=0
section(){ printf '\n== %s\n' "$1"; }
hit(){ # $1 = pattern (ERE), $2 = 1 if blocking
  local out; out=$(grep -rnIE "$1" "$dir" --include='*.mdx' --include='*.md' --include='*.svg' 2>/dev/null)
  if [ -n "$out" ]; then echo "$out" | head -20; [ "$2" = 1 ] && hard=1; else echo "  (无)"; fi
}
section "本笔记内部互链（搬家时把 vault/$slug 前缀改成 $slug 即可）"
n=$(grep -rhoE "\[\[vault/$slug(/|\||\]\])" "$dir" --include='*.mdx' | wc -l); echo "  $n 处"
section "指向其他私密内容的链接（必须改：删掉或改成纯文本）"
out=$(grep -rnIE '\[\[vault/|\]\(/?(yufeng-hub/)?vault/|/vault-static/|\]\(/?(yufeng-hub/)?papers/|/papers/[a-z0-9-]+' "$dir" --include='*.mdx' --include='*.md' \
  | grep -vE "\[\[vault/$slug(/[^]|]*)?(\|[^]]*)?\]\]" )
# 一行里既有内部链接又有外部链接时，上面会把整行滤掉；再按「去掉内部链接后仍有 vault/」补回来
out2=$(grep -rnIE '\[\[vault/' "$dir" --include='*.mdx' | sed -E "s#\[\[vault/$slug(/[^]|]*)?(\|[^]]*)?\]\]##g" | grep -E '\[\[vault/')
all=$(printf '%s\n%s\n' "$out" "$out2" | grep -v '^$' | sort -u)
if [ -n "$all" ]; then echo "$all" | head -20; hard=1; else echo "  (无)"; fi
section "凭据 / token（必须删）"
hit '(ghp_|gho_|github_pat_|sk-[A-Za-z0-9]{16}|hf_[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|xox[bp]-|-----BEGIN [A-Z ]*PRIVATE KEY)' 1
section "内网地址 / 主机名 / 本机路径（提醒：通常要泛化）"
hit '(100\.[0-9]+\.[0-9]+\.[0-9]+|192\.168\.|10\.[0-9]+\.[0-9]+\.[0-9]+|chaser-[a-z0-9-]+|ws02|tailnet|/home/[a-z]+|~/yufeng)' 0
section "邮箱 / 公司 / 人名线索（提醒）"
hit '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}|chaserrobotics|Chaser)' 0
section "site/ 静态资产（公开站没有 vault-static，得另想办法或删掉）"
[ -d "$dir/site" ] && { echo "  $dir/site 存在"; hard=1; } || echo "  (无)"
exit $hard
