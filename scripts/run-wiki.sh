#!/usr/bin/env bash
# yufeng-hub 编辑机：常驻 WIKI=1 astro dev，只绑 tailnet 地址
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$HOME/.local/bin:$PATH
cd $HOME/yufeng-hub/hub-site
exec env WIKI=1 SITE_HOST=chaser-ws02-u,chaser-ws02-u.eagle-terrapin.ts.net ./node_modules/.bin/astro dev --host 100.81.38.119 --port 4321
