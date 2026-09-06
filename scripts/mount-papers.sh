#!/usr/bin/env bash
# Stage poster pages from the yufeng-papers repo (formerly paper-snapshots) into public/papers/.
#
# PRIVATE-SITE ONLY. yufeng-papers is a PRIVATE repository and the public CI
# deliberately never runs this script: with no public/papers/ the public build
# has no paper wall at all — no route, no nav entry, no card, no search record
# (src/lib/papers.ts). The anonymous clone below therefore only works on a
# machine whose git credentials can read the private repo; on ws02 the mount
# always passes PAPERS_SRC and never clones.
#
# Poster dir = a top-level dir carrying meta.json (index.html + img/ + meta).
# The pages are self-contained (relative img/ only; "../" back-link lands on
# the hub's /papers/ index), so they publish as plain static assets, and the
# papers collection reads the same tree's meta.json — one mount, both uses.
#
# PAPERS_SRC can point at an existing checkout (the ws02 working copy);
# without it a fresh shallow clone is made into a temp dir (CI).
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${PAPERS_SRC:-}"
if [ -z "$SRC" ]; then
  SRC="$(mktemp -d)/yufeng-papers"
  git clone --depth 1 https://github.com/YufengJin/yufeng-papers.git "$SRC"
fi

mkdir -p public/papers

# drop staged posters whose source is gone
find public/papers -mindepth 1 -maxdepth 1 -type d | while read -r d; do
  [ -f "$SRC/$(basename "$d")/meta.json" ] || rm -rf "$d"
done

n=0
for m in "$SRC"/*/meta.json; do
  d="$(dirname "$m")"
  slug="$(basename "$d")"
  rsync -a --delete --exclude '.DS_Store' --exclude '._*' "$d/" "public/papers/$slug/"
  n=$((n + 1))
done
echo "mount-papers: staged $n posters into public/papers/"
