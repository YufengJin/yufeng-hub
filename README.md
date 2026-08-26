# yufeng-hub

我的个人 hub——数字园地：笔记、论文墙与私密库。
公开站发布在 **<https://yufengjin.github.io/yufeng-hub/>**，
编辑机跑在 ws02（tailnet 内网）。

架构照搬 [astro-inkstone](https://github.com/ventusff/astro-inkstone)
（外观层）+ [astro-inkbrush](https://github.com/ventusff/astro-inkbrush)
（编辑机）的官方形态：引擎以 git submodule 进 `packages/`，内容仓以普通
clone 挂进 gitignored 目录——内容提交频繁，不该淹没壳仓库的历史。

## 仓库与挂载

| 挂载点 | 仓库 | 可见性 | 角色 |
|---|---|---|---|
| `packages/astro-inkstone` | `ventusff/astro-inkstone` | 公开 | 外观：token、内容样式、组件、管线 preset |
| `packages/astro-inkbrush` | `ventusff/astro-inkbrush` | 公开 | 编辑机：块编辑、修订、AI、Obsidian inbox |
| `src/content/notes` | `YufengJin/yufeng-wiki` | **公开** | 笔记正文（zh 默认 + en 镜像）+ `_meta` 注册表 |
| `src/content/vault` | `YufengJin/yufeng-vault` | **私有** | 私密半区——公开 CI 不 clone，`/vault/` 整个命名空间在公开站上不存在 |
| `public/papers` | `YufengJin/yufeng-papers`（`scripts/mount-papers.sh` 装配海报目录） | 公开 | 论文墙模块：海报页整站托管在本站 `/papers/<slug>/`，同一棵树的 meta.json 喂索引卡 |

## 本地开发（ws02）

```sh
git clone --recurse-submodules git@github.com:YufengJin/yufeng-hub.git
cd yufeng-hub
git clone git@github.com:YufengJin/yufeng-wiki.git src/content/notes
git clone git@github.com:YufengJin/yufeng-vault.git src/content/vault
bash scripts/mount-papers.sh   # 有现成 checkout 时: PAPERS_SRC=/path/to/paper-snapshots
pnpm install
pnpm dev            # 纯阅读
pnpm wiki           # WIKI=1 —— 编辑模式（悬停段落点 ✎）
pnpm build          # 静态构建（postbuild 验证零 CMS 字节）
pnpm check          # 内容方言 + wikilink 完整性
```

## 部署

- **公开站**：push 到 `yufeng-hub` / `yufeng-wiki` → GitHub Actions 构建
  （clone 公开挂载，**不含 vault**）→ Pages。见 `.github/workflows/deploy.yml`。
- **私有站**（ws02）：静态构建含 vault，`astro preview` 常驻只绑 tailnet 地址
  （pm2 进程 `yufeng-hub-preview`）；内容更新跑 `~/yufeng-hub/update-site.sh`，
  每日 cron 兜底。无编辑机、无 AI——纯网页分享。

## 公私边界

私密性由**构建材料**决定：公开 CI 的 checkout 里根本没有 vault 这个目录，
`/vault/` 的路由树因此为空。不依赖任何运行时访问控制。

## 模块契约（以后加新板块照此办理）

壳仓库只放代码，**内容和重资产一律独立仓库**，构建时挂载——壳永远轻，
重仓库各自演化、单独扩容、坏了也不连累别人。一个模块 = 三样东西：

1. **自己的仓库**（如 `yufeng-papers`：产物 + 产出流水线 + 项目 skill 都住在一起）；
   二进制多的模块尤其要独立——git 历史只膨胀它自己。
2. **一个挂载脚本**（`scripts/mount-<module>.sh`）：把该仓库的发布物装配进
   `public/<module>/`（自包含静态页）或 `src/content/<module>/`（进内容集合），
   CI 与 ws02 共用同一脚本。
3. **一个入口**：hub 里一个 section 页（读该模块的 meta 数据做索引），
   首页加一块瓦片，顶栏视情况加导航链。

现有模块：wiki（笔记）、vault（私密）、papers（论文墙）。
