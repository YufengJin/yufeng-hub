#!/usr/bin/env bash
# yufeng-hub 私有静态站：serve dist/（含 vault），只绑 tailnet 地址
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
cd $HOME/yufeng-hub/hub-site
# tailnet 主机名访问需显式放行（Vite Host 头校验）；IP 直连不受此限
export SITE_HOST=chaser-ws02-u,chaser-ws02-u.eagle-terrapin.ts.net
# astro preview 检测到 agent 环境（CLAUDECODE 等）会自动转后台并 detach，
# 于是 pm2 的前台进程立刻退出、被判为崩溃、无限重启，而真正在服务的是一个
# pm2 管不到的孤儿进程（父进程 systemd）。astro 的判定是
#   !process.env.ASTRO_PREVIEW_BACKGROUND && isRunByAgent()
# 所以把它设成任意非空值即可关掉自动检测，老实前台运行、交给 pm2 管。
export ASTRO_PREVIEW_BACKGROUND=0
exec ./node_modules/.bin/astro preview --host 100.81.38.119 --port 4321
