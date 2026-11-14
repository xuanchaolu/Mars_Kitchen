/* Adapter from cross-platform microphone capture to the voice-turn controller. */
(function (root) {
  'use strict';
  function create(api, { recorderAPI = root.AudioRecorder, mediaDevices = root.navigator?.mediaDevices,
    AudioContext = root.AudioContext || root.webkitAudioContext } = {}) {
    const listeners = new Set();
    let active = null;
    const emit = (id, payload) => listeners.forEach((fn) => fn({ ...payload, id }));
    function cancel() {
      if (!active) return;
      const r = active; active = null;
      if (r.recorder) r.recorder.cancel();
      Promise.resolve(api.sttCancel(r.id)).catch(() => {});
    }
    return {
      sttInfo: async () => ({ available: !!(mediaDevices?.getUserMedia && AudioContext),
        reason: '当前环境无法录音，请使用桌面应用并检查麦克风。' }),
      onSttEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      async sttStart(id) {
        cancel();
        const r = { id }; active = r;
        try {
          const prepared = await api.sttPrepare();
          if (active !== r) return { ok: false, cancelled: true };
          if (!prepared?.ok) { active = null; return prepared || { ok: false, error: '无法启动录音。' }; }
          r.recorder = recorderAPI.create({ mediaDevices, AudioContext,
            onReady: () => { if (active === r) emit(id, { type: 'listening' }); },
            onError: (error) => { if (active === r) { active = null; emit(id, { type: 'error', error }); } },
            onComplete: async (audio) => {
              if (active !== r) return;
              if (!audio) { active = null; emit(id, { type: 'final', text: '' }); return; }
              emit(id, { type: 'transcribing' });
              try {
                const result = await api.sttTranscribe({ id, audio });
                if (active !== r) return;
                active = null;
                if (result?.ok) emit(id, { type: 'final', text: result.text });
                else if (result?.cancelled) emit(id, { type: 'cancelled' });
                else emit(id, { type: 'error', error: result?.error || '语音识别失败。' });
              } catch (e) {
                if (active !== r) return;
                active = null; emit(id, { type: 'error', error: e.message || '无法连接语音服务。' });
              }
            },
          });
          await r.recorder.start();
          return { ok: true };
        } catch (e) {
          if (active !== r) return { ok: false, cancelled: true };
          cancel(); return { ok: false, error: e.message || '无法启动麦克风。' };
        }
      },
      async sttStop({ id, cancel: discard = true }) {
        if (!active || active.id !== id) return false;
        if (discard) cancel(); else active.recorder?.finish();
        return true;
      },
      dispose() { cancel(); listeners.clear(); },
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { create };
  else root.CloudVoice = { create };
})(typeof window !== 'undefined' ? window : globalThis);
