'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
function setup({ synth, info, blocked } = {}) {
  const timers = new Map(), spoken = [], events = [];
  let serial = 0;
  const window = {
    niuai: { ttsInfo: info || (async () => ({ available: true })),
      ttsVoices: async () => ({ ok: true, voices: [{ name: 'zh-test' }] }),
      ttsSynth: synth || (async () => ({ ok: true, audio: new ArrayBuffer(1), boundaries: [] })) },
    speechSynthesis: { getVoices: () => [], cancel() {}, speak(u) { spoken.push(u); u.onstart(); } },
  };
  class Audio {
    constructor() { this.duration = 0.1; }
    pause() {}
    play() {
      if (blocked) return Promise.reject(new Error('blocked'));
      queueMicrotask(() => { this.onloadedmetadata(); this.onended(); }); return Promise.resolve();
    }
  }
  const context = { window, console: { log() {} }, Blob, Audio, ArrayBuffer,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/js/speech.js'), 'utf8'), context);
  const speech = window.Speech;
  speech.on('end', () => events.push('end')); speech.on('error', () => events.push('error'));
  return { speech, spoken, events, run(ms) {
    for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); }
  } };
}
test('successful Edge audio completes normally', async () => {
  const h = setup(); await h.speech.speak('你好，今天做什么菜？');
  assert.deepEqual(h.events, ['end']); assert.equal(h.speech.isSpeaking(), false);
});
test('Edge synthesis failure waits for fallback system playback before ending', async () => {
  const h = setup({ synth: async () => ({ ok: false, error: 'offline' }) });
  await h.speech.speak('番茄炒蛋，少放盐。');
  assert.equal(h.speech.isSpeaking(), true); assert.deepEqual(h.events, []);
  h.run(30); assert.equal(h.spoken[0].text, '番茄炒蛋，少放盐。');
  h.spoken[0].onend(); assert.deepEqual(h.events, ['end']); assert.equal(h.speech.isSpeaking(), false);
});
test('failed prefetched chunk falls back instead of dropping remaining speech', async () => {
  let count = 0;
  const h = setup({ synth: async () => (++count === 1 ? { ok: true, audio: new ArrayBuffer(1) } : { ok: false, error: 'network' }) });
  await h.speech.speak('番茄'.repeat(45) + '。' + '鸡蛋'.repeat(45) + '。');
  assert.equal(h.speech.isSpeaking(), true); assert.deepEqual(h.events, []);
  h.run(30); assert.equal(h.spoken.length, 1); assert.match(h.spoken[0].text, /鸡蛋/);
  h.spoken[0].onend(); assert.deepEqual(h.events, ['end']);
});
test('cancelling during asynchronous engine detection cannot start stale playback', async () => {
  let resolve; let synthCalls = 0;
  const h = setup({ info: () => new Promise((r) => { resolve = r; }), synth: async () => { synthCalls++; } });
  const pending = h.speech.speak('不要播放'); h.speech.stop(); resolve({ available: true });
  await pending; assert.equal(synthCalls, 0); assert.equal(h.speech.isSpeaking(), false);
});
test('blocked audio emits an error so continuous listening can pause', async () => {
  const h = setup({ blocked: true }); await h.speech.speak('你好。');
  assert.deepEqual(h.events, ['error', 'end']); assert.equal(h.speech.isSpeaking(), false);
});
