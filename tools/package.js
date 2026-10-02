/* 打包脚本：调用 electron-packager API（可指定下载缓存到工作区，避开系统缓存目录） */
const packager = require('electron-packager');
const path = require('path');

const ROOT = path.join(__dirname, '..');

packager({
  dir: ROOT,
  name: '火星小厨房',
  platform: 'darwin',
  arch: 'arm64',
  out: path.join(ROOT, 'dist'),
  overwrite: true,
  asar: true,
  icon: path.join(ROOT, 'build', 'AppIcon.icns'),
  appBundleId: 'com.marskitchen.app',
  appCategoryType: 'public.app-category.productivity',
  appVersion: '5.0.0',
  buildVersion: '1',
  electronVersion: '33.4.11',
  // 自带 Edge TTS 依赖库（纯 Python 包，约 20MB；用系统 python3 + PYTHONPATH 运行，
  // 不打包解释器/符号链接，避免破坏代码签名封条）
  // 人设档案 mars_profile 随包分发到 Contents/Resources/mars_profile（首次启动播种到用户目录）
  extraResource: [path.join(ROOT, 'python-libs'), path.join(ROOT, 'mars_profile')],
  prune: true,
  download: { cacheRoot: path.join(ROOT, '.electron-cache') },
  ignore: [
    /^\/\.(build-cache|npm-cache|electron-cache|downloads|git)\b/,
    /^\/build\b/,
    /^\/dist\b/,
    /^\/README\.md$/,
    /^\/src\b/,
    /^\/[^/]*\.vrm$/,
    /^\/mars_profile($|\/)/,
    /^\/\.venv\b/,
    /^\/python-libs\b/,
    /^\/\.pip-cache\b/,
  ],
})
  .then((appPaths) => {
    console.log('PACKAGED:');
    appPaths.forEach((p) => console.log('  ' + p));
  })
  .catch((err) => {
    console.error('PACKAGE_ERROR', err);
    process.exit(1);
  });
