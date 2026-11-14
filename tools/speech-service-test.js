'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { EventEmitter } = require('events');
const { DEFAULT_STT, speechConfig, transcribe, registerSpeech } = require('../lib/speech-service');
const { encodeWav } = require('../renderer/js/audio-recorder');
const config = { ...DEFAULT_STT, sttApiKey: 'test-only-key' };
const audio = () => encodeWav([new Float32Array(4800).fill(0.1)], 16000);

test('default is the free SenseVoice endpoint; credentials must be supplied independently', () => {
  assert.match(DEFAULT_STT.sttEndpoint, /^https:\/\/api.siliconflow.cn/);
  assert.equal(DEFAULT_STT.sttModel, 'FunAudioLLM/SenseVoiceSmall');
  assert.throws(() => speechConfig({ apiKey: 'chat-key' }), /语音 API Key/);
  assert.throws(() => speechConfig({ ...config, sttEndpoint: 'http://example.com/asr' }), /HTTPS/);
  assert.throws(() => speechConfig({ ...config, sttEndpoint: 'https://user:secret@example.com' }), /密钥/);
});
test('real local HTTP round trip sends WAV multipart/model and returns Chinese text', async (t) => {
  let received;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received = { body: Buffer.concat(chunks), auth: req.headers.authorization, type: req.headers['content-type'] };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ text: '<|zh|><|NEUTRAL|>番茄炒蛋，少放盐。' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const text = await transcribe(audio(), { ...config, sttEndpoint: `http://127.0.0.1:${server.address().port}/v1/audio/transcriptions` });
  assert.equal(text, '番茄炒蛋，少放盐。');
  assert.equal(received.auth, 'Bearer test-only-key');
  assert.match(received.type, /multipart\/form-data; boundary=/);
  assert.ok(received.body.includes(Buffer.from('name="file"; filename="speech.wav"')));
  assert.ok(received.body.includes(Buffer.from(config.sttModel)));
  assert.ok(received.body.includes(Buffer.from('RIFF')));
});
test('invalid and oversized audio never reaches the provider', async () => {
  let requests = 0;
  const options = { fetchImpl: async () => { requests++; } };
  for (const value of [null, new ArrayBuffer(44), new ArrayBuffer(3 * 1024 * 1024), new Uint8Array(100)]) {
    await assert.rejects(transcribe(value, config, options));
  }
  assert.equal(requests, 0);
});
test('authentication, model, quota and service errors have actionable messages', async () => {
  for (const [status, pattern] of [[401, /Key/], [403, /无权/], [404, /不存在/], [429, /限流/], [503, /503/]]) {
    await assert.rejects(transcribe(audio(), config, { fetchImpl: async () => new Response('', { status }) }), pattern);
  }
  await assert.rejects(transcribe(audio(), config, { fetchImpl: async () => Response.json({ result: 'wrong contract' }) }), /text/);
});
function ipcSetup(fetchImpl) {
  const app = new EventEmitter(), handlers = {}, sender = {};
  const service = registerSpeech({ app, ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    getWindow: () => ({ isDestroyed: () => false, webContents: sender }), getSettings: () => config,
    systemPreferences: { askForMediaAccess: async () => true }, fetchImpl });
  return { handlers, event: { sender }, service, app };
}
test('IPC rejects other renderers and invalid IDs', async () => {
  const h = ipcSetup(async () => { throw new Error('must not fetch'); });
  assert.equal((await h.handlers['stt:prepare']({ sender: {} })).ok, false);
  assert.equal((await h.handlers['stt:transcribe']({ sender: {} }, { id: 'voice-1', audio: audio() })).ok, false);
  assert.equal((await h.handlers['stt:transcribe'](h.event, { id: '../bad', audio: audio() })).ok, false);
  h.service.cancel();
});
test('cancelling an upload aborts the fetch and suppresses its final result', async () => {
  let signal;
  const h = ipcSetup(async (_url, opts) => {
    signal = opts.signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  });
  const pending = h.handlers['stt:transcribe'](h.event, { id: 'voice-1', audio: audio() });
  h.handlers['stt:cancel'](h.event, 'voice-1');
  const result = await pending;
  assert.equal(signal.aborted, true); assert.equal(result.cancelled, true); assert.equal(result.ok, false);
  h.service.cancel();
});
test('new upload cancels old work; successful latest result remains independent', async () => {
  let firstSignal, n = 0;
  const h = ipcSetup(async (_url, opts) => {
    n++;
    if (n === 2) return Response.json({ text: '当前结果' });
    firstSignal = opts.signal;
    return new Promise((_resolve, reject) => firstSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  });
  const first = h.handlers['stt:transcribe'](h.event, { id: 'voice-1', audio: audio() });
  const second = h.handlers['stt:transcribe'](h.event, { id: 'voice-2', audio: audio() });
  assert.equal((await first).cancelled, true); assert.equal((await second).text, '当前结果'); h.service.cancel();
});
test('macos engine needs no key and transcribes through the native helper', async (t) => {
  if (process.platform !== 'darwin') return t.skip('macOS only');
  const conf = speechConfig({ sttEndpoint: 'macos' });
  assert.equal(conf.engine, 'macos');
  let received;
  const text = await transcribe(audio(), { sttEndpoint: 'macos' }, {
    nativeImpl: async (bytes, opts) => { received = { bytes, signal: opts.signal }; return '<|zh|>番茄炒蛋，少放盐。'; },
  });
  assert.equal(text, '番茄炒蛋，少放盐。');
  assert.ok(received.bytes.byteLength > 44);
  await assert.rejects(transcribe(new ArrayBuffer(44), { sttEndpoint: 'macos' }, { nativeImpl: async () => 'x' }), /录音/);
  await assert.rejects(transcribe(audio(), { sttEndpoint: 'macos' }), /不支持/);
});
test('macos engine IPC round trip and cancellation use the injected helper', async (t) => {
  if (process.platform !== 'darwin') return t.skip('macOS only');
  const app = new EventEmitter(), handlers = {}, sender = {};
  let signal, prepared = 0;
  const service = registerSpeech({ app, ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    getWindow: () => ({ isDestroyed: () => false, webContents: sender }),
    getSettings: () => ({ sttEndpoint: 'macos' }),
    systemPreferences: { askForMediaAccess: async () => true },
    nativePrepare: async () => { prepared++; },
    nativeImpl: async (_bytes, opts) => {
      signal = opts.signal;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        setTimeout(() => resolve('本机识别结果'), 5);
      });
    } });
  const event = { sender };
  assert.equal((await handlers['stt:info']()).engine, 'macos');
  assert.equal((await handlers['stt:prepare'](event)).ok, true);
  assert.equal(prepared, 1);
  const ok = await handlers['stt:transcribe'](event, { id: 'voice-1', audio: audio() });
  assert.equal(ok.text, '本机识别结果');
  const pending = handlers['stt:transcribe'](event, { id: 'voice-2', audio: audio() });
  handlers['stt:cancel'](event, 'voice-2');
  const cancelled = await pending;
  assert.equal(cancelled.ok, false); assert.equal(cancelled.cancelled, true); assert.equal(signal.aborted, true);
  service.cancel();
});
test('macos prepare pre-authorizes, surfaces denial, and is cancellable', async (t) => {
  if (process.platform !== 'darwin') return t.skip('macOS only');
  const setup = (nativePrepare, settings = { sttEndpoint: 'macos' }) => {
    const app = new EventEmitter(), handlers = {}, sender = {};
    const service = registerSpeech({ app, ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
      getWindow: () => ({ isDestroyed: () => false, webContents: sender }),
      getSettings: () => settings, systemPreferences: { askForMediaAccess: async () => true },
      nativePrepare, nativeImpl: async () => 'x' });
    return { handlers, event: { sender }, service };
  };
  const denied = setup(async () => { throw new Error('语音识别权限被拒绝'); });
  const result = await denied.handlers['stt:prepare'](denied.event);
  assert.equal(result.ok, false); assert.match(result.error, /权限被拒绝/);
  denied.service.cancel();
  let cloudCalls = 0;
  const cloud = setup(async () => { cloudCalls++; }, { sttEndpoint: 'https://example.com/asr', sttApiKey: 'k' });
  assert.equal((await cloud.handlers['stt:prepare'](cloud.event)).ok, true);
  assert.equal(cloudCalls, 0);
  cloud.service.cancel();
  let prepareSignal;
  const slow = setup(({ signal }) => new Promise((_resolve, reject) => {
    prepareSignal = signal;
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  const pending = slow.handlers['stt:prepare'](slow.event);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(prepareSignal, 'prepare should reach the authorization wait');
  slow.handlers['stt:cancel'](slow.event, 'voice-1');
  const cancelled = await pending;
  assert.equal(prepareSignal.aborted, true); assert.equal(cancelled.ok, false);
  slow.service.cancel();
});
