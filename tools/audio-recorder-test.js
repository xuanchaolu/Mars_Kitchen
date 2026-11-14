'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create, encodeWav } = require('../renderer/js/audio-recorder');
test('WAV is 16kHz mono PCM and preserves clipping boundaries', () => {
  const wav = encodeWav([new Float32Array([-2, -1, 0, 1, 2])], 16000);
  const v = new DataView(wav);
  assert.equal(wav.byteLength, 54); assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(22, true), 1); assert.equal(v.getUint16(34, true), 16);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => v.getInt16(44 + i * 2, true)), [-32768, -32768, 0, 32767, 32767]);
});
test('44.1kHz and 48kHz captures resample to exactly one second of 16kHz WAV', () => {
  for (const rate of [44100, 48000]) {
    const data = new Float32Array(rate).fill(0.25);
    const wav = encodeWav([data.slice(0, 12345), data.slice(12345)], rate);
    assert.equal(wav.byteLength, 32044);
    assert.equal(new DataView(wav).getInt16(44, true), 8192);
  }
});
function fakeRecorder({ permission } = {}) {
  const calls = { stopped: 0, closed: 0, ready: 0, complete: [], errors: [] };
  let processor;
  const stream = { getTracks: () => [{ stop: () => calls.stopped++ }] };
  const devices = { getUserMedia: permission || (async () => stream) };
  class Context {
    constructor() { this.sampleRate = 48000; this.destination = {}; }
    resume() { return Promise.resolve(); }
    close() { calls.closed++; return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
    createScriptProcessor() { processor = { connect() {}, disconnect() {}, onaudioprocess: null }; return processor; }
  }
  const recorder = create({ mediaDevices: devices, AudioContext: Context,
    onReady: () => calls.ready++, onComplete: (wav) => calls.complete.push(wav), onError: (e) => calls.errors.push(e) });
  return { calls, recorder, stream, frame(level) {
    const samples = new Float32Array(4096).fill(level);
    processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } });
  } };
}
test('speech followed by silence produces one utterance and releases microphone', async () => {
  const h = fakeRecorder(); await h.recorder.start();
  for (let i = 0; i < 4; i++) h.frame(0.08);
  for (let i = 0; i < 24; i++) h.frame(0);
  assert.equal(h.calls.complete.length, 1); assert.ok(h.calls.complete[0] instanceof ArrayBuffer);
  assert.equal(h.calls.stopped, 1); assert.equal(h.calls.closed, 1); h.recorder.cancel();
});
test('silence produces no audio for upload', async () => {
  const h = fakeRecorder(); await h.recorder.start();
  for (let i = 0; i < 150; i++) h.frame(0);
  assert.deepEqual(h.calls.complete, [null]); h.recorder.cancel();
});
test('cancelling pending microphone permission releases late-arriving tracks', async () => {
  let resolve;
  const h = fakeRecorder({ permission: () => new Promise((r) => { resolve = r; }) });
  const pending = h.recorder.start(); h.recorder.cancel(); resolve(h.stream); await pending;
  assert.equal(h.calls.ready, 0); assert.equal(h.calls.stopped, 1); assert.deepEqual(h.calls.complete, []);
});
test('microphone permission rejection is a useful error', async () => {
  const h = fakeRecorder({ permission: async () => { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e; } });
  await h.recorder.start(); assert.match(h.calls.errors[0], /权限被拒绝/); h.recorder.cancel();
});
