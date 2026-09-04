#!/usr/bin/env node
// @ts-check
/**
 * 手动触发公开站的构建（deploy.yml 的 workflow_dispatch）。
 *
 * 存在的理由：论文墙那个内容仓没有跨仓库触发的 token，改完海报推上去，
 * 公开站要等到次日 03:17 UTC 的 cron 才跟上。这个脚本把那一步提到现在。
 *
 * `--dry-run` 只检查 workflow 在不在、能不能读到，不发起任何构建。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const REPO = process.env.HUB_REPO ?? 'YufengJin/yufeng-hub';
const WORKFLOW = process.env.HUB_WORKFLOW ?? 'deploy.yml';
const GH = process.env.GH_BIN ?? 'gh';
const dryRun = process.argv.includes('--dry-run');

/** @param {string} state @param {string} message @param {Record<string, unknown>} [extra] */
const say = (state, message, extra = {}) => {
  console.log(JSON.stringify({ state, message, ...extra }));
  process.exit(state === 'error' ? 1 : 0);
};

try {
  // workflow 必须存在且是 active 的，否则 dispatch 只会得到一句含糊的 404
  const { stdout } = await exec(
    GH,
    ['api', `repos/${REPO}/actions/workflows/${WORKFLOW}`, '--jq', '{id, name, state}'],
    { timeout: 20_000 },
  );
  const wf = JSON.parse(stdout);
  if (wf.state !== 'active') say('error', `workflow ${WORKFLOW} 不是 active（当前 ${wf.state}）`);

  if (dryRun) say('ok', `可以触发：${wf.name}（id ${wf.id}）— dry-run，没有发起构建`);

  await exec(GH, ['workflow', 'run', WORKFLOW, '-R', REPO], { timeout: 30_000 });
  say('ok', `已请求构建 ${wf.name}`, { url: `https://github.com/${REPO}/actions/workflows/${WORKFLOW}` });
} catch (err) {
  const msg = String(err instanceof Error ? err.message : err);
  // 权限不足是最可能的失败：token 需要 workflow scope
  const hint = /403|not accessible|Resource not accessible/i.test(msg)
    ? '：gh 的 token 缺 workflow 权限，重新 `gh auth login -s workflow` 或换一个带该权限的 token'
    : '';
  say('error', `触发失败${hint} — ${msg.slice(0, 200)}`);
}
