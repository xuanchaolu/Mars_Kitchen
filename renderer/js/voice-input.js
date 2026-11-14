/* Chinese voice turns; recording and playback never run together. */
(function (root) {
  'use strict';
  function create(o) {
    let continuous = false, convId = null, requestId = null, phase = 'idle', transcript = '';
    let resumeTimer = null, serial = 0, disposed = false;
    const context = () => o.context();
    const show = (next, message) => {
      phase = next;
      o.update({ phase, continuous, transcript, message: message || '' });
    };
    const clearResume = () => { clearTimeout(resumeTimer); resumeTimer = null; };
    function cancel(message) {
      clearResume();
      const id = requestId;
      requestId = null;
      continuous = false;
      convId = null;
      transcript = '';
      if (id) Promise.resolve(o.bridge.sttStop({ id, cancel: true })).catch(() => {});
      show('idle', message);
    }
    function fail(message) { cancel(message); o.error(message); }
    function sameConversation() { return context().convId === convId; }
    async function listen() {
      if (disposed || requestId) return;
      const c = context();
      if (!c.convId || (convId && !sameConversation())) { cancel(); return; }
      if (!c.hasKey) { fail('请先在设置中填写对话 API Key，再开始语音对话。'); return; }
      if (c.hasSpeechKey === false) { fail('请先在设置 → 中文语音识别中填写你自己的语音 API Key。'); return; }
      if (c.busy) { fail('请等待当前回答完成，再开始语音。'); return; }
      if (c.hasDraft) { fail('请先发送或清空输入框中的文字和附件，再开始语音。'); return; }
      convId = c.convId;
      o.stopSpeaking();
      transcript = '';
      const id = 'voice-' + Date.now() + '-' + (++serial);
      requestId = id;
      show('starting', '正在打开麦克风，请允许系统权限…');
      try {
        const result = await o.bridge.sttStart(id);
        if (requestId !== id) return;
        if (!result || !result.ok) fail((result && result.error) || '无法启动语音识别。');
      } catch (e) { if (requestId === id) fail(e.message || '无法启动语音识别。'); }
    }
    function resume() {
      if (!continuous || disposed) return;
      clearResume();
      show('waiting', '即将继续聆听…');
      resumeTimer = setTimeout(() => {
        resumeTimer = null;
        if (!sameConversation()) { cancel(); return; }
        if (context().busy || o.isSpeaking()) return;
        listen();
      }, 650); // Let speaker output decay before enabling the microphone.
    }
    const unsubscribe = o.bridge.onSttEvent((event) => {
      if (event.id !== requestId || disposed) return;
      if (!sameConversation()) { cancel(); return; }
      if (event.type === 'listening') show('listening', '请说普通话，停顿后发送到 ' + (context().speechHost || '语音服务') + ' 识别；再次点击麦克风结束本句。');
      if (event.type === 'transcribing') show('transcribing', '正在将本句录音发送到 ' + (context().speechHost || '语音服务') + ' 识别…（Esc 取消）');
      if (event.type === 'partial') { transcript = String(event.text || ''); show('listening', '正在识别…'); }
      if (event.type === 'error') fail(event.error || '语音识别失败，请重试。');
      if (event.type === 'cancelled') cancel();
      if (event.type !== 'final') return;
      requestId = null;
      const text = String(event.text || '').trim();
      transcript = text;
      if (!text) { cancel('没有听到内容，点击麦克风重试。'); return; }
      const command = text.replace(/[\s，。！？、,.!?]/g, '');
      if (/^(停止对话|结束对话|退出语音|停止语音对话)$/.test(command)) {
        cancel('语音对话已结束。'); o.stopSpeaking(); return;
      }
      if (/^(再说一遍|重复一遍|重播上一条)$/.test(command)) {
        show('speaking', '正在重复上一条回答…');
        if (!o.repeat()) cancel('还没有可以重复的回答。');
        return;
      }
      if (context().busy || context().hasDraft) { fail('输入内容已变化，本句未发送，请重新开始语音。'); return; }
      show('thinking', '已听到：' + text + ' · 正在等待回答…');
      o.submit(text);
    });
    return {
      toggleMic() {
        clearResume();
        if (requestId) {
          if (phase === 'transcribing') { cancel('已取消语音识别。'); return; }
          if (phase === 'starting') { cancel(); return; }
          show('finishing', '正在完成识别…');
          Promise.resolve(o.bridge.sttStop({ id: requestId, cancel: false })).catch((e) => fail(e.message));
        } else { listen(); }
      },
      toggleContinuous() {
        if (continuous) { cancel('连续对话已结束。'); o.stopSpeaking(); return; }
        continuous = true;
        convId = context().convId;
        // A running single utterance can become a continuous conversation.
        if (requestId) { show(phase, '已开启连续对话。'); return; }
        listen();
      },
      responseDone(error) {
        if (phase !== 'thinking') return;
        if (!sameConversation()) { cancel(); return; }
        if (error) { cancel('回答失败，语音对话已暂停。'); return; }
        if (o.isSpeaking()) show('speaking', '正在朗读回答…');
        else if (continuous) resume();
        else show('idle', '点击麦克风继续提问。');
      },
      playbackEnded() {
        if (requestId || phase === 'thinking') return;
        if (continuous) resume();
        else if (phase === 'speaking') show('idle', '点击麦克风继续提问。');
      },
      // Manual typing/sending, conversation changes, and Escape end the voice session.
      cancel,
      ownsTurn: () => phase === 'thinking' && sameConversation(),
      state: () => ({ phase, continuous, requestId, transcript }),
      dispose() { cancel(); disposed = true; if (unsubscribe) unsubscribe(); },
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { create };
  else root.VoiceInput = { create };
})(typeof window !== 'undefined' ? window : globalThis);
