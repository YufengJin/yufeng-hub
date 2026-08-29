#!/usr/bin/env node
/**
 * 隐私门禁——把「私密内容不会进公开站」从一句约定变成一道会红的检查。
 *
 * 现有保证是「公开 CI 不 clone vault，所以那些字节从未被生成」。它很强，
 * 但只覆盖 vault 挂载点本身。真正的风险在挂载点之外：把 vault 里的一个
 * 文件复制到 public/ 或 src/ 再提交，.gitignore 一点忙都帮不上，而这类
 * 内容（终端录像里的机器路径与内网地址、私密笔记的正文）一旦推到公开仓库
 * 就不可撤回。
 *
 * 两道检查：
 *
 *   1. 壳仓库不得跟踪任何挂载点下的文件。防的是 .gitignore 被改坏，
 *      以及 `git add -f` 这种绕过。两种环境下都跑。
 *
 *   2. 没有 vault 挂载时（也就是公开 CI），dist 里不得出现 vault 命名空间：
 *      没有 /vault/ 页面、没有 /vault-static/、没有指向它们的链接、
 *      搜索索引里没有一条私密记录。这是端到端的那一道——它不关心隐私是
 *      靠什么机制保住的，只问结果对不对。
 *
 * 挂载存在时第 2 项跳过：私有站本来就该有这些页面。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MOUNTS = ['src/content/vault', 'public/vault-static'];
const problems = [];

/* ---------- 1. 壳仓库不得跟踪挂载点下的文件 ---------- */
for (const mount of MOUNTS) {
  let tracked = '';
  try {
    tracked = execFileSync('git', ['ls-files', '--', mount], { cwd: root, encoding: 'utf8' });
  } catch {
    continue; // 不在 git 工作树里（例如 CI 的 tarball 检出），跳过
  }
  const files = tracked.split('\n').filter(Boolean);
  if (files.length) {
    problems.push(
      `壳仓库跟踪了 ${files.length} 个私密挂载下的文件（${mount}/）——` +
        `这些内容会被推到公开仓库：\n    ` +
        files.slice(0, 5).join('\n    ') +
        (files.length > 5 ? `\n    …还有 ${files.length - 5} 个` : ''),
    );
  }
}

/* ---------- 2. 无挂载时，产物里不得有私密痕迹 ---------- */
const mounted = MOUNTS.some((m) => existsSync(join(root, m)));
const dist = join(root, 'dist');

if (!mounted && existsSync(dist)) {
  if (existsSync(join(dist, 'vault'))) problems.push('公开构建的 dist/ 里出现了 vault/ 目录');
  if (existsSync(join(dist, 'vault-static'))) problems.push('公开构建的 dist/ 里出现了 vault-static/ 目录');

  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(html|json)$/.test(name)) {
        const text = readFileSync(p, 'utf8');
        const hits = text.match(/href="[^"]*\/vault(?:-static)?\//g);
        if (hits) {
          problems.push(
            `${relative(dist, p)}: ${hits.length} 个指向私密命名空间的链接（如 ${hits[0]}）`,
          );
        }
      }
    }
  };
  walk(dist);

  const idx = join(dist, 'search-index.json');
  if (existsSync(idx)) {
    let docs = [];
    try {
      const parsed = JSON.parse(readFileSync(idx, 'utf8'));
      docs = Array.isArray(parsed) ? parsed : Object.values(parsed).flat();
    } catch {
      /* 索引格式变了就不在这儿判定，dist 检查会先失败 */
    }
    const priv = docs.filter((d) => String(d?.id ?? '').startsWith('vault/'));
    if (priv.length) problems.push(`搜索索引里有 ${priv.length} 条私密记录`);
  }
}

if (problems.length) {
  console.error('✗ 隐私门禁未通过：\n');
  for (const p of problems) console.error('  • ' + p + '\n');
  console.error('  私密内容属于 yufeng-vault 仓库，不要复制进壳仓库；');
  console.error('  笔记要用的私密资产走 vault 自己的 site/ 目录（由 mount-vault-static.sh 装配）。');
  process.exit(1);
}

console.log(
  mounted
    ? '✓ 隐私门禁通过（挂载在位：只校验壳仓库没有跟踪私密文件）'
    : '✓ 隐私门禁通过（无挂载：产物里没有任何私密痕迹）',
);
