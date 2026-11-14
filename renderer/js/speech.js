/* 火星小厨房 语音播报模块
 * 引擎一：Edge TTS（微软神经网络语音，中英双语女声，音频 + 词边界时间轴）
 * 引擎二：Web Speech API（系统语音，离线可用，作为回退）
 * 口型同步：Edge 用真实音频时长缩放口型轨道，系统语音按字符估算
 */
(function () {
  'use strict';

  const listeners = { end: [], chunk: [], error: [] };
  let conf = {
    engine: 'edge',
    voice: 'zh-CN-XiaoxiaoNeural',   // Edge 语音
    rate: 0,                          // Edge 语速百分比 -50..+50
    volume: 0,
    systemVoice: '',                  // 系统语音名
    systemRate: 1,
    volumeLevel: 1,                   // 播放音量 0..1
  };
  let gen = 0;
  let speaking = false;
  let currentAudio = null;
  let currentObjectUrl = null;
  let onChunkStart = null;
  let edgeAvailable = null;   // null=未探测
  let edgeVoices = [];
  let edgeInfo = null;
  let chunkStarted = false;   // 本轮播报是否已有音频开始播放

  // ---------- 文本处理 ----------
  function clean(text) {
    let s = String(text || '');
    s = s.replace(/```[\s\S]*?```/g, ' （代码部分请看文字内容） ');
    s = s.replace(/`([^`]+)`/g, '$1');
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    s = s.replace(/^\s{0,3}#{1,6}\s*/gm, '');
    s = s.replace(/^\s*[-*+]\s+/gm, '');
    s = s.replace(/^\s*\d+[.)]\s+/gm, '');
    s = s.replace(/^\s*>\s?/gm, '');
    s = s.replace(/(\*\*|__|\*|_|~~)/g, '');
    s = s.replace(/[|—]{1,}/g, ' ');
    s = s.replace(/https?:\/\/\S+/g, '链接');
    s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '');
    s = s.replace(/[ \t\u3000]+/g, ' ');
    s = s.replace(/\n{2,}/g, '。');
    s = s.replace(/\n/g, '，');
    return s.trim();
  }

  function chunk(text, max) {
    const limit = max || 100;
    const parts = String(text).split(/(?<=[。！？!?；;\.\n])/).map((x) => x.trim()).filter(Boolean);
    const out = [];
    let cur = '';
    for (const p of parts) {
      if ((cur + p).length > limit && cur) { out.push(cur); cur = p; }
      else cur += p;
    }
    if (cur) out.push(cur);
    return out.flatMap((c) => (c.length > limit * 1.8 ? c.match(new RegExp('.{1,' + limit + '}', 'g')) : [c]));
  }

  function emit(name, payload) {
    (listeners[name] || []).forEach((fn) => { try { fn(payload); } catch (_) {} });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Edge TTS ----------
  let voiceListFetched = false;
  async function probeEdge() {
    try {
      if (edgeAvailable === null) {
        edgeInfo = await window.niuai.ttsInfo();
        edgeAvailable = !!(edgeInfo && edgeInfo.available);
      }
      // 语音列表为空时重试（首次可能未就绪）
      if (edgeAvailable && !voiceListFetched) {
        const r = await window.niuai.ttsVoices().catch(() => null);
        if (r && r.ok && r.voices && r.voices.length) {
          edgeVoices = r.voices;
          voiceListFetched = true;
        }
      }
    } catch (_) {
      if (edgeAvailable === null) edgeAvailable = false;
    }
    return edgeAvailable;
  }

  function rateString(pct) {
    const n = Math.max(-50, Math.min(60, Number(pct) || 0));
    return (n >= 0 ? '+' : '') + n + '%';
  }

  function volumeString(pct) {
    const n = Math.max(-100, Math.min(100, Number(pct) || 0));
    return (n >= 0 ? '+' : '') + n + '%';
  }

  /** 合成一段文本 → {audio(ArrayBuffer), boundaries} */
  async function synth(text) {
    const r = await window.niuai.ttsSynth({
      text,
      voice: conf.voice,
      rate: rateString(conf.rate),
      volume: volumeString(conf.volume),
    });
    if (!r || !r.ok) throw new Error((r && r.error) || '语音合成失败');
    return r;
  }

  /** 播放一段音频，返回 Promise（播放结束或被打断） */
  function playAudio(audioBuffer, myGen, chunkText, boundaries) {
    return new Promise((resolve) => {
      if (myGen !== gen) { resolve('stale'); return; }
      const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const el = new Audio(url);
      el.volume = conf.volumeLevel;
      currentAudio = el;
      currentObjectUrl = url;
      let settled = false;
      const finish = (reason) => {
        if (settled) return;
        settled = true;
        try { el.pause(); } catch (_) {}
        try { URL.revokeObjectURL(url); } catch (_) {}
        if (currentAudio === el) currentAudio = null;
        resolve(reason);
      };
      let durationMs = null;
      el.onloadedmetadata = () => {
        if (myGen !== gen) { finish('stale'); return; }
        durationMs = isFinite(el.duration) && el.duration > 0
          ? el.duration * 1000
          : (boundaries && boundaries.length ? boundaries[boundaries.length - 1].endMs : undefined);
        chunkStarted = true;
        if (onChunkStart) onChunkStart(chunkText, durationMs, boundaries);
        emit('chunk', { text: chunkText, durationMs: durationMs, boundaries: boundaries });
        // 兜底：无音频输出设备或播放被静默打断时，按音频时长收尾，避免卡住队列
        if (durationMs) {
          setTimeout(() => { if (myGen === gen && !settled) finish('duration-elapsed'); }, durationMs + 600);
        }
      };
      el.onended = () => finish('ended');
      el.onerror = () => finish('error');
      el.play().catch(() => finish('blocked'));
      // 安全兜底：防止个别情况下 ended 不触发
      setTimeout(() => {
        if (myGen === gen && !settled) finish('timeout');
      }, 120000);
    });
  }

  /** Edge 引擎播报 */
  async function speakEdge(text, myGen) {
    const chunks = chunk(clean(text), 100);
    if (!chunks.length) return false;
    let pending = synth(chunks[0]);           // 预取当前段
    for (let i = 0; i < chunks.length; i++) {
      if (myGen !== gen) return true;
      let result;
      try {
        result = await pending;
      } catch (e) {
        // Edge 合成失败 → 该段回退系统语音
        console.log('[Speech] edge synth failed: ' + e.message);
        speakSystem(chunks.slice(i).join(''), myGen);
        return 'system';
      }
      if (myGen !== gen) return true;
      if (!result) { speakSystem(chunks.slice(i).join(''), myGen); return 'system'; }
      // 提前预取下一段，减少段落间的停顿
      if (i + 1 < chunks.length) pending = synth(chunks[i + 1]).catch(() => null);

      const reason = await playAudio(result.audio, myGen, chunks[i], result.boundaries);
      if (reason === 'stale' || myGen !== gen) return true;
      if (['error', 'blocked', 'timeout'].includes(reason)) {
        emit('error', { message: '语音音频无法播放，请检查声音输出设备。' });
        return false;
      }
    }
    return true;
  }

  // ---------- 系统语音（回退） ----------
  let sysQueue = [];
  let sysIdx = 0;
  let sysOnChunk = null;

  function speakSystemNext(myGen, retry = 0) {
    if (myGen !== gen) return;
    if (sysIdx >= sysQueue.length) { speaking = false; emit('end', {}); return; }
    const text = sysQueue[sysIdx];
    const u = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() || [] : [];
    let v = null;
    if (conf.systemVoice) v = voices.find((x) => x.name === conf.systemVoice) || null;
    if (!v) {
      const zh = voices.filter((x) => /zh|chinese|tingting|meijia|sinji|yaoyao/i.test(x.lang + ' ' + x.name));
      v = zh.find((x) => /zh[-_]CN/i.test(x.lang)) || zh[0] || null;
    }
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'zh-CN'; }
    u.rate = conf.systemRate;
    u.volume = conf.volumeLevel;
    let started = false;
    let finished = false;
    const watchdog = setTimeout(() => {
      if (finished || myGen !== gen) return;
      finished = true;
      speaking = false;
      try { window.speechSynthesis.cancel(); } catch (_) {}
      emit('error', { message: '系统语音播放超时，请检查声音输出设备。' });
      emit('end', {});
    }, 120000);
    u.onstart = () => { started = true; chunkStarted = true; if (sysOnChunk) sysOnChunk(text, undefined); emit('chunk', { text }); };
    u.onend = () => { if (finished) return; finished = true; clearTimeout(watchdog); if (myGen !== gen) return; sysIdx++; speakSystemNext(myGen); };
    u.onerror = (e) => {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      if (myGen !== gen) return;
      const code = e && e.error ? e.error : 'unknown';
      console.log('[Speech] system error: ' + code);
      if (code === 'interrupted' || code === 'canceled') return;
      sysIdx++;
      speakSystemNext(myGen);
    };
    try {
      window.speechSynthesis.speak(u);
      setTimeout(() => {
        if (finished || started || myGen !== gen) return;
        finished = true;
        clearTimeout(watchdog);
        try { window.speechSynthesis.cancel(); } catch (_) {}
        if (retry >= 1) {
          speaking = false;
          emit('error', { message: '系统语音无法播放，请检查中文语音和声音输出设备。' });
          emit('end', {});
        } else setTimeout(() => speakSystemNext(myGen, retry + 1), 260);
      }, 1300);
    } catch (_) { finished = true; clearTimeout(watchdog); sysIdx++; speakSystemNext(myGen); }
  }

  function speakSystem(text, myGen) {
    if (!window.speechSynthesis) { speaking = false; emit('error', { message: '系统语音不可用。' }); emit('end', {}); return false; }
    sysQueue = chunk(text, 110);
    sysIdx = 0;
    sysOnChunk = onChunkStart;
    if (!sysQueue.length) return false;
    setTimeout(() => speakSystemNext(myGen), 30);
    return true;
  }

  // ---------- 对外 API ----------
  const Speech = {
    configure(c) {
      const patch = c || {};
      if (patch.engine) conf.engine = patch.engine;
      if (patch.voice) conf.voice = patch.voice;
      if (patch.rate !== undefined) conf.rate = Number(patch.rate) || 0;
      if (patch.volume !== undefined) conf.volume = Number(patch.volume) || 0;
      if (patch.systemVoice !== undefined) conf.systemVoice = patch.systemVoice;
      if (patch.systemRate !== undefined) conf.systemRate = Number(patch.systemRate) || 1;
      if (patch.volumeLevel !== undefined) conf.volumeLevel = Math.max(0, Math.min(1, Number(patch.volumeLevel)));
      return Object.assign({}, conf);
    },
    config: () => Object.assign({}, conf),
    clean,
    chunk,

    /** 播报文本；onChunk(text, durationMs) 每段开始时回调（驱动口型） */
    async speak(text, opts) {
      const o = opts || {};
      this.stop();
      const cleaned = clean(text);
      if (!cleaned) return false;
      const maxLen = o.maxLength || 3000;
      const usable = cleaned.length > maxLen ? cleaned.slice(0, maxLen) + ' 内容较长，其余部分请看文字。' : cleaned;
      onChunkStart = o.onChunk || null;
      chunkStarted = false;
      const myGen = gen;
      speaking = true;

      // 口型兜底：1.5 秒内没有真实音频开始播放（无音频设备/合成失败/播放被拦），
      // 就用文本估算时长驱动口型，保证人物始终"在说话"
      const fallbackText = usable;
      setTimeout(() => {
        if (myGen !== gen || !speaking || chunkStarted) return;
        chunkStarted = true;
        if (onChunkStart) onChunkStart(fallbackText, Math.max(1200, fallbackText.length * 190), null);
      }, 1500);

      if (conf.engine === 'edge') {
        const ok = await probeEdge();
        if (myGen !== gen) return false;
        if (!ok) {
          if (o.onFallback) o.onFallback(edgeInfo);
          return speakSystem(usable, myGen);
        }
        const started = await speakEdge(usable, myGen);
        if (started === 'system') return true;
        if (myGen === gen && started) { /* 播报结束由 playAudio 循环推进 */ }
        if (myGen === gen) { speaking = false; emit('end', {}); }
        return true;
      }
      if (!window.speechSynthesis) {
        speaking = false;
        if (o.onUnsupported) o.onUnsupported();
        return false;
      }
      return speakSystem(usable, myGen);
    },

    stop() {
      gen++;
      speaking = false;
      sysQueue = [];
      sysIdx = 0;
      if (currentAudio) { try { currentAudio.pause(); } catch (_) {} currentAudio = null; }
      if (currentObjectUrl) { try { URL.revokeObjectURL(currentObjectUrl); } catch (_) {} currentObjectUrl = null; }
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) {}
    },

    isSpeaking: () => speaking,
    isSupported: () => !!(window.niuai && window.niuai.ttsSynth) || !!window.speechSynthesis,
    engine: () => conf.engine,
    async edgeStatus() {
      const ok = await probeEdge();
      return { available: ok, info: edgeInfo, voices: edgeVoices.length };
    },
    async voices() {
      await probeEdge();
      return edgeVoices;
    },
    /** 推荐语音（中英双语女声优先） */
    recommendedVoices() {
      const pick = ['zh-CN-XiaoxiaoNeural', 'zh-CN-XiaoyiNeural', 'en-US-AvaMultilingualNeural',
        'en-US-EmmaMultilingualNeural', 'zh-CN-liaoning-XiaobeiNeural', 'en-US-AriaNeural', 'en-US-JennyNeural'];
      const map = new Map(edgeVoices.map((v) => [v.name, v]));
      const out = [];
      for (const n of pick) { const v = map.get(n); if (v) out.push(v); }
      // 取不到列表时用内置兜底（Edge 语音名为固定值）
      if (!out.length) {
        const FALLBACK = {
          'zh-CN-XiaoxiaoNeural': 'zh-CN', 'zh-CN-XiaoyiNeural': 'zh-CN',
          'en-US-AvaMultilingualNeural': 'en-US', 'en-US-EmmaMultilingualNeural': 'en-US',
          'en-US-AriaNeural': 'en-US', 'en-US-JennyNeural': 'en-US',
        };
        return pick.map((n) => ({ name: n, locale: FALLBACK[n] || 'zh-CN', gender: 'Female', desc: '' }));
      }
      // 其它中文女声
      edgeVoices.filter((v) => /^zh-CN/.test(v.locale) && v.gender === 'Female' && !out.find((x) => x.name === v.name))
        .forEach((v) => out.push(v));
      return out;
    },
    systemVoices() {
      const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() || [] : [];
      return voices.filter((v) => /zh|chinese|tingting|meijia|sinji|yaoyao/i.test(v.lang + ' ' + v.name))
        .map((v) => ({ name: v.name, lang: v.lang }));
    },
    on(name, fn) { if (listeners[name]) listeners[name].push(fn); },
  };

  window.Speech = Speech;
})();
