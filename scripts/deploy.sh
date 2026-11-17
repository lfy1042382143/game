#!/usr/bin/env bash
# 构建 dist/ 并部署到 Cloudflare Pages
# 用法：bash scripts/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"

echo "==> 清理 dist/"
rm -rf "$DIST"
mkdir -p "$DIST"

echo "==> 收集静态资源"
cp "$ROOT/index.html" "$DIST/"
cp -r "$ROOT/css" "$DIST/css"
cp -r "$ROOT/js"  "$DIST/js"

echo "==> 产物清单"
find "$DIST" -type f | sed "s|$DIST/||" | sort

echo "==> 部署到 Cloudflare Pages"
cd "$ROOT"
npx wrangler pages deploy "$DIST" --commit-dirty=true
