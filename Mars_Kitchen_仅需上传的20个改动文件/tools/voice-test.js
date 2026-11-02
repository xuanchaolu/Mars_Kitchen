'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../renderer/js/voice-input');
function setup(overrides = {}) {
  const ctx = { convId: 'chat-a', busy: false, hasKey: true, hasDraft: false };
  const calls = { starts: [], stops: [], sends: [], errors: [], repeats: 0, speakingStops: 0 };
  let callback, speaking = false;
  const options = {
    bridge: {
      sttStart: async (id) => { calls.starts.push(id); return { ok: true }; },
      sttStop: async (value) => calls.stops.push(value),
      onSttEvent: (cb) => { callback = cb; return () => { callback = null; }; },
    },
    context: () => ctx,
    update: (value) => { calls.ui = value; },
    error: (message) => calls.errors.push(message),
    stopSpeaking: () => { speaking = false; calls.speakingStops++; },
    isSpeaking: () => speaking,
    submit: (text) => { calls.sends.push(text); ctx.busy = true; },
    repeat: () => { calls.repeats++; speaking = true; return true; },
    ...overrides,
  };
  const voice = create(options);
  return { voice, ctx, calls, event: (type, extra = {}) => callback({ id: voice.state().requestId, type, ...extra }),
    raw: (payload) => callback(payload), speak: () => { speaking = true; }, silent: () => { speaking = false; } };
}
const tick = () => new Promise((r) => setTimeout(r, 710));

test('partial Chinese text is previewed; final is submitted exactly once', async () => {
  const h = setup(); h.voice.toggleMic(); await Promise.resolve();
  const id = h.voice.state().requestId;
  h.event('listening'); h.event('partial', { text: '番茄炒蛋' });
  assert.equal(h.calls.ui.transcript, '番茄炒蛋'); assert.deepEqual(h.calls.sends, []);
  h.event('final', { text: '番茄炒蛋怎么做？' });
  h.raw({ id, type: 'final', text: '番茄炒蛋怎么做？' });
  assert.deepEqual(h.calls.sends, ['番茄炒蛋怎么做？']);
  assert.equal(h.voice.ownsTurn(), true); h.voice.dispose();
});
test('continuous mode waits for response and playback before opening microphone again', async () => {
  const h = setup(); h.voice.toggleContinuous(); await Promise.resolve();
  h.event('final', { text: '少放盐怎么做' }); h.speak();
  h.ctx.busy = false; h.voice.responseDone(false);
  await tick(); assert.equal(h.calls.starts.length, 1);
  assert.equal(h.voice.state().phase, 'speaking');
  h.silent(); h.voice.playbackEnded(); await tick();
  assert.equal(h.calls.starts.length, 2); assert.equal(h.voice.state().continuous, true);
  h.voice.dispose();
});
test('switching conversations discards late recognition events', () => {
  const h = setup(); h.voice.toggleMic(); const id = h.voice.state().requestId;
  h.ctx.convId = 'chat-b'; h.raw({ id, type: 'final', text: '不要放辣椒' });
  assert.deepEqual(h.calls.sends, []); assert.equal(h.voice.state().phase, 'idle'); h.voice.dispose();
});
test('cancel discards in-flight results and pending restarts', async () => {
  const h = setup(); h.voice.toggleContinuous(); const id = h.voice.state().requestId;
  h.voice.cancel(); h.raw({ id, type: 'final', text: '做菜' }); await tick();
  assert.deepEqual(h.calls.sends, []); assert.equal(h.calls.starts.length, 1);
  assert.equal(h.calls.stops[0].cancel, true); h.voice.dispose();
});
test('second microphone click finalizes the current utterance', () => {
  const h = setup(); h.voice.toggleMic(); h.event('listening'); h.voice.toggleMic();
  assert.equal(h.calls.stops[0].cancel, false); assert.equal(h.voice.state().phase, 'finishing'); h.voice.dispose();
});
test('empty recognition ends continuous mode instead of looping', async () => {
  const h = setup(); h.voice.toggleContinuous(); h.event('final', { text: '' }); await tick();
  assert.equal(h.calls.starts.length, 1); assert.equal(h.voice.state().continuous, false); h.voice.dispose();
});
test('repeat and end commands are handled without sending to the model', () => {
  const h = setup(); h.voice.toggleContinuous(); h.event('final', { text: '再说一遍。' });
  assert.equal(h.calls.repeats, 1); assert.deepEqual(h.calls.sends, []);
  h.voice.toggleMic(); h.event('final', { text: '结束对话。' });
  assert.equal(h.voice.state().continuous, false); assert.deepEqual(h.calls.sends, []); h.voice.dispose();
});
test('draft, missing API key and active generation prevent recording', () => {
  for (const [key, value] of [['hasDraft', true], ['hasKey', false], ['hasSpeechKey', false], ['busy', true]]) {
    const h = setup(); h.ctx[key] = value; h.voice.toggleContinuous();
    assert.equal(h.calls.starts.length, 0); assert.equal(h.calls.errors.length, 1);
    assert.equal(h.voice.state().continuous, false); h.voice.dispose();
  }
});
test('permissions and model errors end continuous mode without automatic retries', () => {
  const h = setup(); h.voice.toggleContinuous(); h.event('error', { error: '麦克风权限被拒绝' });
  assert.equal(h.calls.errors[0], '麦克风权限被拒绝'); assert.equal(h.voice.state().continuous, false);
  h.voice.toggleContinuous(); h.event('final', { text: '下一步' }); h.ctx.busy = false; h.voice.responseDone(true);
  assert.equal(h.voice.state().continuous, false); h.voice.dispose();
});
test('start failure and a cancelled start promise never revive a session', async () => {
  const h = setup({ bridge: { onSttEvent: () => () => {}, sttStart: async () => ({ ok: false, error: '组件缺失' }), sttStop: async () => {} } });
  h.voice.toggleContinuous(); await Promise.resolve();
  assert.equal(h.calls.errors[0], '组件缺失'); assert.equal(h.voice.state().continuous, false); h.voice.dispose();
});
