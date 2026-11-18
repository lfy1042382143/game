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

# Cloudflare Pages 给 js/css 默认 4 小时缓存，而文件名不带 hash，
# 部署后浏览器可能继续跑旧代码。这里给引用加内容指纹破缓存。
V=$(find "$DIST/js" "$DIST/css" -type f | sort | xargs cat | md5sum | cut -c1-8)
echo "==> 资源版本指纹: $V"
sed -i -E "s#(href=\"css/[^\"]+\.css)\"#\1?v=$V\"#g; s#(src=\"js/[^\"]+\.js)\"#\1?v=$V\"#g" "$DIST/index.html"

echo "==> 产物清单"
find "$DIST" -type f | sed "s|$DIST/||" | sort

echo "==> 部署到 Cloudflare Pages"
cd "$ROOT"
npx wrangler pages deploy "$DIST" --commit-dirty=true
