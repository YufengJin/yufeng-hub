#!/usr/bin/env node
// @ts-check
/**
 * 公开站的发布状态——CMS 的同步药丸只管到 `git push`，这里接着往下报一层。
 *
 * 药丸绿了只代表提交推到 GitHub 了。公开站是 Actions 构建的，而
 * `deploy.yml` 只在四种情况下跑：壳仓库 push、yufeng-wiki 发的
 * repository_dispatch、每日 03:17 UTC 的 cron、手动触发。**论文墙那个仓库
 * 没有跨仓库触发的 token**，所以改完海报推上去，公开站最坏要等到次日；
 * 构建挂了药丸也照样是绿的——它读的是 git 的 ahead/behind，不是构建结果。
 *
 * 输出一行 JSON 给 CMS 显示：最后一次部署是什么时候、成没成、以及自那以后
 * 内容仓有没有新提交（有 = 公开站落后了）。
 *
 * 只读，不触发任何东西。凭据用本机的 gh CLI。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const exec = promisify(execFile);
const REPO = process.env.HUB_REPO ?? 'YufengJin/yufeng-hub';
const WORKFLOW = process.env.HUB_WORKFLOW ?? 'deploy.yml';
const GH = process.env.GH_BIN ?? 'gh';

/** 影响公开站的内容源（vault 不进公开构建，故不算） */
const SOURCES = [
  { name: 'wiki', dir: 'src/content/notes' },
  { name: 'papers', dir: '../pages/paper-snapshots' },
  { name: 'hub', dir: '.' },
];

async function lastRun() {
  const { stdout } = await exec(
    GH,
    ['run', 'list', '-R', REPO, '--workflow', WORKFLOW, '--limit', '1',
     '--json', 'status,conclusion,createdAt,event,url,headSha'],
    { timeout: 20_000 },
  );
  const runs = JSON.parse(stdout);
  return Array.isArray(runs) && runs[0] ? runs[0] : null;
}

/** 各内容源最近一次提交的时间（用来判断公开站是否落后） */
async function newestCommits() {
  const out = [];
  for (const src of SOURCES) {
    const dir = join(process.cwd(), src.dir);
    if (!existsSync(dir)) continue;
    try {
      const { stdout } = await exec('git', ['-C', dir, 'log', '-1', '--format=%cI %h %s'], { timeout: 10_000 });
      const [iso, sha, ...rest] = stdout.trim().split(' ');
      out.push({ name: src.name, at: iso ?? '', sha: sha ?? '', subject: rest.join(' ').slice(0, 80) });
    } catch {
      /* 不是 git 仓库或读不到：跳过，不让状态查询本身失败 */
    }
  }
  return out;
}

try {
  const [run, commits] = await Promise.all([lastRun(), newestCommits()]);
  const deployedAt = run?.createdAt ? Date.parse(run.createdAt) : 0;
  // 落后 = 有内容源的最新提交比最后一次部署还新
  const behind = commits.filter((c) => c.at && Date.parse(c.at) > deployedAt);
  const state = !run
    ? 'unknown'
    : run.status !== 'completed'
      ? 'building'
      : run.conclusion !== 'success'
        ? 'failed'
        : behind.length
          ? 'stale'
          : 'current';
  // CMS 约定的形状：{ state, message?, url?, detail? }——它只按 state 决定颜色，
  // 文字原样显示，所以这里说人话。
  const when = run?.createdAt
    ? new Date(run.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';
  const EVENTS = { push: '壳仓库推送', schedule: '每日定时', workflow_dispatch: '手动触发', repository_dispatch: '内容仓触发' };
  const trigger = EVENTS[run?.event ?? ''] ?? run?.event ?? '';
  const message =
    state === 'building' ? `正在构建（${trigger}，${when} 起）`
    : state === 'failed' ? `上次构建失败（${trigger}，${when}）`
    : state === 'stale' ? `落后 ${behind.length} 个内容仓——上次构建 ${when}`
    : state === 'current' ? `已是最新（上次构建 ${when}，${trigger}）`
    : '查不到构建状态';
  const detail = behind.length
    ? behind.map((c) => `${c.name} ${c.sha} ${c.subject}`).join(' · ').slice(0, 300)
    : undefined;

  console.log(JSON.stringify({ state, message, ...(run?.url ? { url: run.url } : {}), ...(detail ? { detail } : {}) }));
} catch (err) {
  // 查不到状态不是错误——没网、没 gh、没登录都可能，说清楚就好
  console.log(JSON.stringify({ state: 'unknown', error: String(err instanceof Error ? err.message : err).slice(0, 200) }));
}
