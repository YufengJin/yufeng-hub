---
name: update
description: yufeng-hub 一句话总入口——处理统一收件箱并刷新站点。用户输入 /update、「更新」、「整理一下」、「update hub」时使用。薄路由：分拣规则全在 inbox-triage。
---

# /update — hub 一句话更新

1. **先 Read 本仓库 `.claude/skills/inbox-triage/SKILL.md` 并严格遵循**——
   处理 `~/yufeng-hub/inbox/` 里的全部条目（分拣 → 产出 → 质检 → 各仓
   commit+push → 归档到 `_processed/`）。
2. 有任何内容变动就跑 `bash ~/yufeng-hub/update-site.sh` 刷新私有站。
3. 若用户在 /update 后面带了参数（如 `/update 只处理论文` 或
   `/update 那篇 DDS 的放 robotics`），把参数当作对本次分拣的定制约束，
   其余纪律不变。
4. 按 inbox-triage 的汇报格式收尾：逐项去向 + 挂起项 + 公开站生效时间提示。
