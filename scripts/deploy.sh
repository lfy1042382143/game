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
# 角色图片素材（源图不上传，只传切好的透明 PNG）
if [ -d "$ROOT/assets/characters" ]; then
  mkdir -p "$DIST/assets/characters"
  cp "$ROOT/assets/characters/"*.png "$DIST/assets/characters/"
fi

# 静态资源文件名不带 hash，浏览器可能缓存旧代码。
# 这里给引用加内容指纹破缓存（每次部署都会变）。
# 静态资源文件名不带 hash，浏览器可能缓存旧代码。
# 这里给引用加内容指纹（每次部署都会变，线上缓存必刷新）。
# 注意：项目平时只保留根目录一份源码（本地直接打开根目录 index.html 游玩），
# dist/ 是部署时临时构建目录，部署完成后自动清理。
V=$(find "$DIST/js" "$DIST/css" -type f | sort | xargs cat | md5sum | cut -c1-8)
echo "==> 资源版本指纹: $V"
sed -i -E "s#(href=\"css/[^\"]+\.css)(\?v=[^\"]*)?#\1?v=$V#g; s#(src=\"js/[^\"]+\.js)(\?v=[^\"]*)?#\1?v=$V#g" "$DIST/index.html"
# 图片引用指纹写进 sprites.js，改图后线上也刷新缓存
if [ -f "$DIST/js/render/sprites.js" ]; then
  sed -i -E "s#version = '';#version = '$V';#" "$DIST/js/render/sprites.js"
fi

echo "==> 产物清单"
find "$DIST" -type f | sed "s|$DIST/||" | sort

echo "==> 部署到 Cloudflare Workers"
cd "$ROOT"
npx wrangler deploy

# 部署完成：清理临时构建目录，项目内始终只有根目录一份源码
echo "==> 清理临时构建目录 dist/"
rm -rf "$DIST"
