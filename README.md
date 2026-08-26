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
| `public/papers` | `YufengJin/paper-snapshots`（`scripts/mount-papers.sh` 装配海报目录） | 公开 | 论文墙：海报页整站托管在本站 `/papers/<slug>/`，同一棵树的 meta.json 喂索引卡 |

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
- **编辑机**（ws02）：常驻 `WIKI=1 astro dev`，绑 tailnet 地址，
  `inkbrush.config.ts` 开 autocommit + autopush——每次保存即提交并推送，
  公开站随之重建。

## 公私边界

私密性由**构建材料**决定：公开 CI 的 checkout 里根本没有 vault 这个目录，
`/vault/` 的路由树因此为空。不依赖任何运行时访问控制。
