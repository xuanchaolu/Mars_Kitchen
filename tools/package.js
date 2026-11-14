/* 打包脚本：调用 electron-packager API（可指定下载缓存到工作区，避开系统缓存目录） */
const packager = require('electron-packager');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const platform = process.argv[2] || process.platform;
const arch = process.argv[3] || process.arch;
if (!['darwin', 'win32', 'linux'].includes(platform) || !['arm64', 'x64'].includes(arch)) throw new Error('请选择 darwin/win32/linux 与 arm64/x64');
const resources = [path.join(ROOT, 'mars_profile')];
if (platform === process.platform && arch === process.arch && fs.existsSync(path.join(ROOT, 'python-libs'))) resources.push(path.join(ROOT, 'python-libs'));
if (platform === 'darwin' && fs.existsSync(path.join(ROOT, 'native', 'macos-speech'))) resources.push(path.join(ROOT, 'native', 'macos-speech'));

packager({
  dir: ROOT,
  name: '火星小厨房',
  platform,
  arch,
  out: path.join(ROOT, 'dist'),
  overwrite: true,
  asar: true,
  icon: platform === 'darwin' ? path.join(ROOT, 'build', 'AppIcon.icns') : undefined,
  appBundleId: 'com.marskitchen.app',
  appCategoryType: 'public.app-category.productivity',
  appVersion: '5.1.0',
  buildVersion: '1',
  extendInfo: {
    NSMicrophoneUsageDescription: '录制中文语音指令，与火星小厨房对话。',
    NSSpeechRecognitionUsageDescription: '使用 macOS 系统语音识别把你的中文语音指令转为文字，优先在本机离线完成。',
  },
  electronVersion: '33.4.11',
  // 自带 Edge TTS 依赖库（纯 Python 包，约 20MB；用系统 python3 + PYTHONPATH 运行，
  // 不打包解释器/符号链接，避免破坏代码签名封条）
  // 人设档案 mars_profile 随包分发到 Contents/Resources/mars_profile（首次启动播种到用户目录）
  extraResource: resources,
  prune: true,
  download: { cacheRoot: path.join(ROOT, '.electron-cache') },
  ignore: [
    /^\/\.(build-cache|npm-cache|electron-cache|downloads|git)\b/,
    /^\/build\b/,
    /^\/dist\b/,
    /^\/README\.md$/,
    /^\/src\b/,
    /^\/native\b/,
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
