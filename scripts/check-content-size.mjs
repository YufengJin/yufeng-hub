#!/usr/bin/env node
/**
 * Storage gate for the content repositories (public wiki + private vault).
 *
 * Git keeps every byte forever: a 40 MB video committed once and deleted
 * next week still costs 40 MB in every clone. So the gate runs *before* the
 * commit, over what git would pick up (tracked + untracked-not-ignored), and
 * fails on the kinds of file that experiment write-ups tend to drag in:
 *
 *   - anything over MAX_FILE (hard error)
 *   - raw data / weights / archives of any size (hard error) — they belong
 *     on disk or in W&B; the note links to where they live (a short demo
 *     clip is fine as long as it stays under MAX_FILE)
 *   - raster images over MAX_IMAGE, or any PNG/JPG over MAX_RASTER
 *     (warning: convert to WebP, cap the width at 1600px)
 *
 * Deliberate exceptions go in `.large-files` at the content repo's root,
 * one repo-relative path per line (`#` comments allowed).
 *
 * A repository that is not mounted (the vault in public CI) is skipped.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_FILE = 1_000_000;
const MAX_IMAGE = 400_000;
const MAX_RASTER = 150_000;
const BANNED = new Set([
  '.pt', '.pth', '.ckpt', '.safetensors', '.bin', '.onnx', '.h5', '.hdf5',
  '.npz', '.npy', '.pkl', '.parquet', '.arrow', '.tfrecord', '.bag', '.mcap',
  '.zip', '.tar', '.gz', '.tgz', '.7z',
]);
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg']);
const RASTER = new Set(['.png', '.jpg', '.jpeg']);

const siteDir = fileURLToPath(new URL('..', import.meta.url));
const repos = ['src/content/notes', 'src/content/vault']
  .map((d) => join(siteDir, d))
  .filter((d) => existsSync(join(d, '.git')));

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
let errors = 0;
let warnings = 0;

for (const repo of repos) {
  const allowFile = join(repo, '.large-files');
  const allow = new Set(
    existsSync(allowFile)
      ? readFileSync(allowFile, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)
      : [],
  );
  const ls = spawnSync('git', ['-C', repo, 'ls-files', '-z', '-co', '--exclude-standard'], { encoding: 'utf8' });
  if (ls.status !== 0) {
    console.error(`check-content-size: git ls-files failed in ${repo}`);
    process.exit(1);
  }
  let total = 0;
  for (const rel of ls.stdout.split('\0').filter(Boolean)) {
    const abs = join(repo, rel);
    if (!existsSync(abs)) continue; // deleted in the worktree, not yet committed
    const size = statSync(abs).size;
    total += size;
    if (allow.has(rel)) continue;
    const ext = extname(rel).toLowerCase();
    const where = `${repo.slice(siteDir.length)}/${rel}`;
    if (BANNED.has(ext)) {
      console.error(`✗ ${where} (${kb(size)}): ${ext} 不进 git——原始数据/权重/压缩包放本机或 W&B，笔记里写路径`);
      errors++;
    } else if (size > MAX_FILE) {
      console.error(`✗ ${where} (${kb(size)}): 超过 ${kb(MAX_FILE)}——截取要点或写进 .large-files 豁免`);
      errors++;
    } else if (IMAGE.has(ext) && size > MAX_IMAGE) {
      console.warn(`! ${where} (${kb(size)}): 图片偏大，建议 cwebp -q 80 -resize 1600 0`);
      warnings++;
    } else if (RASTER.has(ext) && size > MAX_RASTER) {
      console.warn(`! ${where} (${kb(size)}): 转成 WebP 通常能省一半以上`);
      warnings++;
    }
  }
  console.log(`check-content-size: ${repo.slice(siteDir.length)} ${(total / 1e6).toFixed(1)} MB`);
}

if (errors) {
  console.error(`check-content-size: ${errors} 个文件不该进内容仓`);
  process.exit(1);
}
if (warnings) console.warn(`check-content-size: ${warnings} 条体积提醒（不阻断）`);
