#!/bin/sh
# 部署前运行：给 CSS/JS 引用加上内容哈希版本号，避免浏览器缓存旧文件
# 兼容 macOS（BSD sed）和 Linux（GNU sed）
cd "$(dirname "$0")"
if command -v sha1sum >/dev/null 2>&1; then SHA=sha1sum; else SHA="shasum -a 1"; fi
if sed --version >/dev/null 2>&1; then SEDI="sed -i"; else SEDI="sed -i ''"; fi
V=$(sed -E 's/\?v=[A-Za-z0-9]+//g' index.html style.css js/*.js | $SHA | cut -c1-8)
eval "$SEDI -E 's/(style\.css|app\.js)\?v=[A-Za-z0-9]+/\1?v=$V/g' index.html"
for f in js/*.js; do eval "$SEDI -E 's/([a-z0-9]+\.js)\?v=[A-Za-z0-9]+/\1?v=$V/g' \"$f\""; done
echo "version $V"
