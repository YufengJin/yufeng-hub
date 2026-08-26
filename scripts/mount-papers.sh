#!/usr/bin/env bash
# Stage poster pages from the paper-snapshots repo into public/papers/.
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
  SRC="$(mktemp -d)/paper-snapshots"
  git clone --depth 1 https://github.com/YufengJin/paper-snapshots.git "$SRC"
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
