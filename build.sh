#!/bin/bash
# 火星小厨房（Mars Kitchen）macOS 应用构建脚本
set -e
cd "$(dirname "$0")"

# 把临时目录与下载缓存重定向到可写位置（electron-packager 的暂存目录不能在项目内部）
export TMPDIR="${TMPDIR:-/tmp}"
mkdir -p "$TMPDIR"
export electron_config_cache="$PWD/.electron-cache"

echo "==> [1/6] 应用图标"
if [ -f build/AppIcon.icns ]; then
  echo "    使用随附图标 build/AppIcon.icns（如需重生成，放入源图后删除该文件再构建）"
else
  python3 tools/gen-icon.py
  /usr/bin/iconutil -c icns build/AppIcon.iconset -o build/AppIcon.icns
fi
echo "    icns: $(ls -la build/AppIcon.icns | awk '{print $5}') bytes"

echo "==> [2/6] Edge TTS 依赖库"
if [ ! -d python-libs ]; then
  bash tools/make-python-libs.sh
else
  echo "    已存在 python-libs/"
fi

echo "==> [3/6] 系统语音识别组件"
if command -v clang >/dev/null; then
  clang -fobjc-arc -O2 -mmacosx-version-min=12.0 -framework Speech -framework Foundation \
    -Wl,-sectcreate,__TEXT,__info_plist,native/Info.plist native/macos-speech.m -o native/macos-speech
  echo "    native/macos-speech 编译完成"
else
  echo "    未找到 clang，跳过编译（系统语音识别需要该组件，请安装 Xcode Command Line Tools）"
fi

echo "==> [4/6] 打包 .app (electron-packager)"
rm -rf dist
node tools/package.js

APP="$(find dist -maxdepth 2 -name '*.app' -type d | head -1)"
echo "==> [5/6] 完善元数据: $APP"
/usr/libexec/PlistBuddy -c "Set :CFBundleName 火星小厨房" "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName 火星小厨房" "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.marskitchen.app" "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :LSMinimumSystemVersion 12.0" "$APP/Contents/Info.plist" 2>/dev/null || true

echo "==> [6/6] 代码签名 (ad-hoc)"
codesign --force --deep --sign - "$APP"

echo "✅ $APP"
du -sh "$APP" | awk '{print "   大小: "$1}'