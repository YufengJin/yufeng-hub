#!/usr/bin/env bash
# 私有站内容更新：拉三个内容挂载 + 壳仓库，过门禁，重启编辑站。
#
# 私有站现在跑的是 CMS（WIKI=1 astro dev，见 run-wiki.sh）：内容改动 dev
# server 自己就会热更，所以这里的 build 不是为了产出服务用的 dist，而是
# **公开站的预演关**——公开站由 GitHub Actions 用同一套 build 构建，先在
# 本地跑一遍，坏内容就不会推到线上才发现。
set -e
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
cd "$HOME/yufeng-hub/hub-site"
git pull --ff-only -q || true
git -C src/content/notes pull --ff-only -q
git -C src/content/vault pull --ff-only -q
git -C $HOME/yufeng-hub/pages/paper-snapshots pull --ff-only -q || true
PAPERS_SRC=$HOME/yufeng-hub/pages/paper-snapshots bash scripts/mount-papers.sh
bash scripts/mount-vault-static.sh
pnpm install --frozen-lockfile --silent 2>/dev/null || pnpm install --silent
# 先重启再过门禁：pnpm check 里的 check-vault-leak 是对着**正在跑的**私有站
# 真抓一遍，门禁代码（vault-guard、astro.config）只在启动时加载——不先重启，
# 它验的是拉取前的旧门禁，新拉下来的坏门禁会带着绿灯上线。等到站点能应答
# 再往下走：站点没起来时那条检查会当作「私有站没在跑」直接跳过，等于没验。
# 门禁没过就把站停掉：这时线上跑的是刚拉下来、没验过的门禁，留着等于把可能
# 失守的私有站晾在 tailnet 上。修好后手动 pm2 start yufeng-hub-wiki。
on_fail() {
  echo "update-site: 门禁没过，先停私有站（pm2 stop yufeng-hub-wiki）——修好后 pm2 start yufeng-hub-wiki" >&2
  pm2 stop yufeng-hub-wiki >/dev/null 2>&1 || true
}
trap on_fail ERR
pm2 restart yufeng-hub-wiki --update-env >/dev/null
up=0
for _ in $(seq 1 60); do
  sleep 2
  if curl -sf -o /dev/null http://100.81.38.119:4321/api/wiki/me; then up=1; break; fi
done
if [ "$up" != 1 ]; then
  echo "update-site: 私有站重启后 120s 内没起来，pm2 logs yufeng-hub-wiki 看看" >&2
  # 显式 exit 不触发 ERR trap：进程可能还在（比如 API 500 而页面照发），
  # 那就是一个没验过的站在线上——自己停
  on_fail
  exit 1
fi
pnpm check
pnpm build
trap - ERR
echo "$(date "+%F %T") site updated"
