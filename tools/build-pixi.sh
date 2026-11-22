#!/bin/sh
# 重新生成 js/vendor/pixi.js（只打包战场用到的 PixiJS 部分；含 unsafe-eval 补丁以兼容页面的 CSP，不需要 'unsafe-eval'）
# 用法：./tools/build-pixi.sh [pixi 版本，默认 8.23.0]；需要 Node.js
set -e
VER=${1:-8.23.0}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
cd "$TMP"
npm init -y >/dev/null
npm i "pixi.js@$VER" esbuild --silent
cat > entry.mjs <<'JS'
import 'pixi.js/unsafe-eval';
export { autoDetectRenderer, Container, Sprite, Graphics, Text, Texture, Rectangle, extensions } from 'pixi.js';
JS
npx esbuild entry.mjs --bundle --format=esm --minify --target=es2020 --legal-comments=eof --outfile="$ROOT/js/vendor/pixi.js"
rm -rf "$TMP"
echo "已生成 js/vendor/pixi.js（pixi.js@$VER）"
