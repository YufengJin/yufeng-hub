#!/usr/bin/env bash
# 私有站内容更新：拉三个内容挂载 + 壳仓库，重建，重启 preview
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
pnpm build
pm2 restart yufeng-hub-preview --update-env >/dev/null
echo "$(date "+%F %T") site updated"
