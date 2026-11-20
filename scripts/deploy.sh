#!/usr/bin/env bash
# 构建 dist/ 并部署到 Cloudflare Workers（静态资源 Worker，与 mailhub 同类型）
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

# 静态资源文件名不带 hash，浏览器可能缓存旧代码。
# 这里给引用加内容指纹破缓存（每次部署都会变）。
# 源码 index.html 已带本地破缓存指纹（?v=916，每次开发改动手动递增），
# 这里替换为内容指纹（每次部署都会变，线上缓存必刷新）。
V=$(find "$DIST/js" "$DIST/css" -type f | sort | xargs cat | md5sum | cut -c1-8)
echo "==> 资源版本指纹: $V"
sed -i -E "s#(href=\"css/[^\"]+\.css)(\?v=[^\"]*)?#\1?v=$V#g; s#(src=\"js/[^\"]+\.js)(\?v=[^\"]*)?#\1?v=$V#g" "$DIST/index.html"

echo "==> 产物清单"
find "$DIST" -type f | sed "s|$DIST/||" | sort

echo "==> 部署到 Cloudflare Workers"
cd "$ROOT"
npx wrangler deploy
