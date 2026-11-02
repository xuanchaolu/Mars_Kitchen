'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../renderer/js/cloud-voice');
const { create: createTurn } = require('../renderer/js/voice-input');
function setup({ prepare, transcribe, pendingStart } = {}) {
  const calls = { uploads: [], cancelled: [], stopped: 0 }, events = [];
  let recorder;
  const api = {
    sttPrepare: prepare || (async () => ({ ok: true })),
    sttCancel: async (id) => calls.cancelled.push(id),
    sttTranscribe: async (opts) => { calls.uploads.push(opts); return transcribe ? transcribe(opts) : { ok: true, text: '番茄炒蛋怎么做？' }; },
  };
  const bridge = create(api, { mediaDevices: { getUserMedia() {} }, AudioContext: class {},
    recorderAPI: { create(opts) {
      recorder = { opts, start: async () => { if (pendingStart) await pendingStart; opts.onReady(); },
        finish: () => opts.onComplete(new ArrayBuffer(100)), cancel: () => calls.stopped++ };
      return recorder;
    } } });
  bridge.onSttEvent((e) => events.push(e));
  return { bridge, calls, events, recorder: () => recorder };
}
test('capture ends before upload; Chinese result has original request ID', async () => {
  const h = setup(); await h.bridge.sttStart('voice-1');
  assert.equal(h.events[0].type, 'listening'); assert.equal(h.calls.uploads.length, 0);
  await h.bridge.sttStop({ id: 'voice-1', cancel: false }); await new Promise(setImmediate);
  assert.equal(h.calls.uploads.length, 1);
  assert.deepEqual(h.events.map((e) => e.type), ['listening', 'transcribing', 'final']);
  assert.equal(h.events[2].id, 'voice-1'); assert.equal(h.events[2].text, '番茄炒蛋怎么做？'); h.bridge.dispose();
});
test('cancellation during recording sends no audio', async () => {
  const h = setup(); await h.bridge.sttStart('voice-1');
  const old = h.recorder(); await h.bridge.sttStop({ id: 'voice-1', cancel: true });
  await old.opts.onComplete(new ArrayBuffer(100));
  assert.equal(h.calls.uploads.length, 0); assert.equal(h.calls.stopped, 1); h.bridge.dispose();
});
test('cancelled in-flight API result never reaches the voice controller', async () => {
  let resolve;
  const h = setup({ transcribe: () => new Promise((r) => { resolve = r; }) });
  await h.bridge.sttStart('voice-1'); h.recorder().finish();
  await h.bridge.sttStop({ id: 'voice-1', cancel: true }); resolve({ ok: true, text: '过期结果' });
  await new Promise(setImmediate);
  assert.equal(h.events.some((e) => e.type === 'final'), false); h.bridge.dispose();
});
test('empty audio and failed preparation do not invoke transcription', async () => {
  const h = setup(); await h.bridge.sttStart('voice-1'); await h.recorder().opts.onComplete(null);
  assert.equal(h.calls.uploads.length, 0); assert.equal(h.events.at(-1).text, ''); h.bridge.dispose();
  const failed = setup({ prepare: async () => ({ ok: false, error: 'Key 无效' }) });
  assert.equal((await failed.bridge.sttStart('voice-2')).ok, false);
  assert.equal(failed.recorder(), undefined); failed.bridge.dispose();
});
test('permission start cancelled before resolution cannot open a recorder', async () => {
  let resolve;
  const h = setup({ prepare: () => new Promise((r) => { resolve = r; }) });
  const pending = h.bridge.sttStart('voice-1'); await h.bridge.sttStop({ id: 'voice-1', cancel: true });
  resolve({ ok: true }); await pending;
  assert.equal(h.recorder(), undefined); h.bridge.dispose();
});
test('capture to transcription to dialog is wired; cloud upload state can be cancelled', async () => {
  const h = setup(); const sent = [];
  const turn = createTurn({ bridge: h.bridge,
    context: () => ({ convId: 'chat-1', hasKey: true, hasSpeechKey: true, hasDraft: false, busy: false }),
    update() {}, error: (e) => { throw new Error(e); }, stopSpeaking() {}, isSpeaking: () => false,
    submit: (text) => sent.push(text), repeat: () => false });
  turn.toggleMic(); await new Promise(setImmediate); h.recorder().finish(); await new Promise(setImmediate);
  assert.deepEqual(sent, ['番茄炒蛋怎么做？']); assert.equal(turn.state().phase, 'thinking');
  turn.dispose(); h.bridge.dispose();
});
