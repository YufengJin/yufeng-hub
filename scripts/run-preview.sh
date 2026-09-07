#!/usr/bin/env bash
# yufeng-hub 私有静态站：serve dist/，只绑 tailnet 地址。run-wiki.sh 的退路。
#
# 注意这条路**没有 vault 阅读门禁**：门禁装在 vite 中间件层，只在
# WIKI=1 astro dev 下加载（astro.config.mjs），astro preview 是纯静态服务。
# 而带着 vault 挂载构建出来的 dist/ 里就有 dist/vault/、dist/vault-static/
# 和一份含私密记录的搜索索引——直接 preview 等于把私密笔记敞给整个 tailnet。
# 所以先自查：产物里有私密目录就拒绝启动，除非明确覆盖。
# 想用它服务公开那半边：把 vault 挂载挪走重新 build，再起。
set -euo pipefail
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
cd "$HOME/yufeng-hub/hub-site"

# 整棵产物树里找 vault 段：私密笔记有语言镜像（dist/en/vault/x），只看顶层
# 的话「只有英文私密笔记」的产物两个测试都过得去
if [ -d dist ] && [ -n "$(find dist -type d \( -name vault -o -name vault-static \) -print -quit)" ]; then
  if [ "${PREVIEW_ALLOW_VAULT:-}" = 1 ]; then
    echo "run-preview: 警告——dist/ 含私密内容，且 preview 没有门禁（PREVIEW_ALLOW_VAULT=1 已确认）" >&2
  else
    echo "run-preview: 拒绝启动——dist/ 里有 vault，而 astro preview 没有阅读门禁。" >&2
    echo "  要么用 run-wiki.sh（带门禁的私有站），要么把 vault 挂载挪开重新 pnpm build，" >&2
    echo "  确知无妨时用 PREVIEW_ALLOW_VAULT=1 覆盖。" >&2
    exit 1
  fi
fi
# tailnet 主机名访问需显式放行（Vite Host 头校验）；IP 直连不受此限
export SITE_HOST=chaser-ws02-u,chaser-ws02-u.eagle-terrapin.ts.net
# astro preview 检测到 agent 环境（CLAUDECODE 等）会自动转后台并 detach，
# 于是 pm2 的前台进程立刻退出、被判为崩溃、无限重启，而真正在服务的是一个
# pm2 管不到的孤儿进程（父进程 systemd）。astro 的判定是
#   !process.env.ASTRO_PREVIEW_BACKGROUND && isRunByAgent()
# 所以把它设成任意非空值即可关掉自动检测，老实前台运行、交给 pm2 管。
export ASTRO_PREVIEW_BACKGROUND=0
exec ./node_modules/.bin/astro preview --host 100.81.38.119 --port 4321
