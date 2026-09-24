---
name: publish
description: 把一篇私密 vault 笔记发布到公开 wiki（GitHub 公开仓库 yufeng-wiki + 公开站）。**只在用户明确说「发布 / 公开 / 放到公开 wiki / 推到 github 公开」并点名了笔记时使用**，绝不因为笔记写完了就主动发布。也处理反向的「撤回公开」。
---

# publish — vault → 公开 wiki

hub 的默认是**私密**：单篇整理、综述、实验记录都落 vault（私有仓库）或论文墙（私有仓库）。
公开是一次单独的、由用户点名的动作。发布是对外的：推上公开仓库后，内容即使再删也会留在
git 历史、GitHub 缓存和别人的 clone 里——所以每一步都先看清再动。

论文墙海报不能「发布」：论文墙整体是私有的。要公开一篇论文的内容，先用 paper-digest 写成
vault 笔记，再发布那篇笔记。

## 1. 确认对象

用户点名的笔记在 `src/content/vault/<slug>/`（有英文镜像就还有 `vault/en/<slug>/`）。
检查 `src/content/notes/<slug>` 不存在（重名就停下问）。

## 2. 扫描

```bash
cd ~/yufeng-hub/hub-site
bash .claude/skills/publish/scan.sh src/content/vault/<slug>
```

- **必须处理**（脚本退出码 1）：指向 vault / 论文墙 / vault-static 的链接（公开站会死链，也暴露私密条目
  的存在）→ 删掉或改成纯文本；凭据 → 删；`site/` 目录 → 公开站没有对应物，问用户是丢弃还是把关键图挪进 `img/`。
- **提醒项**（内网地址、主机名、本机路径、邮箱、公司名）：逐条列给用户看，**由用户决定**保留还是泛化。
  不要自作主张全部删掉，也不要不问就全部保留。
- 自己再通读一遍：实验记录里常有未公开的项目名、同事名、内部数字。

把要做的改动列成清单给用户确认，确认后再动。

## 3. 搬家

```bash
V=src/content/vault; N=src/content/notes
cp -r $V/<slug> $N/<slug>                       # 有镜像：cp -r $V/en/<slug> $N/en/<slug>
# 在 $N/<slug> 里应用第 2 步确认过的改动
git -C $V rm -r -q <slug>                       # 有镜像也 rm
grep -rln '\[\[vault/<slug>' $V                 # 其他私密笔记里指向它的链接改成 [[<slug>...]]
```

frontmatter 不用改（两边同一套 schema）；`status` 若还是 seedling，提醒用户。

## 4. 门禁

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
pnpm check && pnpm build
```

再模拟公开构建一次，确认不挂 vault 时这篇也能独立构建（公开笔记链向私密笔记会在这里暴露）：
把 `src/content/vault`、`public/papers`、`public/vault-static` 挪到 scratchpad，`pnpm build`，
**挪回来**，再 `pnpm build` 一次恢复私有站产物，然后 `pm2 restart yufeng-hub-wiki`
（内容根目录消失又出现后，多章节子页会 500，重启恢复）。

## 5. 提交与上线

```bash
git -C src/content/notes add <slug> && git -C src/content/notes commit -m "发布：<标题>（自 vault 转公开）"
git -C src/content/vault add -A && git -C src/content/vault commit -m "<slug> 转为公开笔记，移出 vault"
git -C src/content/notes push && git -C src/content/vault push
gh workflow run deploy.yml -R YufengJin/yufeng-hub      # 不触发就等每日 03:17 UTC cron
bash ~/yufeng-hub/update-site.sh
```

汇报：公开地址（`https://yufengjin.github.io/yufeng-hub/<slug>/`，以 CI 的实际 base 为准）、
第 2 步里用户确认过的改动、CI run 链接。

## 撤回公开

反向搬家（notes → vault，链接反向改写），同样过门禁、两仓提交、触发部署。
**必须告诉用户**：公开仓库的 git 历史里这篇仍在，任何人翻历史都能看到；要真正抹掉需要改写
历史（force-push），这违反 hub 的「永不 force-push」纪律，只有用户明确要求才讨论。
