'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const DEFAULT_STT = {
  sttEndpoint: 'https://api.siliconflow.cn/v1/audio/transcriptions',
  sttModel: 'FunAudioLLM/SenseVoiceSmall', sttApiKey: '',
};
const MACOS_ENGINE = 'macos';
function speechConfig(settings = {}) {
  const raw = settings.sttEndpoint || DEFAULT_STT.sttEndpoint;
  if (raw === MACOS_ENGINE) {
    if (process.platform !== 'darwin') throw new Error('系统语音识别仅支持 macOS，请在设置中改用云端接口。');
    return { engine: MACOS_ENGINE };
  }
  const endpoint = new URL(raw);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) {
    throw new Error('语音接口必须使用 HTTPS；本机测试可使用 localhost HTTP。');
  }
  if (endpoint.username || endpoint.password) throw new Error('请在语音 API Key 栏填写密钥。');
  const key = String(settings.sttApiKey || '').trim();
  const model = String(settings.sttModel || DEFAULT_STT.sttModel).trim();
  if (!key) throw new Error('请先在设置 → 中文语音识别中填写语音 API Key。');
  if (!model || model.length > 200) throw new Error('请填写有效的语音模型名称。');
  return { engine: 'cloud', endpoint: endpoint.href, key, model };
}
function runHelper(app, args, { signal } = {}) {
  const bin = app.isPackaged
    ? path.join(process.resourcesPath, 'macos-speech')
    : path.join(__dirname, '..', 'native', 'macos-speech');
  if (!fs.existsSync(bin)) return Promise.reject(new Error('未找到系统识别组件，请重新安装应用。'));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const onAbort = () => child.kill('SIGKILL');
    if (signal) {
      if (signal.aborted) child.kill('SIGKILL');
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (signal && signal.aborted) { reject(new Error('aborted')); return; }
      try { resolve(JSON.parse(out.trim().split('\n').pop())); }
      catch (_) { reject(new Error(err.trim() || `系统语音识别输出异常（退出码 ${code}）。`)); }
    });
  });
}
function createNativeTranscribe(app) {
  return async (bytes, { signal } = {}) => {
    const tmp = path.join(os.tmpdir(), `mars-speech-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    fs.writeFileSync(tmp, bytes);
    try {
      const data = await runHelper(app, [tmp, 'zh-CN'], { signal });
      if (typeof data.text === 'string') return data.text;
      throw new Error(data.error || '系统语音识别失败，请重试。');
    } finally {
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
  };
}
function createNativePrepare(app) {
  return async ({ signal } = {}) => {
    const data = await runHelper(app, ['--prepare'], { signal });
    if (!data.authorized) throw new Error(data.error || '无法获取语音识别权限。');
  };
}
async function transcribe(audio, settings, { signal, fetchImpl = fetch, nativeImpl } = {}) {
  const conf = speechConfig(settings);
  if (!(audio instanceof ArrayBuffer) && !ArrayBuffer.isView(audio)) throw new Error('无效的录音数据。');
  const bytes = audio instanceof ArrayBuffer ? new Uint8Array(audio) : new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
  if (bytes.byteLength <= 44 || bytes.byteLength > 2 * 1024 * 1024) throw new Error('录音为空或超过单句大小限制，请缩短后重试。');
  const header = new DataView(bytes.buffer, bytes.byteOffset, 44);
  if (String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.slice(8, 12)) !== 'WAVE' ||
      header.getUint16(20, true) !== 1 || header.getUint16(22, true) !== 1 ||
      header.getUint32(24, true) !== 16000 || header.getUint16(34, true) !== 16) throw new Error('录音格式应为 16kHz 单声道 WAV。');
  let text;
  if (conf.engine === MACOS_ENGINE) {
    if (!nativeImpl) throw new Error('当前环境不支持系统语音识别。');
    text = await nativeImpl(bytes, { signal });
  } else {
    const form = new FormData();
    form.append('model', conf.model);
    form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'speech.wav');
    const response = await fetchImpl(conf.endpoint, {
      method: 'POST', headers: { Authorization: 'Bearer ' + conf.key }, body: form, signal, redirect: 'error',
    });
    if (!response.ok) {
      const messages = { 400: '录音或模型参数不被接口接受，请检查语音接口和模型。',
        401: '语音 API Key 无效或已过期。', 403: '当前账号无权调用此语音模型，请检查服务开通状态。',
        404: '语音接口或模型不存在，请检查设置。', 429: '免费语音接口达到限流或额度限制，请稍后重试。' };
      throw new Error(messages[response.status] || '语音服务暂不可用（HTTP ' + response.status + '），请稍后重试。');
    }
    const data = await response.json();
    if (typeof data.text !== 'string') throw new Error('语音接口没有返回 text 字段，请使用兼容的转写接口。');
    text = data.text;
  }
  return String(text).replace(/<\|[^|]*\|>/g, '').trim().slice(0, 10000);
}
function registerSpeech({ app, ipcMain, getWindow, getSettings, systemPreferences, fetchImpl = fetch, nativeImpl, nativePrepare }) {
  const nativeTranscribe = nativeImpl || createNativeTranscribe(app);
  const prepareNative = nativePrepare || createNativePrepare(app);
  const active = new Map();
  let prepareCtrl = null;
  const owns = (event) => {
    const win = getWindow();
    return win && !win.isDestroyed() && event.sender === win.webContents;
  };
  function abortPrepare() { if (prepareCtrl) { prepareCtrl.abort(); prepareCtrl = null; } }
  function cancel() { for (const ctrl of active.values()) ctrl.abort(); active.clear(); abortPrepare(); }
  ipcMain.handle('stt:info', () => {
    try { return { available: true, engine: speechConfig(getSettings()).engine }; }
    catch (_) { return { available: true, engine: 'cloud' }; }
  });
  ipcMain.handle('stt:prepare', async (event) => {
    if (!owns(event)) return { ok: false, error: '无效的语音请求。' };
    const ctrl = new AbortController();
    prepareCtrl = ctrl;
    try {
      const conf = speechConfig(getSettings());
      if (process.platform === 'darwin' && !await systemPreferences.askForMediaAccess('microphone')) {
        return { ok: false, error: '请在系统设置 → 隐私与安全性 → 麦克风中允许火星小厨房，并重启应用。' };
      }
      if (ctrl.signal.aborted) return { ok: false, error: '已取消语音准备。' };
      if (conf.engine === MACOS_ENGINE) {
        // 先触发语音识别授权框，避免首次识别在录音结束后才被权限流程打断。
        await prepareNative({ signal: ctrl.signal });
      }
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message === 'aborted' ? '已取消语音准备。' : e.message }; }
    finally { if (prepareCtrl === ctrl) prepareCtrl = null; }
  });
  ipcMain.handle('stt:transcribe', async (event, opts = {}) => {
    if (!owns(event) || !opts || typeof opts.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(opts.id)) return { ok: false, error: '无效的语音请求。' };
    cancel();
    const ctrl = new AbortController(); active.set(opts.id, ctrl);
    const timeout = setTimeout(() => ctrl.abort(new Error('timeout')), 60000);
    try {
      const text = await transcribe(opts.audio, getSettings(), { signal: ctrl.signal, fetchImpl, nativeImpl: nativeTranscribe });
      if (ctrl.signal.aborted) return { ok: false, cancelled: true };
      return { ok: true, text };
    } catch (e) {
      return { ok: false, cancelled: ctrl.signal.aborted && ctrl.signal.reason?.message !== 'timeout',
        error: ctrl.signal.aborted && ctrl.signal.reason?.message === 'timeout' ? '语音识别超时，请检查网络后重试。' :
          (e.message === 'fetch failed' ? '无法连接语音服务，请检查网络及接口地址。' : e.message) };
    } finally {
      clearTimeout(timeout);
      if (active.get(opts.id) === ctrl) active.delete(opts.id);
    }
  });
  ipcMain.handle('stt:cancel', (event, id) => {
    if (!owns(event)) return false;
    active.get(id)?.abort(); active.delete(id); abortPrepare(); return true;
  });
  app.on('before-quit', cancel);
  return { cancel };
}
module.exports = { DEFAULT_STT, speechConfig, transcribe, registerSpeech };
