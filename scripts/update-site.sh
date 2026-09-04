#!/usr/bin/env bash
# 私有站内容更新：拉三个内容挂载 + 壳仓库，过门禁，重启编辑站。
#
# 私有站现在跑的是 CMS（WIKI=1 astro dev，见 run-wiki.sh）：内容改动 dev
# server 自己就会热更，所以这里的 build 不是为了产出服务用的 dist，而是
# **公开站的预演关**——公开站由 GitHub Actions 用同一套 build 构建，先在
# 本地跑一遍，坏内容就不会推到线上才发现。
set -e
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
cd $HOME/yufeng-hub/hub-site
git pull --ff-only -q || true
git -C src/content/notes pull --ff-only -q
git -C src/content/vault pull --ff-only -q
git -C $HOME/yufeng-hub/pages/paper-snapshots pull --ff-only -q || true
PAPERS_SRC=$HOME/yufeng-hub/pages/paper-snapshots bash scripts/mount-papers.sh
bash scripts/mount-vault-static.sh
pnpm install --frozen-lockfile --silent 2>/dev/null || pnpm install --silent
pnpm check
pnpm build
# 重启放在 build 之后：两者共用 .astro/ 的内容层缓存，别让它们并发抢。
pm2 restart yufeng-hub-wiki --update-env >/dev/null
echo "$(date "+%F %T") site updated"
