#!/usr/bin/env bash
# yufeng-hub 私有站（编辑机形态）：常驻 WIKI=1 astro dev，带 inkbrush CMS，
# 只绑 tailnet 地址。pm2 进程 yufeng-hub-wiki。
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$HOME/.local/bin:$PATH
cd $HOME/yufeng-hub/hub-site
# tailnet 主机名访问需显式放行（Vite Host 头校验）；IP 直连不受此限。
# dev 与 preview 是两套配置，astro.config.mjs 把这份名单同时喂给两者。
export SITE_HOST=chaser-ws02-u,chaser-ws02-u.eagle-terrapin.ts.net
# 和 run-preview.sh 里的 ASTRO_PREVIEW_BACKGROUND 同一个坑，dev 有自己的开关：
#   agentDetected = !process.env.ASTRO_DEV_BACKGROUND && isRunByAgent()
# 不设它的话，astro 检测到 agent 环境（CLAUDECODE 等，pm2 会继承启动者的
# 环境）就自动 detach 成后台进程，pm2 的前台进程立刻退出、被判崩溃并无限
# 重启，而真正在服务的是 pm2 管不到的孤儿。判断健康看一句话：`pm2 pid` 要
# 等于 `ss -tlnp | grep 4321` 里的 pid。
export ASTRO_DEV_BACKGROUND=0
exec env WIKI=1 ./node_modules/.bin/astro dev --host 100.81.38.119 --port 4321
