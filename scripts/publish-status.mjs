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
import { fileURLToPath } from 'node:url';

/** 仓库根：CMS 从别的 cwd 起这个脚本时，按 cwd 找内容仓会一个都找不到，
 *  于是「落后了」永远为空——一个过期的部署会报成「已是最新」 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const exec = promisify(execFile);
const REPO = process.env.HUB_REPO ?? 'YufengJin/yufeng-hub';
const WORKFLOW = process.env.HUB_WORKFLOW ?? 'deploy.yml';
const GH = process.env.GH_BIN ?? 'gh';

/**
 * 影响公开站的内容源。deploy.yml 只 clone yufeng-wiki（公开笔记）当内容，
 * vault 和论文墙都刻意不进公开构建（见 deploy.yml 注释）——所以论文墙**不算**
 * 内容源：改海报推上去，公开站根本不重建，把它列进来只会让药丸长期报「落后」。
 *
 *  - hub（壳仓库）：push 即触发构建，构建跑在某个 commit 上，那个 sha 就是
 *    run.headSha，能精确比对（本地 HEAD 在不在它里面）。mode='sha'。
 *  - wiki（公开笔记）：内容是构建时现 clone 的，run 的元数据里没有它当时的
 *    sha，只能按提交时间估（比构建晚 = 落后）。mode='time'，天然有时钟偏差的
 *    边角，但这是唯一可得的信号。
 */
const SOURCES = [
  { name: 'wiki', dir: 'src/content/notes', mode: 'time' },
  { name: 'hub', dir: '.', mode: 'sha' },
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

/**
 * 本地 `localSha` 是不是 `headSha` 的祖先（= 已包含在那次构建里）。
 * 返回 true 表示**落后**（本地有构建没带上的提交）。
 * headSha 本地没有这个对象时无法判断（exit 128），按「不落后」处理，不误报。
 * @param {string} dir @param {string} localSha @param {string} headSha
 */
async function behindBySha(dir, localSha, headSha) {
  if (!localSha || !headSha) return false;
  try {
    await exec('git', ['-C', dir, 'merge-base', '--is-ancestor', localSha, headSha], { timeout: 10_000 });
    return false; // 是祖先 → 已部署
  } catch (err) {
    // exit 1 = 确定不是祖先（落后）；其它退出码（对象不存在等）= 判不了，不误报
    return /** @type {{ code?: number }} */ (err ?? {}).code === 1;
  }
}

/**
 * 落后的内容源：hub 按 sha 精确比对 run.headSha，wiki 按提交时间估。
 * @param {{ createdAt?: string, headSha?: string } | null} run
 */
async function behindSources(run) {
  const deployedAt = run?.createdAt ? Date.parse(run.createdAt) : 0;
  const headSha = run?.headSha ?? '';
  const behind = [];
  for (const src of SOURCES) {
    const dir = join(ROOT, src.dir);
    if (!existsSync(dir)) continue;
    let info;
    try {
      const { stdout } = await exec('git', ['-C', dir, 'log', '-1', '--format=%cI %H %h %s'], { timeout: 10_000 });
      const [iso, full, short, ...rest] = stdout.trim().split(' ');
      info = { name: src.name, at: iso ?? '', full: full ?? '', sha: short ?? '', subject: rest.join(' ').slice(0, 80) };
    } catch {
      continue; // 不是 git 仓库或读不到：跳过，不让状态查询本身失败
    }
    const isBehind =
      src.mode === 'sha' && headSha
        ? await behindBySha(dir, info.full, headSha)
        : !!(info.at && Date.parse(info.at) > deployedAt);
    if (isBehind) behind.push(info);
  }
  return behind;
}

try {
  const run = await lastRun();
  // 落后 = 有内容源没进最后一次构建（hub 看 sha，wiki 看时间）
  const behind = await behindSources(run);
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
  // message 是约定字段（服务端只保留 state/message/url/detail）；用 error
  // 的话这句话会被丢掉，药丸就只剩一个没有解释的 unknown
  console.log(
    JSON.stringify({
      state: 'unknown',
      message: `查不到构建状态：${String(err instanceof Error ? err.message : err).slice(0, 160)}`,
    }),
  );
}
