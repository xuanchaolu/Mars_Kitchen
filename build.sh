#!/bin/bash
# 火星小厨房（Mars Kitchen）macOS 应用构建脚本
set -e
cd "$(dirname "$0")"

# 把临时目录与下载缓存重定向到可写位置（electron-packager 的暂存目录不能在项目内部）
export TMPDIR="${TMPDIR:-/tmp}"
mkdir -p "$TMPDIR"
export electron_config_cache="$PWD/.electron-cache"

echo "==> [1/5] 生成应用图标"
python3 tools/gen-icon.py
/usr/bin/iconutil -c icns build/AppIcon.iconset -o build/AppIcon.icns
echo "    icns: $(ls -la build/AppIcon.icns | awk '{print $5}') bytes"

# Edge TTS 依赖库（不存在则生成）
if [ ! -d python-libs ]; then
  bash tools/make-python-libs.sh
fi

echo "==> [2/5] 打包 .app (electron-packager)"
rm -rf dist
node tools/package.js

APP="$(find dist -maxdepth 2 -name '*.app' -type d | head -1)"
echo "==> [3/5] 完善元数据: $APP"
/usr/libexec/PlistBuddy -c "Set :CFBundleName 火星小厨房" "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName 火星小厨房" "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.marskitchen.app" "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :LSMinimumSystemVersion 12.0" "$APP/Contents/Info.plist" 2>/dev/null || true

echo "==> [4/5] 代码签名 (ad-hoc)"
codesign --force --deep --sign - "$APP"

echo "==> [5/5] 完成"
echo "✅ $APP"
du -sh "$APP" | awk '{print "   大小: "$1}'
