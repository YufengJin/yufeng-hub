#!/usr/bin/env bash
# Stage private static sub-sites from the vault mount into public/vault-static/.
#
# Convention: a vault entry carrying a `site/` dir (self-contained static
# HTML, relative links only) gets that dir published verbatim at
# /vault-static/<slug>/, alongside its /vault/<slug>/ note. Both live in the
# private yufeng-vault repo; the public CI build never clones the vault
# mount, so this script no-ops there and the namespace does not exist on
# the public site — privacy by construction, same as the vault collection.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=src/content/vault
if [ ! -d "$SRC" ]; then
  echo "mount-vault-static: no vault mount, nothing to stage"
  exit 0
fi

mkdir -p public/vault-static

# drop staged sites whose source is gone
find public/vault-static -mindepth 1 -maxdepth 1 -type d | while read -r d; do
  [ -d "$SRC/$(basename "$d")/site" ] || rm -rf "$d"
done

n=0
for s in "$SRC"/*/site; do
  [ -d "$s" ] || continue
  slug="$(basename "$(dirname "$s")")"
  rsync -a --delete --exclude '.DS_Store' --exclude '._*' "$s/" "public/vault-static/$slug/"
  n=$((n + 1))
done
echo "mount-vault-static: staged $n private sites into public/vault-static/"
