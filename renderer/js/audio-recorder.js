/* Cross-platform microphone capture and PCM WAV encoding. No network access here. */
(function (root) {
  'use strict';
  function encodeWav(chunks, inputRate) {
    if (!Number.isFinite(inputRate) || inputRate < 8000 || inputRate > 192000) throw new Error('无效的录音采样率。');
    const length = chunks.reduce((n, c) => n + c.length, 0);
    const input = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
    const rate = 16000, size = Math.floor(length * rate / inputRate);
    const buffer = new ArrayBuffer(44 + size * 2), view = new DataView(buffer);
    const text = (at, s) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, 36 + size * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, size * 2, true);
    // Average each resampling interval to reduce aliasing when downsampling.
    for (let i = 0; i < size; i++) {
      const start = i * inputRate / rate, end = Math.min(length, (i + 1) * inputRate / rate);
      let total = 0;
      for (let j = Math.floor(start); j < Math.ceil(end); j++) {
        total += input[Math.min(j, length - 1)] * (Math.min(j + 1, end) - Math.max(j, start));
      }
      const value = Math.max(-1, Math.min(1, total / (end - start)));
      view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    return buffer;
  }
  function create({ mediaDevices, AudioContext, onReady, onComplete, onError }) {
    let run = null;
    function release(r) {
      clearInterval(r.timer);
      if (r.processor) { r.processor.onaudioprocess = null; r.processor.disconnect(); }
      if (r.source) r.source.disconnect();
      if (r.gain) r.gain.disconnect();
      if (r.stream) r.stream.getTracks().forEach((track) => track.stop());
      if (r.context) r.context.close().catch(() => {});
    }
    function cancel() { const r = run; run = null; if (r) release(r); }
    function finish() {
      const r = run;
      if (!r || !r.context) return;
      run = null;
      release(r);
      try { onComplete(r.speechMs >= 180 ? encodeWav(r.chunks, r.context.sampleRate) : null); }
      catch (e) { onError(e.message); }
    }
    async function start() {
      cancel();
      const r = { chunks: [], speechMs: 0, elapsed: 0, lastSpeech: 0 };
      run = r;
      try {
        r.stream = await mediaDevices.getUserMedia({ video: false, audio: {
          channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
        } });
        if (run !== r) { release(r); return; }
        r.context = new AudioContext();
        await r.context.resume();
        if (run !== r) { release(r); return; }
        r.source = r.context.createMediaStreamSource(r.stream);
        // ScriptProcessor is available in the project's Electron baseline on all desktop platforms.
        r.processor = r.context.createScriptProcessor(4096, 1, 1);
        r.gain = r.context.createGain(); r.gain.gain.value = 0;
        r.processor.onaudioprocess = (event) => {
          if (run !== r) return;
          const samples = event.inputBuffer.getChannelData(0);
          r.chunks.push(new Float32Array(samples));
          const ms = samples.length / r.context.sampleRate * 1000;
          r.elapsed += ms;
          let sum = 0; for (const sample of samples) sum += sample * sample;
          if (Math.sqrt(sum / samples.length) >= 0.015) { r.speechMs += ms; r.lastSpeech = r.elapsed; }
          if (r.elapsed >= 45000 || (r.speechMs >= 180 && r.elapsed - r.lastSpeech >= 1800) || (!r.speechMs && r.elapsed >= 12000)) finish();
        };
        r.source.connect(r.processor); r.processor.connect(r.gain); r.gain.connect(r.context.destination);
        // Wall-clock cap also handles suspended/background audio devices.
        r.timer = setInterval(() => { if (Date.now() - r.started >= 46000) finish(); }, 500);
        r.started = Date.now();
        onReady();
      } catch (e) {
        if (run !== r) { release(r); return; }
        cancel();
        const errors = { NotAllowedError: '麦克风权限被拒绝，请在系统设置中允许火星小厨房使用麦克风。',
          NotFoundError: '未找到麦克风，请连接后重试。', NotReadableError: '麦克风正被占用或无法读取，请关闭其他录音程序后重试。' };
        onError(errors[e.name] || '无法启动麦克风：' + e.message);
      }
    }
    return { start, finish, cancel };
  }
  const api = { create, encodeWav };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AudioRecorder = api;
})(typeof window !== 'undefined' ? window : globalThis);
