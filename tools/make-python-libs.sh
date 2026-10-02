#!/usr/bin/env bash
# 生成 Edge TTS 依赖库目录（随应用打包；用系统 python3 + PYTHONPATH 运行）
# 依赖：python3 -m venv .venv && .venv/bin/pip install edge-tts
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -d .venv ]; then
  echo "==> 创建虚拟环境并安装 edge-tts"
  python3 -m venv .venv
  PIP_CACHE_DIR="$PWD/.pip-cache" ./.venv/bin/pip install --quiet edge-tts
fi
SRC=$(ls -d .venv/lib/python*/site-packages | head -1)
echo "==> 从 $SRC 生成 python-libs"
rm -rf python-libs
cp -R "$SRC" python-libs
find python-libs -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
find python-libs -name '*.pyc' -delete 2>/dev/null || true
echo "✅ python-libs 就绪（$(find python-libs -type f | wc -l | tr -d ' ') 个文件）"
