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
- **私有站**（ws02）：`WIKI=1 astro dev` 常驻只绑 tailnet 地址（pm2 进程
  `yufeng-hub-wiki`），含 vault，**读写一体**——inkbrush CMS 在同一个地址上
  提供块编辑、块级提问、段落批注、按批注改稿与发布状态；内容更新跑
  `~/yufeng-hub/update-site.sh`，每日 cron 兜底。退路是
  `run-preview.sh`（纯静态只读，和它抢 4321）。

## 公私边界

私密性由**构建材料**决定：公开 CI 的 checkout 里根本没有 vault 这个目录，
它的 loader 被整个丢掉，`vault/` 命名空间下一条记录也不会生成——没有页面、
没有卡片、没有搜索记录，也没有指向它们的链接。不依赖任何运行时访问控制
（GitHub Pages 也提供不了：静态托管上，传上去的每个字节都是公开可读的；
私有站只有自己能看，靠的是它只绑 tailnet 地址）。

**两个挂载，一个 collection。** wiki 与 vault 是两个独立仓库，装配进同一个
`notes` collection（`src/content.config.ts` 里两个 glob 各跑在一层 scoped
store 上），vault 的 id 打进 `vault/` 命名空间（`src/lib/private.ts`）。
于是私密笔记不是另一种页面，而是**普通笔记**：同一套 frontmatter、同一套
版式与侧栏、同一张链接图、同一套质检门禁；在私有站上和公开笔记一起出现在
`/all`、facet 页、首页书架与 ⌘K 搜索里，只多带一枚「私密」标记。`/vault/`
是它们的独立索引，公开构建里同样不存在。

一条硬约束：**公开笔记不要 `[[链接]]` 到私密笔记**——公开构建里目标不存在，
`pnpm check` 会在公开 CI 上直接失败。反向（私密链公开）完全正常。这条压力
是故意的：公开的那一半必须能独立成立。

**门禁**（`scripts/check-privacy.mjs`，`pnpm check` 与 `pnpm build` 都会跑）
补上 `.gitignore` 管不到的那半边——私密文件被复制到挂载点之外再提交：壳仓库
不得跟踪两个挂载点下的任何文件；没有 vault 挂载时，产物里不得有 `/vault/`
页面、`/vault-static/`、指向它们的链接或搜索索引记录。笔记要用的私密资产
走 vault 自己的 `site/` 目录，**绝不复制进壳仓库的 `public/`**。

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
