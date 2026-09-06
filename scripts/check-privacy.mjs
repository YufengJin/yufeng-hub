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
 *   2. 某个私密命名空间没有挂载时（也就是公开 CI），dist 里不得出现它：
 *      没有它的页面目录、没有指向它的链接、搜索索引里没有一条它的记录。
 *      这是端到端的那一道——它不关心隐私是靠什么机制保住的，只问结果
 *      对不对。
 *
 * 两个命名空间各判各的（论文墙可以在位而 vault 不在，反之亦然），挂载存在
 * 的那个跳过第 2 项：私有站本来就该有这些页面。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * 只属于私有站的两个命名空间，各自的挂载点、产物目录、链接特征与索引 id 前缀。
 * vault 是私密笔记，论文墙是海报——两个内容仓都是 private，公开 CI 一个都不
 * clone，所以公开产物里这两样都不该有任何痕迹。
 */
const NAMESPACES = [
  {
    name: 'vault',
    repo: 'yufeng-vault',
    mounts: ['src/content/vault', 'public/vault-static'],
    distDirs: ['vault', 'vault-static'],
    link: () => /href="[^"]*\/vault(?:-static)?\//g,
    idPrefix: 'vault/',
  },
  {
    name: '论文墙',
    repo: 'yufeng-papers',
    mounts: ['public/papers'],
    distDirs: ['papers'],
    link: () => /href="[^"]*\/papers\//g,
    idPrefix: 'papers/',
  },
];
const MOUNTS = NAMESPACES.flatMap((ns) => ns.mounts);
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

/* ---------- 2. 某个命名空间没挂载时，产物里不得有它的痕迹 ---------- */
const dist = join(root, 'dist');
const absent = NAMESPACES.filter((ns) => !ns.mounts.some((m) => existsSync(join(root, m))));

if (absent.length && existsSync(dist)) {
  for (const ns of absent) {
    for (const d of ns.distDirs) {
      if (existsSync(join(dist, d))) problems.push(`公开构建的 dist/ 里出现了 ${d}/ 目录（${ns.name}）`);
    }
  }

  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(html|json)$/.test(name)) {
        const text = readFileSync(p, 'utf8');
        for (const ns of absent) {
          const hits = text.match(ns.link());
          if (hits) {
            problems.push(
              `${relative(dist, p)}: ${hits.length} 个指向${ns.name}的链接（如 ${hits[0]}）`,
            );
          }
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
    for (const ns of absent) {
      const priv = docs.filter((d) => String(d?.id ?? '').startsWith(ns.idPrefix));
      if (priv.length) problems.push(`搜索索引里有 ${priv.length} 条${ns.name}记录`);
    }
  }
}

if (problems.length) {
  console.error('✗ 隐私门禁未通过：\n');
  for (const p of problems) console.error('  • ' + p + '\n');
  console.error('  私密内容属于它自己的私有仓库（yufeng-vault / yufeng-papers），不要复制进壳仓库；');
  console.error('  笔记要用的私密资产走 vault 自己的 site/ 目录（由 mount-vault-static.sh 装配）。');
  process.exit(1);
}

console.log(
  absent.length === 0
    ? '✓ 隐私门禁通过（挂载都在位：只校验壳仓库没有跟踪私密文件）'
    : `✓ 隐私门禁通过（未挂载 ${absent.map((n) => n.name).join(' / ')}：产物里没有它们的任何痕迹）`,
);
