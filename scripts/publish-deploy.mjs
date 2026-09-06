#!/usr/bin/env node
// @ts-check
/**
 * 手动触发公开站的构建（deploy.yml 的 workflow_dispatch）。
 *
 * 存在的理由：论文墙那个内容仓没有跨仓库触发的 token，改完海报推上去，
 * 公开站要等到次日 03:17 UTC 的 cron 才跟上。这个脚本把那一步提到现在。
 *
 * `--dry-run` 只检查凭据和 workflow，不发起任何构建。
 *
 * 全程走 REST。`gh workflow run` 不给 `--ref` 时会先用 GraphQL 查默认分支，
 * 而 GraphQL 对匿名请求一律 401，那句 "unable to determine default branch"
 * 会盖住真正的原因。这里自己用 REST 把分支读出来再 dispatch。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const REPO = process.env.HUB_REPO ?? 'YufengJin/yufeng-hub';
const WORKFLOW = process.env.HUB_WORKFLOW ?? 'deploy.yml';
const GH = process.env.GH_BIN ?? 'gh';
const dryRun = process.argv.includes('--dry-run');

/** @param {string[]} args */
const gh = async (args) => (await exec(GH, args, { timeout: 30_000 })).stdout.trim();

/** gh 把有用的话写在 stderr，`message` 只是 "Command failed" 开头的一行 @param {unknown} err */
const errText = (err) => {
  const e = /** @type {{ stderr?: string; message?: string }} */ (err ?? {});
  return String(e.stderr || e.message || err).trim();
};

/**
 * 把 gh 的失败翻译成一句能照着做的话。
 *
 * 401 和 403 是两种病，治法相反：401 是**根本没认证**——token 失效、过期或
 * 从没登录过，要重新登录；403 才是认证过了但权限不够，那时才轮到改 scope。
 * 这两条以前共用一句「这个 token 只有读权限」，会把人引去调 token 权限，
 * 而真正要做的是 `gh auth login`，白费一轮功夫。
 *
 * 限流单列：未认证的请求按 IP 限额（60 次/小时），撞上它本身就说明 gh 多半
 * 在匿名工作，而不是"网络不好"。所以它必须排在 403 前面——限流返回的也是 403。
 *
 * 认证那条别拿裸的 `invalid` 去匹配：422 的 "Invalid request"（分支不存在、
 * 或 workflow 里没写 workflow_dispatch）会被它吃掉，诊断就指错了方向。
 * 而完全没登录时 gh 不提 401，只说 "To get started with GitHub CLI"（实测
 * gh 2.96.0，退出码 4），所以那句话也要认。
 * @param {string} msg
 */
const diagnose = (msg) => {
  if (/rate limit/i.test(msg))
    return '：撞上 GitHub 限流。未认证的请求按 IP 限额（60 次/小时），撞上它通常说明 gh 在匿名工作——先 `gh auth status` 看登录状态';
  if (/\b401\b|Requires authentication|Bad credentials|token .{0,20}invalid|To get started with GitHub CLI/i.test(msg))
    return '：gh 没有有效凭据（token 失效、过期，或这台机器从没登录过）。跑 `gh auth status` 确认，再 `gh auth login -h github.com` 重新登录';
  if (/\b403\b|not accessible|Resource not accessible/i.test(msg))
    return '：已认证但权限不够。fine-grained token 要给该仓库加 Actions: Read and write；classic token 要 `repo` scope（`gh auth login -s repo`）——不是 workflow，那个 scope 只管增改 workflow 文件，不给触发权';
  if (/\b404\b|Not Found/i.test(msg))
    return `：找不到 ${WORKFLOW} 或仓库 ${REPO}——确认名字，以及当前账号看不看得到它`;
  if (/\b422\b|Invalid request|No ref found/i.test(msg))
    return `：分支或触发器不对——确认 ${REPO} 上有这个分支，且 ${WORKFLOW} 里写了 workflow_dispatch`;
  if (/ENOENT/.test(msg)) return '：这台机器上没有 gh，或不在 PATH 里';
  return '';
};

/** 当前走到哪一步，失败时用它说清是哪个环节倒的 */
let step = '';

/**
 * 跑完整条链，返回要报给 CMS 的那一行。
 *
 * 中途一律 `return` 而不是 `process.exit`：stdout 接的是管道（服务端用
 * execFile 收），管道写入是异步的，exit 会把还没刷出去的 JSON 截断，
 * 服务端拿到半行就只剩一个没有解释的 unknown。所以只在最后输出一次。
 * @returns {Promise<{state: string, message: string, url?: string}>}
 */
async function run() {
  // 1. 先验凭据，且必须在最前面。
  //    读 workflow 那一步证明不了任何事：壳仓库是公开的，token 失效时 gh 会
  //    退回**匿名**请求，公开元数据照样读得到——于是 dry-run 报「可以触发」，
  //    真去触发才 401。所以这里问一个必须认证才答得上来的问题。
  step = '确认 gh 凭据';
  const login = await gh(['api', 'user', '--jq', '.login']);

  // 2. workflow 必须存在且 active，否则 dispatch 只会得到一句含糊的 404
  step = `读取 ${WORKFLOW}`;
  const wf = JSON.parse(await gh(['api', `repos/${REPO}/actions/workflows/${WORKFLOW}`, '--jq', '{id,name,state}']));
  if (wf.state !== 'active') return { state: 'error', message: `workflow ${WORKFLOW} 不是 active（当前 ${wf.state}）` };

  // 3. 分支：REST 读，别让 gh 去走 GraphQL
  step = '读取默认分支';
  const ref = process.env.HUB_REF ?? (await gh(['api', `repos/${REPO}`, '--jq', '.default_branch']));

  if (dryRun)
    return { state: 'ok', message: `可以触发：${wf.name}（id ${wf.id}，分支 ${ref}，身份 ${login}）— dry-run，没有发起构建` };

  step = '触发构建';
  await gh(['api', '-X', 'POST', `repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, '-f', `ref=${ref}`]);
  return {
    state: 'ok',
    message: `已请求构建 ${wf.name}（分支 ${ref}，身份 ${login}）`,
    url: `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`,
  };
}

let out;
try {
  out = await run();
} catch (err) {
  const msg = errText(err);
  out = { state: 'error', message: `${step}失败${diagnose(msg)} — ${msg.slice(0, 200)}` };
}
console.log(JSON.stringify(out));
process.exitCode = out.state === 'error' ? 1 : 0;
