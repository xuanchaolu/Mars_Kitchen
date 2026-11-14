/* 火星小厨房 — 应用主逻辑
 * - 输入草稿 / 生成状态均按对话隔离，支持多对话并行生成
 * - 支持附加图片（视觉）与文本/PDF 文件
 */
(function () {
  'use strict';

  const MAX_ATTACHMENTS = 6;
  let voiceInput = null;

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const els = {
    convList: $('conv-list'),
    btnNew: $('btn-new'),
    btnTopNew: $('btn-top-new'),
    btnSettings: $('btn-settings'),
    btnSend: $('btn-send'),
    btnAttach: $('btn-attach'),
    fileInput: $('file-input'),
    attachChips: $('attach-chips'),
    inputShell: $('input-shell'),
    modelBadge: $('model-badge'),
    messages: $('messages'),
    input: $('input'),
    inputArea: $('input-area'),
    streamIndicator: $('stream-indicator'),
    settingsOverlay: $('settings-overlay'),
    btnCloseSettings: $('btn-close-settings'),
    btnCancelSettings: $('btn-cancel-settings'),
    btnSaveSettings: $('btn-save-settings'),
    btnToggleKey: $('btn-toggle-key'),
    setApiKey: $('set-apiKey'),
    setBaseURL: $('set-baseURL'),
    setModel: $('set-model'),
    setReasoning: $('set-reasoning'),
    setTemperature: $('set-temperature'),
    tempVal: $('temp-val'),
    setSystemPrompt: $('set-systemPrompt'),
    toast: $('toast'),
    btnViewToggle: $('btn-view-toggle'),
    btnWebSearch: $('btn-web-search'),
    skillList: $('skill-list'),
    btnSkillInstall: $('btn-skill-install'),
    btnSkillFolder: $('btn-skill-folder'),
    btnSkillRefresh: $('btn-skill-refresh'),
    setWebSearch: $('set-webSearch'),
    setWebSearchRounds: $('set-webSearchRounds'),
    roundsVal: $('rounds-val'),
    fieldWebSearchRounds: $('field-webSearchRounds'),
    folderView: $('folder-view'),
    folderGrid: $('folder-grid'),
    btnFolderNew: $('btn-folder-new'),
    btnViewList: $('btn-view-list'),
    sidebar: $('sidebar'),
    main: $('main'),
    // 虚拟形象
    avatarPanel: $('avatar-panel'),
    avatarCanvas: $('avatar-canvas'),
    avatarLoading: $('avatar-loading'),
    avatarName: $('avatar-name'),
    avatarStatus: $('avatar-status'),
    btnAvatarToggle: $('btn-avatar-toggle'),
    btnSpeakToggle: $('btn-speak-toggle'),
    btnAvatarSay: $('btn-avatar-say'),
    btnAvatarStop: $('btn-avatar-stop'),
    setAvatarEnabled: $('set-avatarEnabled'),
    setAvatarModel: $('set-avatarModel'),
    setMouthSpeed: $('set-mouthSpeed'),
    mouthSpeedVal: $('mouthspeed-val'),
    btnAvatarPick: $('btn-avatar-pick'),
    btnAvatarRefresh: $('btn-avatar-refresh'),
    btnAvatarFolder: $('btn-avatar-folder'),
    fieldAvatarModel: $('field-avatarModel'),
    setAvatarAutoSpeak: $('set-avatarAutoSpeak'),
    setAvatarVoice: $('set-avatarVoice'),
    setAvatarRate: $('set-avatarRate'),
    rateVal: $('rate-val'),
    setTtsEngine: $('set-ttsEngine'),
    setTtsVoice: $('set-ttsVoice'),
    setTtsRate: $('set-ttsRate'),
    ttsRateVal: $('ttsrate-val'),
    ttsStatus: $('tts-status'),
    fieldTtsVoice: $('field-ttsVoice'),
    fieldTtsRate: $('field-ttsRate'),
    fieldSystemVoice: $('field-systemVoice'),
    fieldSystemRate: $('field-systemRate'),
    // 火星小厨房：首次启动引导弹窗（老年模式 / 口味档位 / 忌口过敏）
    onboardOverlay: $('onboard-overlay'),
    obElder: $('ob-elder'),
    obSpicy: $('ob-spicy'),
    obSweet: $('ob-sweet'),
    obSalty: $('ob-salty'),
    obAvoid: $('ob-avoid'),
    obDefaults: $('ob-defaults'),
    obSave: $('ob-save'),
    // 老年模式高档位健康提醒
    healthOverlay: $('health-overlay'),
    healthList: $('health-list'),
    healthBack: $('health-back'),
    healthOk: $('health-ok'),
    // 火星小厨房：设置面板里的同款控件 + 人设档案管理
    setElder: $('set-elder'),
    setSpicy: $('set-spicy'),
    setSweet: $('set-sweet'),
    setSalty: $('set-salty'),
    setAvoid: $('set-avoid'),
    btnMarsFolder: $('btn-mars-folder'),
    btnMarsReload: $('btn-mars-reload'),
    btnMarsReset: $('btn-mars-reset'),
    marsProfileStatus: $('mars-profile-status'),
  };

  const SVG_SEND = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3.4 20.4 20.85 12 3.4 3.6l.01 6.53L15.6 12 3.41 13.87 3.4 20.4z"/></svg>';
  const SVG_STOP = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

  // ---------- 状态 ----------
  const state = {
    settings: null,
    conversations: [],
    currentId: null,
    drafts: {},        // convId -> { text, attachments } 输入草稿按对话隔离
    streams: {},       // convId -> { ctrl, startedAt } 每个对话独立的生成任务
    persistTimer: null,
    windows: new Map(),      // convId -> { el, messagesEl, inputEl, sendEl }
    folderSelection: null,   // 文件夹视图选中的对话
    folderClipboard: null,   // ⌘C 复制的对话（用于 ⌘V 分叉）
    dragging: null,
    marsProfile: null,       // 火星小厨房 人设档案（Skill.md / A.md / shtu / 档位映射）预加载缓存
  };
  let attachments = []; // 当前输入的待发送附件（与草稿同步）

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2));

  // ---------- 工具 ----------
  function toast(msg, ms) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.add('hidden'), ms || 3200);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function currentConv() {
    return state.conversations.find((c) => c.id === state.currentId) || null;
  }

  const isStreaming = (convId) => !!(convId && state.streams[convId]);

  function anyStreaming() { return Object.keys(state.streams).length > 0; }

  function persist(immediate) {
    clearTimeout(state.persistTimer);
    state.persistTimer = setTimeout(() => {
      window.niuai.setConversations(state.conversations).catch(() => {});
    }, immediate ? 0 : 350);
  }

  function relTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5);
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return '昨天';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function scrollToBottom(force) {
    const el = els.messages;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (force || nearBottom) el.scrollTop = el.scrollHeight;
  }

  // ---------- 草稿 ----------
  function saveDraft(convId) {
    if (!convId) return;
    state.drafts[convId] = { text: els.input.value, attachments };
  }

  function applyDraft() {
    const d = state.drafts[state.currentId];
    attachments = (d && d.attachments) ? d.attachments.slice() : [];
    els.input.value = (d && d.text) || '';
    autoGrow();
  }

  // ---------- 侧边栏 ----------
  function renderSidebar() {
    const list = els.convList;
    list.innerHTML = '';
    if (state.conversations.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'conv-item';
      empty.style.color = 'var(--text-tertiary)';
      empty.style.fontSize = '12px';
      empty.textContent = '暂无对话';
      list.appendChild(empty);
      return;
    }
    for (const c of state.conversations) {
      const item = document.createElement('div');
      item.className = 'conv-item' + (c.id === state.currentId ? ' active' : '');
      item.innerHTML =
        '<span class="conv-icon"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.8a5.6 5.6 0 0 0-5.6 5.6c0 1 .27 2 .77 2.87L2.6 13.4l3.14-.95a5.6 5.6 0 1 0 2.26-10.66z"/></svg></span>' +
        '<span class="conv-title" title="' + escapeHtml(c.title) + '">' + escapeHtml(c.title) + '</span>' +
        (isStreaming(c.id) ? '<span class="gen-dot" title="生成中"></span>' : '') +
        '<span class="conv-time">' + relTime(c.updatedAt) + '</span>' +
        '<button class="conv-del" title="删除对话"><svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>';
      item.addEventListener('click', () => selectConv(c.id));
      item.querySelector('.conv-del').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteConv(c.id);
      });
      list.appendChild(item);
    }
  }

  // ---------- 消息渲染 ----------
  function renderMessages() {
    renderConversationInto(els.messages, currentConv(), true);
    scrollToBottom(true);
  }

  /** 把某个对话渲染到指定容器（列表视图与对话窗口共用） */
  function renderConversationInto(container, conv, allowWelcome) {
    if (!container) return;
    const keepScroll = container.scrollTop;
    container.innerHTML = '';
    if (!conv || conv.messages.length === 0) {
      if (allowWelcome) { container.appendChild(buildWelcome()); return; }
      const hint = document.createElement('div');
      hint.className = 'cw-empty';
      hint.textContent = '这个对话还没有消息 —— 在下面输入框开始聊天吧';
      container.appendChild(hint);
      return;
    }
    const visible = conv.messages.filter((m) => !m.hidden);
    const lastId = visible.length ? visible[visible.length - 1].id : null;
    for (const m of visible) {
      container.appendChild(renderMessageRow(m, m.id === lastId && isStreaming(conv.id), conv.id));
    }
    container.scrollTop = keepScroll;
  }

  /** 欢迎页（返回元素，供主视图使用） */
  function buildWelcome() {
    const w = document.createElement('div');
    w.className = 'welcome';
    const model = state.settings ? state.settings.model : '';
    w.innerHTML =
      '<div class="welcome-logo"><img class="avatar-img" src="assets/logo.png" alt="火星小厨房"></div>' +
      '<h1>火星小厨房 AI</h1>' +
      '<div class="sub">DeepSeek 接口 · 模型 <code>' + escapeHtml(model) + '</code> · Skill.md + 人设（A.md / shtu）+ 档位映射</div>' +
      '<div class="chips">' +
      ['番茄炒蛋怎么做才好吃？', '给我一份一周的清淡家常菜谱', '冰箱里有鸡蛋和青椒，能做什么？', '帮我规划一次家庭聚餐的菜单']
        .map((s) => '<button class="chip">' + s + '</button>').join('') +
      '</div>';
    w.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        els.input.value = chip.textContent;
        autoGrow();
        saveDraft(state.currentId);
        els.input.focus();
      });
    });
    return w;
  }

  function renderWelcome() { renderMessages(); }

  function renderMessageRow(m, lastStreaming, convId) {
    const row = document.createElement('div');
    row.className = 'msg-row ' + m.role;
    row.dataset.id = m.id;

    if (m.role === 'user') {
      let inner = '';
      if (m.attachments && m.attachments.length) {
        inner += '<div class="att-row">';
        for (const a of m.attachments) {
          if (a.kind === 'image' && a.dataUrl) {
            inner += '<div class="att-img"><img src="' + a.dataUrl + '" alt="' + escapeHtml(a.name) + '"></div>';
          } else {
            inner += '<span class="att-file">' + (a.kind === 'pdf' ? '📕' : '📄') + ' ' + escapeHtml(a.name) + '</span>';
          }
        }
        inner += '</div>';
      }
      if (m.content) inner += '<div class="user-bubble">' + escapeHtml(m.content) + '</div>';
      row.innerHTML = '<div class="msg-inner"><div class="msg-content user-side">' + inner + '</div></div>';
      return row;
    }

    // assistant
    const reasoning = m.reasoning || '';
    const isErr = m.error === true;
    const bodyClass = 'assistant-body' + (isErr ? ' error' : '') + (m.content ? '' : ' empty');
    const reasonLabel = reasoning
      ? '深度思考过程' + (m.reasoningSeconds ? ' · 用时 ' + m.reasoningSeconds + ' 秒' : '') + '（点击展开）'
      : '';

    const steps = m.searchSteps || [];
    let searchHtml = '';
    if (steps.length) {
      const queries = steps.filter((x) => x.type === 'search');
      const skillReads = steps.filter((x) => x.type === 'skill');
      const sources = [];
      for (const st of queries) for (const r of (st.results || [])) if (!sources.some((s) => s.url === r.url)) sources.push(r);
      let summary = '';
      if (queries.length) summary = '🔍 联网搜索 · ' + queries.length + ' 次查询 · ' + sources.length + ' 条来源';
      if (skillReads.length) summary += (summary ? ' · ' : '') + '📖 读取技能文件 ' + skillReads.length + ' 次';
      if (!summary) summary = '🛠 工具调用 ' + steps.length + ' 次';
      searchHtml =
        '<div class="search-box' + (lastStreaming ? ' open' : '') + '">' +
          '<button class="search-toggle' + (lastStreaming ? ' open' : '') + '">' +
            '<svg class="chev" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>' +
            '<span class="search-label">' + escapeHtml(summary) + '</span>' +
          '</button>' +
          '<div class="search-body' + (lastStreaming ? '' : ' hidden') + '">' +
            queries.map((st) => '<div class="search-query">' +
              (st.error ? '⚠️ ' + escapeHtml(st.error) : '• ' + escapeHtml(st.query)) +
              (st.results && st.results.length ? '<div class="search-results">' + st.results.map((r) =>
                '<a class="search-src" href="' + escapeHtml(r.url) + '" target="_blank" rel="noreferrer">' + escapeHtml(r.title || r.url) + '</a>').join('') + '</div>' : '') +
            '</div>').join('') +
            skillReads.map((st) => '<div class="search-query">' +
              (st.error ? '⚠️ ' + escapeHtml(st.error) : '📖 ' + escapeHtml(st.skill || '') + ' / ' + escapeHtml(st.file || '') + (st.chars ? '（' + st.chars + ' 字）' : '')) +
            '</div>').join('') +
          '</div>' +
        '</div>';
    }

    if (reasoning && !lastStreaming) row.dataset.autoCollapsed = '1';
    row.innerHTML =
      '<div class="msg-inner">' +
        '<div class="avatar"><img class="avatar-img" src="assets/logo.png" alt="火星小厨房"></div>' +
        '<div class="msg-content">' +
          '<div class="msg-head">' +
            '<span class="msg-name">火星小厨房</span>' +
            '<span class="msg-actions">' +
              '<button class="act-copy" title="复制内容"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-1A1.5 1.5 0 0 0 9 3H4.5A1.5 1.5 0 0 0 3 4.5V9a1.5 1.5 0 0 0 1.5 1.5h1"/></svg></button>' +
              '<button class="act-regen" title="重新生成"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/></svg></button>' +
              '<button class="act-speak" title="让形象朗读这条回答"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6h2.2L8 3.4v9.2L4.7 10H2.5z"/><path d="M10.6 6.2a2.6 2.6 0 0 1 0 3.6"/></svg></button>' +
            '</span>' +
          '</div>' +
          searchHtml +
          (reasoning
            ? '<div class="reason-box"><button class="reason-toggle' + (lastStreaming ? ' open' : '') + '"><svg class="chev" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg><span class="reason-label">' + escapeHtml(reasonLabel) + '</span></button><div class="reason-body' + (lastStreaming ? '' : ' hidden') + '">' + escapeHtml(reasoning) + '</div></div>'
            : '') +
          '<div class="' + bodyClass + '">' + (m.content ? marsAnswerHtml(m, lastStreaming) : (lastStreaming ? '<span class="typing-cursor"></span>' : '<span>思考中…</span>')) + '</div>' +
        '</div>' +
      '</div>';

    const bodyEl = row.querySelector('.assistant-body');
    row.querySelector('.act-copy').addEventListener('click', () => {
      copyText(m.content || '');
      toast('已复制到剪贴板');
    });
    const owner = convId || state.currentId;
    if (isStreaming(owner)) {
      row.querySelector('.act-regen').style.display = 'none';
    } else {
      row.querySelector('.act-regen').addEventListener('click', () => regenerate(m.id, owner));
    }
    const speakBtn = row.querySelector('.act-speak');
    if (speakBtn) {
      if (!m.content) speakBtn.style.display = 'none';
      speakBtn.addEventListener('click', () => {
        if (window.Speech && window.Speech.isSpeaking()) stopSpeaking();
        else speakText(m.content || '');
      });
    }
    bindReasonToggle(row);
    const sToggle = row.querySelector('.search-toggle');
    const sBody = row.querySelector('.search-body');
    if (sToggle && sBody) {
      sToggle.addEventListener('click', () => { sToggle.classList.toggle('open'); sBody.classList.toggle('hidden'); });
    }
    bindCodeCopy(bodyEl);
    return row;
  }

  function bindReasonToggle(scope) {
    const toggle = scope.querySelector('.reason-toggle');
    const rb = scope.querySelector('.reason-body');
    if (!toggle || !rb) return;
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      rb.classList.toggle('hidden');
    });
  }

  function bindCodeCopy(scope) {
    if (!scope) return;
    scope.querySelectorAll('.code-block').forEach((cb) => {
      const btn = cb.querySelector('.code-copy');
      const code = cb.querySelector('code');
      if (btn && code && !btn.dataset.bound) {
        btn.dataset.bound = '1';
        btn.addEventListener('click', () => { copyText(code.textContent); toast('代码已复制'); });
      }
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    } else {
      legacyCopy(text);
    }
  }
  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }

  // ---------- 流式更新（增量，含深度思考区块的动态创建） ----------
  let rafPending = false;
  function updateLastMessage(convId, force) {
    if (rafPending && !force) return;
    rafPending = true;
    renderProbe.scheduled++;
    scheduleRender(() => {
      rafPending = false;
      renderProbe.rafRuns++;
      try {
      const conv = state.conversations.find((c) => c.id === convId);
      if (!conv || !conv.messages.length) { renderProbe.noConv++; return; }
      const last = conv.messages[conv.messages.length - 1];
      if (last.role !== 'assistant') { renderProbe.noAssist++; return; }
      const streamingNow = isStreaming(convId);

      // 需要刷新的容器：列表视图（当前对话）+ 该对话的浮动窗口
      const targets = [];
      if (convId === state.currentId && els.messages) targets.push(els.messages);
      const win = state.windows.get(convId);
      if (win && win.messagesEl) targets.push(win.messagesEl);
      if (!targets.length) { renderProbe.noTargets++; return; }

      for (const container of targets) updateRowIn(container, conv, last, streamingNow, force);
      if (targets.includes(els.messages)) scrollToBottom();
      } catch (e) { renderProbe.err = String(e && e.message || e); }
    });
  }

  /** 刷新调度：可见时用 rAF（省电），窗口被遮挡/隐藏时退回 setTimeout（保证界面同步）*/
  function scheduleRender(fn) {
    if (document.hidden) { setTimeout(fn, 16); return; }
    requestAnimationFrame(fn);
  }

  /** 在指定容器内就地刷新最后一条助手消息 */
  const renderProbe = { calls: 0, lastLen: -1, notFound: 0, targets: 0, scheduled: 0, rafRuns: 0, noConv: 0, noAssist: 0, noTargets: 0, err: null };
  function updateRowIn(container, conv, last, streamingNow, force) {
    renderProbe.calls++;
    renderProbe.lastLen = (last.content || '').length;
    {
      renderProbe.targets = (renderProbe.targets || 0) + 1;
      let row = container.querySelector('.msg-row[data-id="' + last.id + '"]');
      if (!row) { renderProbe.notFound++; renderConversationInto(container, conv, container === els.messages); return; }

      // —— 深度思考区块：流式开始时才出现，需要动态补建 ——
      let reasonBox = row.querySelector('.reason-box');
      if ((last.reasoning || '') && !reasonBox) {
        const head = row.querySelector('.msg-head');
        if (head) {
          reasonBox = document.createElement('div');
          reasonBox.className = 'reason-box';
          reasonBox.innerHTML =
            '<button class="reason-toggle open"><svg class="chev" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg><span class="reason-label"></span></button>' +
            '<div class="reason-body"></div>';
          head.insertAdjacentElement('afterend', reasonBox);
          bindReasonToggle(reasonBox);
        }
      }
      if (reasonBox) {
        const label = reasonBox.querySelector('.reason-label');
        const body = reasonBox.querySelector('.reason-body');
        const rb = row.querySelector('.reason-toggle');
        // 思考是否已结束：已开始输出答案，或整轮已结束
        const thinkingDone = !streamingNow || !!last.content;
        if (!thinkingDone) {
          // 深度思考中：保持展开，实时显示思考过程
          if (rb) rb.classList.add('open');
          if (body) body.classList.remove('hidden');
          if (label) label.textContent = '深度思考中…';
        } else {
          if (label) {
            label.textContent = '深度思考过程'
              + (last.reasoningSeconds ? ' · 用时 ' + last.reasoningSeconds + ' 秒' : '')
              + '（点击展开）';
          }
          // 思考结束 → 自动折叠（每个消息只自动折叠一次，之后尊重用户手动展开）
          if (rb && body && !row.dataset.autoCollapsed && rb.classList.contains('open')) {
            rb.classList.remove('open');
            body.classList.add('hidden');
            row.dataset.autoCollapsed = '1';
          }
        }
        if (body) {
          body.textContent = last.reasoning || '';
          body.scrollTop = body.scrollHeight;
        }
      }

      // —— 正文 ——
      const bodyEl = row.querySelector('.assistant-body');
      if (bodyEl) {
        if (last.error) {
          bodyEl.className = 'assistant-body error';
          bodyEl.innerHTML = escapeHtml(last.content);
        } else if (last.content) {
          bodyEl.className = 'assistant-body';
          bodyEl.innerHTML = marsAnswerHtml(last, streamingNow);
          bindCodeCopy(bodyEl);
        } else {
          bodyEl.className = 'assistant-body empty';
          bodyEl.innerHTML = streamingNow ? '<span class="typing-cursor"></span>' : '<span>思考中…</span>';
        }
      }
    }
  }

  // ---------- 组装 API 消息 ----------
  function apiContentFor(m) {
    let text = m.content || '';
    const imgs = [];
    for (const a of (m.attachments || [])) {
      if (a.kind === 'image' && a.dataUrl) {
        imgs.push({ type: 'image_url', image_url: { url: a.dataUrl } });
      } else if (a.kind === 'text' && a.text) {
        text += '\n\n【附件文件：' + a.name + '】\n```\n' + a.text + '\n```';
      } else if (a.kind === 'pdf' && a.text) {
        text += '\n\n【附件 PDF：' + a.name + '】\n' + a.text;
      }
    }
    if (!imgs.length) return text;
    return [{ type: 'text', text: text || '请查看这些附件。' }].concat(imgs);
  }

  function apiMsgFromChat(m) {
    if (m.role === 'tool') {
      return { role: 'tool', toolCallId: m.toolCallId, name: m.name, content: m.content };
    }
    const d = { role: m.role, content: apiContentFor(m) };
    if (m.toolCalls && m.toolCalls.length) d.toolCalls = m.toolCalls;
    if (m.role === 'assistant' && m.reasoningDetails) d.reasoningDetails = m.reasoningDetails;
    return d;
  }

  // ---------- 发送 / 停止 / 重新生成 ----------
  /** 从对话窗口发送（仅文本，支持多窗口并行） */
  function sendFromWindow(convId) {
    if (voiceInput) voiceInput.cancel();
    const conv = state.conversations.find((c) => c.id === convId);
    const win = state.windows.get(convId);
    if (!conv || !win) return;
    if (isStreaming(convId)) { stopConv(convId); return; }
    const text = win.inputEl.value.trim();
    if (!text) return;
    if (!state.settings.apiKey) { toast('请先在设置中填写 API Key'); openSettings(); return; }
    stopSpeaking();
    const userMsg = { id: uid(), role: 'user', content: text, createdAt: Date.now() };
    const asstMsg = { id: uid(), role: 'assistant', content: '', reasoning: '', reasoningDetails: null, createdAt: Date.now() };
    conv.messages.push(userMsg, asstMsg);
    if (conv.title === '新对话') conv.title = text.slice(0, 24);
    conv.updatedAt = Date.now();
    win.inputEl.value = '';
    win.inputEl.style.height = 'auto';
    renderConvEverywhere(convId);
    renderFolderGrid();
    persist();
    startStream(conv);
  }

  function send(fromVoice) {
    if (fromVoice !== true && voiceInput) voiceInput.cancel();
    const conv = currentConv();
    if (!conv || isStreaming(conv.id)) return;
    const text = els.input.value.trim();
    if (!text && attachments.length === 0) return;
    if (!state.settings.apiKey) {
      toast('请先在设置中填写 API Key');
      openSettings();
      return;
    }
    stopSpeaking(); // 新提问时打断正在进行的播报

    const userMsg = { id: uid(), role: 'user', content: text, createdAt: Date.now() };
    if (attachments.length) userMsg.attachments = JSON.parse(JSON.stringify(attachments));
    const asstMsg = { id: uid(), role: 'assistant', content: '', reasoning: '', reasoningDetails: null, createdAt: Date.now() };
    conv.messages.push(userMsg, asstMsg);
    if (conv.title === '新对话') {
      conv.title = String(text || (userMsg.attachments && userMsg.attachments[0].name) || '新对话').slice(0, 24);
    }
    conv.updatedAt = Date.now();

    // 清空当前输入与草稿
    attachments = [];
    els.input.value = '';
    state.drafts[conv.id] = { text: '', attachments: [] };
    autoGrow();
    renderAttachChips();
    renderMessages();
    renderConvEverywhere(conv.id);
    renderFolderGrid();
    updateComposeUI();
    persist();

    startStream(conv);
  }


  // ==================== 智能体循环（联网搜索工具调用） ====================
  const searchEnabled = () => !!(state.settings && state.settings.webSearch);
  const maxSearchRounds = () => Math.max(1, Math.min(6, Number(state.settings && state.settings.webSearchRounds) || 3));

  // 时效性/爆料类问题：即使模型不主动调用工具，应用也先搜一轮（结果作为内部资料注入）
  const TIME_SENSITIVE = /爆料|传闻|最近|近期|刚刚|昨天|今天|新闻|直播|怎么回事|是真的吗|据说|听说|疑似|回应|官宣|新歌|新专辑|恋情|恋爱|分手|结婚|生子|塌房|热搜/;

  async function autoSearchContext(userText) {
    if (!searchEnabled()) return { context: '', steps: [] };
    const text = String(userText || '');
    if (!TIME_SENSITIVE.test(text)) return { context: '', steps: [] };
    const query = text.replace(/[（(].*?[)）]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!query) return { context: '', steps: [] };
    let r = null;
    try { r = await window.niuai.webSearch({ query: query, maxResults: 6 }); } catch (_) {}
    let results = (r && r.results) || [];
    // 一次不理想就用更短的关键词再试一次
    if (results.length < 2) {
      const short = query.split(/[ ，,、]/).slice(0, 3).join(' ');
      if (short && short !== query) {
        try {
          const r2 = await window.niuai.webSearch({ query: short, maxResults: 6 });
          if (r2 && r2.results && r2.results.length > results.length) { results = r2.results; r = r2; }
        } catch (_) {}
      }
    }
    if (!results.length) return { context: '', steps: [{ type: 'search', query: query, results: [], error: '这次没搜到可用的资料' }] };
    const lines = results.map((x, i) => '[' + (i + 1) + '] ' + x.title + '\n' + x.url + '\n' + (x.snippet || '')).join('\n\n');
    return {
      context: '以下是应用刚刚在内部检索到的资料，供你作答参考。回答时不要提及检索过程或资料来源（不要出现「搜索 / 查询 / 资料 / 网上 / 公开信息」等字样），要自然地组织进回答里：\n\n' + lines,
      steps: [{ type: 'search', query: query, results: results.map((x) => ({ title: x.title, url: x.url })), engine: r && r.engine }],
    };
  }

  /** 本轮可用的工具集合（联网搜索 + 技能文件读取）*/
  function buildTools() {
    const tools = [];
    if (searchEnabled()) for (const t of (window.API.WEB_TOOLS || [])) tools.push(t);
    if (enabledSkills().filter((s) => !s.missing).length) for (const t of (window.API.SKILL_TOOLS || [])) tools.push(t);
    return tools.length ? tools : undefined;
  }

  /** 把会话历史转换为 API 消息（排除末尾正在生成的占位消息） */
  function buildHistory(conv) {
    return conv.messages.slice(0, -1).map(apiMsgFromChat);
  }

  /** 执行一次工具调用（主进程里发真实请求，避开 CORS） */
  async function runTool(tc) {
    let args = {};
    try { args = JSON.parse(tc.arguments || '{}'); } catch (_) {}
    if (tc.name === 'web_search') {
      const query = String(args.query || '').slice(0, 200);
      const r = await window.niuai.webSearch({ query: query, maxResults: 6 });
      const results = (r && r.results) || [];
      return {
        step: { type: 'search', query: query, count: results.length, results: results.map((x) => ({ title: x.title, url: x.url })), error: r && r.ok === false ? r.error : null },
        payload: r && r.ok === false
          ? { error: r.error }
          : { query: query, results: results.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet })) },
      };
    }
    if (tc.name === 'fetch_page') {
      const url = String(args.url || '');
      const r = await window.niuai.fetchPage({ url: url, maxChars: 6000 });
      return {
        step: { type: 'fetch', url: url, chars: r && r.text ? r.text.length : 0, error: r && r.ok === false ? r.error : null },
        payload: r && r.ok === false ? { error: r.error } : { url: url, text: r.text },
      };
    }
    if (tc.name === 'read_skill_file') {
      const ref = String(args.skill || '').trim();
      const file = String(args.file || '').trim();
      const list = (state.settings.skills || []).filter((s) => !s.missing);
      const hit = list.find((s) => s.id === ref || s.name === ref)
        || list.find((s) => ref && (s.id.includes(ref) || s.name.includes(ref)))
        || list[0];
      const id = hit ? hit.id : ref;
      const r = await window.niuai.skillsRead({ id: id, file: file });
      return {
        step: { type: 'skill', skill: (hit && hit.name) || id, file: r && r.file ? r.file : file,
                chars: r && r.text ? r.text.length : 0, error: r && r.ok === false ? r.error : null },
        payload: r && r.ok
          ? { skill: (hit && hit.name) || id, file: r.file, text: r.text }
          : { error: (r && r.error) || '读取失败', files: (r && r.files) || [] },
      };
    }
    return { step: { type: 'unknown', name: tc.name }, payload: { error: '未知工具 ' + tc.name } };
  }

  /** 多轮：请求 → 若模型要搜就执行 → 再请求，直到给出最终回答 */
  async function runAgentLoop(conv, ctrl) {
    const rounds = searchEnabled() ? maxSearchRounds() : 1;
    const tools = buildTools();
    let totalCount = 0;

    // 时效性问题：先自动搜一轮，把资料作为内部上下文注入（模型可以不调用工具也能拿到最新信息）
    let autoContext = '';
    const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user');
    if (lastUser && lastUser.content) {
      const auto = await autoSearchContext(lastUser.content);
      if (auto.context) autoContext = auto.context;
      if (auto.steps.length) {
        const ph = conv.messages[conv.messages.length - 1];
        if (ph && ph.role === 'assistant') ph.searchSteps = auto.steps;
        renderConvEverywhere(conv.id);
      }
    }

    for (let round = 1; round <= rounds; round++) {
      const history = buildHistory(conv);
      const res = await window.API.streamRound({
        settings: state.settings,
        messages: history,
        tools: tools,
        signal: ctrl.signal,
        systemPrompt: resolveSystemPrompt(lastUser && lastUser.content),     // Mars 人设 + 技能提示词
        skillsContext: buildSkillsContext(),     // 启用技能的说明
        extraContext: autoContext,               // 自动预搜索的资料
        onDelta: (d) => applyDelta(conv.id, d),
      });
      totalCount += res.count || 0;

      const placeholder = conv.messages[conv.messages.length - 1];
      if (!placeholder || placeholder.role !== 'assistant') return totalCount;

      if (!res.toolCalls || !res.toolCalls.length) {
        // 最终回答
        placeholder.searchSteps = (collectSearchSteps(conv).length ? collectSearchSteps(conv) : (placeholder.searchSteps || []));
        finalizeStream(conv.id, totalCount);
        return totalCount;
      }

      // 这一轮是工具调用：把占位消息转为隐藏的 tool_calls 载体
      placeholder.hidden = true;
      placeholder.content = res.content || '';
      placeholder.toolCalls = res.toolCalls;
      placeholder.reasoningDetails = res.reasoningDetails || placeholder.reasoningDetails;

      // 执行工具，把结果作为 tool 消息写入历史
      for (const tc of res.toolCalls) {
        let out;
        try { out = await runTool(tc); } catch (e) { out = { step: { type: 'error', message: String(e.message || e) }, payload: { error: String(e.message || e) } }; }
        conv.messages.push({
          id: uid(), role: 'tool', toolCallId: tc.id, name: tc.name,
          content: JSON.stringify(out.payload), hidden: true, createdAt: Date.now(),
        });
      }

      // 为下一轮新增可见的助手气泡
      const next = { id: uid(), role: 'assistant', content: '', reasoning: '', reasoningDetails: null, createdAt: Date.now() };
      next.searchSteps = collectSearchSteps(conv);
      conv.messages.push(next);
      conv.updatedAt = Date.now();
      persist();
      renderConvEverywhere(conv.id);
      updateLastMessage(conv.id, true);

      if (round === rounds) {
        // 轮次用尽：不再提供工具，并要求它用纯文本作答（避免它继续吐工具标记）
        const noToolHint = '（系统提示）已达到本轮工具调用上限：请只依据上面的资料，用自然语言直接回答，不要再输出任何工具调用、标记或代码块形式的调用。';
        const finalRes = await window.API.streamRound({
          settings: state.settings,
          messages: buildHistory(conv).concat([{ role: 'user', content: noToolHint }]),
          signal: ctrl.signal,
          systemPrompt: resolveSystemPrompt(lastUser && lastUser.content),
          skillsContext: buildSkillsContext(),
          extraContext: autoContext,
          onDelta: (d) => applyDelta(conv.id, d),
        });
        totalCount += finalRes.count || 0;
        const last = conv.messages[conv.messages.length - 1];
        if (last && last.role === 'assistant') {
          last.searchSteps = collectSearchSteps(conv);
          if (!(last.content || '').trim()) {
            last.content = '（模型本轮仍想继续调用工具，但已达到搜索轮次上限。可在「设置 → 联网搜索 → 最多搜索轮次」里调高。）';
          }
        }
        finalizeStream(conv.id, totalCount);
        return totalCount;
      }
    }
    return totalCount;
  }

  /** 汇总本轮（含历史轮）的搜索步骤，用于界面展示 */
  function collectSearchSteps(conv) {
    const steps = [];
    for (const m of conv.messages) {
      if (m.role !== 'tool') continue;
      let payload = {};
      try { payload = JSON.parse(m.content || '{}'); } catch (_) {}
      if (m.name === 'web_search') {
        steps.push({
          type: 'search',
          query: payload.query || '',
          results: (payload.results || []).map((x) => ({ title: x.title, url: x.url })),
          error: payload.error || null,
        });
      } else if (m.name === 'fetch_page') {
        steps.push({ type: 'fetch', url: payload.url || '', error: payload.error || null });
      } else if (m.name === 'read_skill_file') {
        steps.push({ type: 'skill', skill: payload.skill || '', file: payload.file || '', chars: (payload.text || '').length, error: payload.error || null });
      }
    }
    return steps;
  }

  function startStream(conv) {
    const ctrl = new AbortController();
    state.streams[conv.id] = { ctrl, startedAt: Date.now() };

    updateComposeUI();
    renderSidebar();
    updateWindowSendState(conv.id);
    updateLastMessage(conv.id, true); // 立即显示打字光标（否则首个增量到达前显示占位文字）
    if (avatar.handle && conv.id === state.currentId) {
      avatar.handle.setMood('thinking');
      setAvatarStatus('thinking');
    }
    runAgentLoop(conv, ctrl)
      .catch((err) => {
        if (err && err.name === 'AbortError') return;
        markError(conv.id, err);
        if (conv.id === state.currentId) toast((err && err.message) || '请求失败');
      })
      .finally(() => {
        delete state.streams[conv.id];
        const c = state.conversations.find((x) => x.id === conv.id);
        if (c) c.updatedAt = Date.now();
        persist(true);
        renderSidebar();
        renderFolderGrid();
        updateWindowSendState(conv.id);
        updateLastMessage(conv.id, true);
        updateComposeUI();
        if (voiceInput && conv.id === state.currentId) {
          const last = conv.messages[conv.messages.length - 1];
          voiceInput.responseDone(ctrl.signal.aborted || (last && last.error));
        }
      });
  }

  function applyDelta(convId, d) {
    const conv = state.conversations.find((c) => c.id === convId);
    if (!conv) return;
    const last = conv.messages[conv.messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (d.content) last.content += d.content;
    if (d.reasoning) last.reasoning = (last.reasoning || '') + d.reasoning;
    if (d.reasoningDetails) last.reasoningDetails = d.reasoningDetails;
    conv.updatedAt = Date.now();
    updateLastMessage(convId);
  }

  function finalizeStream(convId, count) {
    const conv = state.conversations.find((c) => c.id === convId);
    if (!conv || !conv.messages.length) return;
    const st = state.streams[convId];
    const last = conv.messages[conv.messages.length - 1];
    if (last.role === 'assistant') {
      last.reasoningSeconds = Math.max(1, Math.round((Date.now() - (st ? st.startedAt : Date.now())) / 1000));
      if (!last.content.trim() && !(last.reasoning || '').trim() && !count) {
        last.content = '（模型未返回内容，请重试）';
      }
      // 播报：仅当前对话 + 开启自动播报 + 非错误内容
      if (convId === state.currentId && state.settings && (state.settings.avatarAutoSpeak || (voiceInput && voiceInput.ownsTurn())) &&
          last.content.trim() && !last.error) {
        speakText(last.content);
      } else {
        setAvatarStatus('idle');
      }
    }
  }

  function markError(convId, err) {
    const conv = state.conversations.find((c) => c.id === convId);
    if (!conv || !conv.messages.length) return;
    const last = conv.messages[conv.messages.length - 1];
    last.content = '请求出错：' + (err && err.message ? err.message : String(err));
    last.error = true;
    updateLastMessage(convId, true);
  }

  function stop() {
    if (voiceInput) voiceInput.cancel();
    const s = state.streams[state.currentId];
    if (s) s.ctrl.abort();
  }

  function stopConv(convId) {
    const s = state.streams[convId];
    if (s) s.ctrl.abort();
  }

  /** 刷新某对话在「列表视图 + 已打开窗口」中的显示 */
  function renderConvEverywhere(convId) {
    const conv = state.conversations.find((c) => c.id === convId);
    if (!conv) return;
    if (convId === state.currentId) renderConversationInto(els.messages, conv, true);
    const win = state.windows.get(convId);
    if (win) {
      renderConversationInto(win.messagesEl, conv, false);
      win.messagesEl.scrollTop = win.messagesEl.scrollHeight;
      if (win.titleEl) win.titleEl.textContent = conv.title;
    }
  }

  function regenerate(msgId, convId) {
    const conv = convId ? state.conversations.find((c) => c.id === convId) : currentConv();
    if (!conv || isStreaming(conv.id)) return;
    const idx = conv.messages.findIndex((m) => m.id === msgId);
    if (idx === -1 || conv.messages[idx].role !== 'assistant') return;
    conv.messages = conv.messages.slice(0, idx);
    conv.messages.push({ id: uid(), role: 'assistant', content: '', reasoning: '', reasoningDetails: null, createdAt: Date.now() });
    conv.updatedAt = Date.now();
    renderConvEverywhere(conv.id);
    persist();
    startStream(conv);
  }

  // ---------- 会话管理 ----------
  function newChat() {
    if (voiceInput) voiceInput.cancel();
    saveCurrentDraft();
    const conv = { id: uid(), title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), messages: [], icon: randomIconId() };
    state.conversations.unshift(conv);
    state.currentId = conv.id;
    renderSidebar();
    renderMessages();
    renderFolderGrid();
    updateComposeUI();
    persist();
    els.input.focus();
  }

  function selectConv(id) {
    if (id === state.currentId) return;
    if (voiceInput) voiceInput.cancel();
    saveCurrentDraft();
    state.currentId = id;
    renderSidebar();
    renderMessages();
    updateComposeUI(); // 载入该对话自己的草稿与按钮状态
  }

  function deleteConv(id) {
    if (voiceInput && id === state.currentId) voiceInput.cancel();
    if (state.streams[id]) state.streams[id].ctrl.abort(); // 中止该对话的生成
    closeConversationWindow(id);
    delete state.drafts[id];
    const idx = state.conversations.findIndex((c) => c.id === id);
    if (idx === -1) return;
    state.conversations.splice(idx, 1);
    if (state.currentId === id) {
      state.currentId = state.conversations.length ? state.conversations[0].id : null;
    }
    if (state.conversations.length === 0) {
      const conv = { id: uid(), title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
      state.conversations.push(conv);
      state.currentId = conv.id;
    }
    renderSidebar();
    renderMessages();
    renderFolderGrid();
    updateComposeUI();
    persist();
  }

  function saveCurrentDraft() {
    if (state.currentId) state.drafts[state.currentId] = { text: els.input.value, attachments: attachments.slice() };
  }

  // ---------- 输入区状态（按钮/指示器/草稿/附件） ----------
  function updateComposeUI() {
    // 载入当前对话草稿
    const d = state.drafts[state.currentId];
    attachments = d && d.attachments ? d.attachments.slice() : [];
    els.input.value = (d && d.text) || '';
    autoGrow();

    // 发送/停止按钮按当前对话的生成状态显示
    const streaming = isStreaming(state.currentId);
    updateSendButtonState();

    // 顶部指示器：任一对话在生成就提示数量
    const n = Object.keys(state.streams).length;
    els.streamIndicator.classList.toggle('hidden', n === 0);
    if (n) els.streamIndicator.innerHTML = '<span class="dot"></span>生成中' + (n > 1 ? ' ×' + n : '…');

    renderAttachChips();
  }

  // ---------- 附件 ----------
  function renderAttachChips() {
    const box = els.attachChips;
    box.innerHTML = '';
    if (!attachments.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    for (const a of attachments) {
      const chip = document.createElement('div');
      chip.className = 'attach-chip';
      if (a.kind === 'image' && a.dataUrl) {
        chip.innerHTML = '<img class="chip-thumb" src="' + a.dataUrl + '" alt="">' +
          '<span class="chip-name">' + escapeHtml(a.name) + '</span>' +
          '<button class="chip-x" title="移除">×</button>';
      } else {
        chip.innerHTML = '<span class="chip-icon">' + (a.kind === 'pdf' ? '📕' : '📄') + '</span>' +
          '<span class="chip-name">' + escapeHtml(a.name) + '</span>' +
          '<button class="chip-x" title="移除">×</button>';
      }
      chip.querySelector('.chip-x').addEventListener('click', () => {
        attachments = attachments.filter((x) => x.id !== a.id);
        saveCurrentDraft();
        renderAttachChips();
        updateSendButtonState();
      });
      box.appendChild(chip);
    }
  }

  async function handleFiles(list) {
    if (!list || !list.length) return;
    if (attachments.length >= MAX_ATTACHMENTS) { toast('最多同时附加 ' + MAX_ATTACHMENTS + ' 个文件'); return; }
    const added = await window.FilesHelper.processFiles(list, (msg) => toast(msg, 4000));
    if (!added.length) return;
    let extra = added;
    if (attachments.length + added.length > MAX_ATTACHMENTS) {
      extra = added.slice(0, MAX_ATTACHMENTS - attachments.length);
      toast('最多同时附加 ' + MAX_ATTACHMENTS + ' 个文件，已截取部分');
    }
    attachments = attachments.concat(extra);
    saveCurrentDraft();
    renderAttachChips();
    updateComposeUI();
  }

  function onPaste(e) {
    const files = [];
    for (const item of (e.clipboardData ? e.clipboardData.items : [])) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      handleFiles(files);
    }
  }

  // ---------- 设置 ----------
  function toggleSttEngine() {
    const macos = $('set-sttEngine').value === 'macos';
    $('stt-cloud-fields').style.display = macos ? 'none' : '';
    $('stt-engine-hint').textContent = macos
      ? '使用 macOS 自带听写能力，离线识别、不上传录音。需在系统设置 → 键盘中开启听写；首次使用会请求语音识别权限。'
      : '录音会发送到你配置的云端接口识别，需要该服务自己的 API Key（与对话 Key 独立）。';
  }

  function openSettings() {
    if (voiceInput) voiceInput.cancel();
    els.setApiKey.value = state.settings.apiKey || '';
    els.setBaseURL.value = state.settings.baseURL || '';
    els.setModel.value = state.settings.model || '';
    const sttEngineSel = $('set-sttEngine');
    const macOption = sttEngineSel.querySelector('option[value="macos"]');
    if (!/Mac/.test(navigator.platform || navigator.userAgent) && macOption) macOption.remove();
    const sttEndpoint = state.settings.sttEndpoint || (macOption ? 'macos' : 'https://api.siliconflow.cn/v1/audio/transcriptions');
    sttEngineSel.value = sttEndpoint === 'macos' ? 'macos' : 'cloud';
    toggleSttEngine();
    $('set-sttApiKey').value = state.settings.sttApiKey || '';
    $('set-sttEndpoint').value = sttEndpoint === 'macos' ? 'https://api.siliconflow.cn/v1/audio/transcriptions' : sttEndpoint;
    $('set-sttModel').value = state.settings.sttModel || 'FunAudioLLM/SenseVoiceSmall';
    els.setReasoning.checked = !!state.settings.reasoningEnabled;
    els.setTemperature.value = state.settings.temperature != null ? state.settings.temperature : 0.7;
    els.tempVal.textContent = els.setTemperature.value;
    els.setSystemPrompt.value = state.settings.systemPrompt || '';
    renderSkillList();
    fillVoiceSelect().catch(() => {});
    fillAvatarModels().catch(() => {});
    applyMouthSpeed();
    if (els.setWebSearch) els.setWebSearch.checked = !!(state.settings && state.settings.webSearch);
    if (els.setWebSearchRounds) {
      els.setWebSearchRounds.value = String((state.settings && state.settings.webSearchRounds) || 3);
      if (els.roundsVal) els.roundsVal.textContent = els.setWebSearchRounds.value;
      if (els.fieldWebSearchRounds) els.fieldWebSearchRounds.style.display = (state.settings && state.settings.webSearch) ? '' : 'none';
    }
    if (els.setAvatarEnabled) els.setAvatarEnabled.checked = !!state.settings.avatarEnabled;
    if (els.setAvatarAutoSpeak) els.setAvatarAutoSpeak.checked = !!state.settings.avatarAutoSpeak;
    syncMarsControls();
    renderMarsProfileStatus();
    if (els.setAvatarRate) {
      els.setAvatarRate.value = String(state.settings.avatarRate != null ? state.settings.avatarRate : 1);
      if (els.rateVal) els.rateVal.textContent = Number(els.setAvatarRate.value).toFixed(1);
    }
    els.settingsOverlay.classList.remove('hidden');
    setTimeout(() => els.setApiKey.focus(), 50);
  }

  function closeSettings() {
    els.settingsOverlay.classList.add('hidden');
    applyElderMode();   // 取消「老年模式」预览，回到已保存的状态
  }

  function saveSettings() {
    const baseURL = els.setBaseURL.value.trim();
    const model = els.setModel.value.trim();
    if (!baseURL) { toast('请填写接口地址'); return; }
    if (!model) { toast('请填写模型名称'); return; }
    if ($('set-sttEngine').value === 'macos') {
      state.settings.sttEndpoint = 'macos';
      state.settings.sttApiKey = '';
      state.settings.sttModel = '';
    } else {
      const sttEndpoint = $('set-sttEndpoint').value.trim();
      const sttModel = $('set-sttModel').value.trim();
      try {
        const url = new URL(sttEndpoint);
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error();
        if (url.username || url.password) throw new Error();
      } catch (_) { toast('请填写 HTTPS 语音接口地址；本机测试允许 localhost HTTP。'); return; }
      if (!sttModel) { toast('请填写语音识别模型'); return; }
      state.settings.sttApiKey = $('set-sttApiKey').value.trim();
      state.settings.sttEndpoint = sttEndpoint;
      state.settings.sttModel = sttModel;
    }
    state.settings.apiKey = els.setApiKey.value.trim();
    state.settings.baseURL = baseURL;
    state.settings.model = model;
    state.settings.reasoningEnabled = els.setReasoning.checked;
    state.settings.temperature = parseFloat(els.setTemperature.value);
    state.settings.systemPrompt = els.setSystemPrompt.value;
    // 虚拟形象设置
    const prevEnabled = state.settings.avatarEnabled;
    const prevAuto = state.settings.avatarAutoSpeak;
    if (els.setAvatarEnabled) state.settings.avatarEnabled = els.setAvatarEnabled.checked;
    if (els.setAvatarAutoSpeak) state.settings.avatarAutoSpeak = els.setAvatarAutoSpeak.checked;
    if (els.setAvatarVoice) state.settings.avatarVoice = els.setAvatarVoice.value;
    if (els.setAvatarRate) state.settings.avatarRate = parseFloat(els.setAvatarRate.value);
    if (els.setTtsEngine) state.settings.ttsEngine = els.setTtsEngine.value;
    if (els.setTtsVoice && els.setTtsVoice.value) state.settings.ttsVoice = els.setTtsVoice.value;
    if (els.setTtsRate) state.settings.ttsRate = parseInt(els.setTtsRate.value, 10) || 0;
    if (els.setMouthSpeed) state.settings.avatarMouthSpeed = parseFloat(els.setMouthSpeed.value);
    if (els.setWebSearch) state.settings.webSearch = els.setWebSearch.checked;
    if (els.setWebSearchRounds) state.settings.webSearchRounds = parseInt(els.setWebSearchRounds.value, 10) || 3;
    applySpeechConfig();
    applyMouthSpeed();

    // 人群模式与口味档位（老年模式 / 辣 / 甜 / 咸 / 忌口过敏）
    // 老年模式 + 最高两档 → 先弹健康提醒，「确认并继续」后才落库
    const marsValues = marsControlsValues(settingsControls());
    const commit = () => {
      Object.assign(state.settings, marsValues);
      applyElderMode();
      window.niuai.setSettings(state.settings).then(() => {
        els.modelBadge.textContent = model;
        closeSettings();
        toast('设置已保存');
        if (prevEnabled !== state.settings.avatarEnabled) applyAvatarVisibility();
        if (prevAuto !== state.settings.avatarAutoSpeak) updateSpeakToggleUI();
        if (!currentConv() || currentConv().messages.length === 0) renderWelcome();
      });
    };
    maybeShowHealthWarning(marsValues, commit);
  }

  // ---------- 输入框 ----------
  function autoGrow() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 190) + 'px';
  }

  // ---------- 图片灯箱 ----------
  function ensureLightbox() {
    let ov = document.getElementById('lightbox');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'lightbox';
      ov.className = 'lightbox';
      ov.innerHTML = '<img alt="">';
      ov.addEventListener('click', () => ov.classList.remove('show'));
      document.body.appendChild(ov);
    }
    return ov;
  }
  document.addEventListener('click', (e) => {
    const img = e.target && e.target.closest && e.target.closest('.att-img img');
    if (img) {
      const ov = ensureLightbox();
      ov.querySelector('img').src = img.src;
      ov.classList.add('show');
    }
  });


  // ==================== 技能（Skills） ====================
  let skillBodies = {};      // id -> SKILL.md 正文
  let skillResources = {};   // id -> [{path,size}]
  let skillAutoText = {};    // id -> 自动注入的参考文件正文（体积小的时候）

  const enabledSkills = () => (state.settings && state.settings.skills ? state.settings.skills : []).filter((s) => s.enabled);

  // ==================== 火星小厨房：人设档案 / 人群模式 / 口味档位 ====================
  const marsReady = () => !!(window.Mars && state.marsProfile);

  /** 当前生效参数快照（调试句柄 / 提示面板用） */
  function marsSnapshot() {
    return window.Mars ? window.Mars.snapshot(state.settings) : { versionLabel: '普通版', avoid: '' };
  }

  /** 统计某个对话的工具调用次数（Control 面板「工具调用计数」） */
  function marsCounts(conv) {
    const c = { search: 0, fetch: 0, skill: 0, total: 0 };
    if (!conv) return c;
    for (const st of collectSearchSteps(conv)) {
      if (st.type === 'search') c.search++;
      else if (st.type === 'fetch') c.fetch++;
      else if (st.type === 'skill') c.skill++;
    }
    c.total = c.search + c.fetch + c.skill;
    return c;
  }

  /**
   * 渲染助手回答：只显示正文。
   * 模型若仍吐出旧的【主体回答】/【提示信息】结构，这里会自动剥掉——
   * 参数快照与联网搜索次数不再出现在回答里（搜索次数仍由气泡上的搜索框展示）。
   */
  function marsAnswerHtml(m, streamingNow) {
    const raw = (m && m.content) || '';
    const parsed = window.Mars ? window.Mars.parseOutput(raw) : { body: raw };
    return Markdown.render(parsed.body) + (streamingNow ? '<span class="typing-cursor"></span>' : '');
  }

  // ---- 人群模式 / 口味档位控件（首次启动弹窗 + 设置面板共用同一份状态） ----

  /** 是否处于老年模式（决定加载 shtu 人设 + 整体放大字号） */
  const elderModeOn = () => !!(state.settings && state.settings.marsVersion === 'elderly');

  /** 老年模式预览：只切 body class（弹窗内即时看到字号变化，不写 settings） */
  function previewElderMode(on) {
    document.body.classList.toggle('elder-mode', !!on);
  }

  /** 按 settings 里的老年模式应用字号 */
  function applyElderMode() {
    previewElderMode(elderModeOn());
    return elderModeOn();
  }

  /** 填充档位下拉（0-4 档，文案与 档位映射.md 一致） */
  function fillLevelSelect(el, kind, value) {
    if (!el || !window.Mars) return;
    const def = window.Mars.LEVELS[kind];
    el.innerHTML = def.names.map((n, i) => '<option value="' + i + '">' + escapeHtml(n) + '</option>').join('');
    el.value = String(Math.max(0, Math.min(def.max, Math.round(Number(value) || 0))));
  }

  const ONBOARD_DEFAULTS = { elderly: false, spicy: 0, sweet: 0, salty: 0, avoid: '' };

  /** 把一组参数值写进一组控件（不改 settings） */
  function setControls(c, v) {
    if (!c) return;
    if (c.elder) c.elder.checked = !!v.elderly;
    fillLevelSelect(c.spicy, 'spicy', v.spicy);
    fillLevelSelect(c.sweet, 'sweet', v.sweet);
    fillLevelSelect(c.salty, 'salty', v.salty);
    if (c.avoid) c.avoid.value = v.avoid || '';
  }

  const onboardControls = () => ({ elder: els.obElder, spicy: els.obSpicy, sweet: els.obSweet, salty: els.obSalty, avoid: els.obAvoid });
  const settingsControls = () => ({ elder: els.setElder, spicy: els.setSpicy, sweet: els.setSweet, salty: els.setSalty, avoid: els.setAvoid });

  /** 把 settings 同步到「首次启动弹窗」与「设置面板」两套控件 */
  function syncMarsControls() {
    if (!window.Mars) return;
    const s = state.settings || {};
    const v = {
      elderly: s.marsVersion === 'elderly',
      spicy: s.marsSpicy, sweet: s.marsSweet, salty: s.marsSalty,
      avoid: s.marsAvoid || '',
    };
    setControls(onboardControls(), v);
    setControls(settingsControls(), v);
  }

  /** 读取一组控件 → 参数值（不写回 settings，供确认前先做健康检查） */
  function marsControlsValues(c) {
    const lv = (el) => Math.max(0, Math.min(4, parseInt(el && el.value, 10) || 0));
    return {
      marsVersion: (c.elder && c.elder.checked) ? 'elderly' : 'normal',
      marsSpicy: lv(c.spicy),
      marsSweet: lv(c.sweet),
      marsSalty: lv(c.salty),
      marsAvoid: String((c.avoid && c.avoid.value) || '').trim().slice(0, 500),
    };
  }

  // ---- 老年模式高档位健康提醒（辣/甜/咸最高两档） ----

  /** 待确认时保存「确认并继续」要执行的动作 */
  let healthConfirmAction = null;

  /**
   * 老年模式 + 辣/甜/咸选了最上面两档 → 弹健康提醒
   * 「返回修改」＝关掉弹窗留在原表单继续改；「确认并继续」＝执行 onConfirm
   * @param {object} pendingValues 待生效的参数值（尚未写入 settings）
   * @param {Function} onConfirm   用户确认后执行
   * @returns {boolean} 是否弹出了提醒
   */
  function maybeShowHealthWarning(pendingValues, onConfirm) {
    const probe = Object.assign({}, state.settings, pendingValues || {});
    const risks = window.Mars ? window.Mars.healthRisks(probe) : [];
    if (!risks.length || !els.healthOverlay) {
      onConfirm();
      return false;
    }
    if (els.healthList) {
      els.healthList.innerHTML = risks.map((r) =>
        '<div class="health-item">' +
          '<b>' + escapeHtml(r.label + ' ' + r.level + ' · ' + r.name) + '</b>' +
          '<span>' + escapeHtml(r.text) + '</span>' +
        '</div>').join('');
    }
    healthConfirmAction = onConfirm;
    els.healthOverlay.classList.remove('hidden');
    return true;
  }

  function closeHealthWarning() {
    if (els.healthOverlay) els.healthOverlay.classList.add('hidden');
    healthConfirmAction = null;
  }

  function bindHealthWarning() {
    if (els.healthBack) {
      els.healthBack.addEventListener('click', () => {
        closeHealthWarning();
        toast('可以继续调整档位，调好后再确认');
      });
    }
    if (els.healthOk) {
      els.healthOk.addEventListener('click', () => {
        const fn = healthConfirmAction;
        if (els.healthOverlay) els.healthOverlay.classList.add('hidden');
        healthConfirmAction = null;
        if (fn) fn();
      });
    }
  }

  /** 恢复默认：普通模式；辣0 甜0 咸0；忌口为空（只改控件，由弹窗/设置面板的确认按钮落库） */
  function resetMarsParams(scope) {
    setControls(scope === 'settings' ? settingsControls() : onboardControls(), ONBOARD_DEFAULTS);
    if (scope !== 'settings') previewElderMode(false);
    toast('已恢复默认：普通模式 · 辣0 甜0 咸0 · 忌口为空');
  }

  // ---- 首次启动引导弹窗 ----
  function openOnboard() {
    if (!els.onboardOverlay) return;
    syncMarsControls();
    els.onboardOverlay.classList.remove('hidden');
  }

  function closeOnboard() {
    if (els.onboardOverlay) els.onboardOverlay.classList.add('hidden');
  }

  /** 首次打开 App（settings 里没有 marsOnboarded 标记）时弹出设置向导 */
  function maybeShowOnboard() {
    if (!els.onboardOverlay) return false;
    if (state.settings && state.settings.marsOnboarded === true) return false;
    openOnboard();
    return true;
  }

  /** 预加载人设档案（Skill.md / A.md / shtu / 档位映射） */
  async function loadMarsProfile(force) {
    if (!window.Mars) return null;
    const p = await window.Mars.load(force);
    state.marsProfile = p;
    renderMarsProfileStatus();
    return p;
  }

  /** 首次启动弹窗 / 设置面板里的人群模式与档位控件：事件绑定 */
  function bindMarsControls() {
    if (!window.Mars) return;

    // 老年模式开关：只做字号预览，确认后（开始使用 / 保存）才写回 settings
    if (els.obElder) {
      els.obElder.addEventListener('change', () => {
        previewElderMode(els.obElder.checked);
        toast(els.obElder.checked ? '已开启老年模式：字号放大 + 长辈称呼 + 居家安全提醒' : '已关闭老年模式');
      });
    }
    if (els.setElder) {
      els.setElder.addEventListener('change', () => previewElderMode(els.setElder.checked));
    }

    if (els.obDefaults) els.obDefaults.addEventListener('click', () => resetMarsParams('onboard'));
    if (els.obSave) {
      els.obSave.addEventListener('click', () => {
        const values = marsControlsValues(onboardControls());
        // 老年模式 + 辣/甜/咸最高两档 → 先弹健康提醒，确认后才落库
        maybeShowHealthWarning(values, () => {
          Object.assign(state.settings, values);
          state.settings.marsOnboarded = true;
          applyElderMode();
          window.niuai.setSettings(state.settings).catch(() => {});
          closeOnboard();
          toast('设置已保存，随时可在「设置」里修改');
        });
      });
    }
    bindHealthWarning();

    // 人设档案（System Prompt 素材）管理
    if (els.btnMarsFolder) els.btnMarsFolder.addEventListener('click', () => window.niuai.marsOpenFolder());
    if (els.btnMarsReload) {
      els.btnMarsReload.addEventListener('click', async () => {
        await loadMarsProfile(true);
        toast('人设档案已重新加载');
      });
    }
    if (els.btnMarsReset) {
      els.btnMarsReset.addEventListener('click', async () => {
        const ok = window.confirm('确定恢复出厂人设档案吗？\n将用随包内容覆盖 mars_profile/ 里对 Skill.md / A.md / shtu / 档位映射.md 的修改。');
        if (!ok) return;
        await window.niuai.marsResetProfile();
        await loadMarsProfile(true);
        toast('已恢复出厂人设档案');
      });
    }
  }

  function renderMarsProfileStatus() {
    const box = els.marsProfileStatus;
    if (!box) return;
    const info = window.Mars ? window.Mars.profileInfo() : { hasProfile: false };
    if (!info.hasProfile) { box.textContent = '人设档案状态：未加载'; return; }
    const mark = (x) => (x ? '✓ ' + x.file + '（' + x.chars + ' 字）' : '✗ 缺失');
    box.innerHTML = '人设档案：Skill.md ' + mark(info.skill) + ' · A.md ' + mark(info.personaNormal) +
      ' · shtu ' + mark(info.personaElderly) + ' · 档位映射 ' + mark(info.levels) +
      (info.dir ? '<br>目录：' + escapeHtml(info.dir) : '');
  }

  /**
   * 解析本轮使用的 system prompt（火星小厨房 架构）：
   *   完整 System Prompt = Skill.md 全文 +（A.md / shtu 二选一）+ 档位映射规则 + 用户当前参数快照
   *   技能提示词（若启用）与全局系统提示词追加在其后 —— 保留 PerPer 既有能力：
   *   技能提示词仍然优先于全局系统提示词。
   */
  function resolveSystemPrompt(userText) {
    const marsPrompt = marsReady()
      ? window.Mars.buildSystemPrompt(state.marsProfile, state.settings, { userText: userText })
      : '';
    const fromSkills = enabledSkills().map((s) => (s.prompt || '').trim()).filter(Boolean);
    const tail = fromSkills.length
      ? fromSkills
      : [(state.settings && state.settings.systemPrompt ? state.settings.systemPrompt : '').trim()].filter(Boolean);
    return [marsPrompt].concat(tail).filter(Boolean).join('\n\n');
  }

  /** 启用技能的说明文本（注入到 system 消息里）*/
  function buildSkillsContext() {
    const on = enabledSkills().filter((s) => !s.missing);
    if (!on.length) return '';
    const blocks = [];
    for (const s of on) {
      const body = (skillBodies[s.id] || '').trim();
      let b = '### 技能：' + s.name + '（id: ' + s.id + '）';
      if (body) b += '\n' + body.slice(0, 4000);
      const res = skillResources[s.id] || [];
      if (res.length) {
        b += '\n\n资源文件（用 read_skill_file 工具读取，skill 传 "' + s.id + '"）：\n' +
          res.map((r) => '- ' + r.path + '（' + Math.max(1, Math.round((r.size || 0) / 1024)) + 'KB）').join('\n');
      }
      const auto = skillAutoText[s.id];
      if (auto) b += '\n\n以下为技能参考内容：\n' + auto;
      blocks.push(b);
    }
    if (!blocks.length) return '';
    return '你可以使用以下技能（Skills）：在相关时按其中的要求工作。\n\n' + blocks.join('\n\n');
  }

  /** 拉取已安装技能（磁盘）并与设置里的开关/提示词合并 */
  async function loadSkills(autoMerge) {
    let installed = [];
    try { installed = (await window.niuai.skillsList()) || []; } catch (_) {}
    const saved = (state.settings && state.settings.skills) || [];
    const merged = installed.map((sk) => {
      const prev = saved.find((x) => x.id === sk.id) || {};
      return {
        id: sk.id, name: sk.name, description: sk.description,
        enabled: !!prev.enabled,
        prompt: prev.prompt || '',
      };
    });
    // 磁盘上找不到的技能「保留」在设置里（标记 missing），避免误删用户的提示词配置
    const missing = saved.filter((x) => !installed.some((sk) => sk.id === x.id))
      .map((x) => Object.assign({}, x, { missing: true }));
    const all = merged.concat(missing);
    if (autoMerge && JSON.stringify(all) !== JSON.stringify(saved)) {
      state.settings.skills = all;
      window.niuai.setSettings(state.settings).catch(() => {});
    } else {
      state.settings.skills = all;
    }
    // 缓存正文与资源清单
    skillBodies = {}; skillResources = {}; skillAutoText = {};
    for (const sk of installed) {
      if (sk.body) skillBodies[sk.id] = sk.body;
      if (sk.resources && sk.resources.length) skillResources[sk.id] = sk.resources;
    }
    // 参考文件体积不大时，直接读进上下文（小知识库无需模型自己读文件）
    for (const sk of installed) {
      const res = sk.resources || [];
      const total = res.reduce((a, r) => a + (r.size || 0), 0);
      if (!res.length || total > 14000) continue;
      const parts = [];
      for (const r of res.slice(0, 6)) {
        try {
          const rr = await window.niuai.skillsRead({ id: sk.id, file: r.path });
          if (rr && rr.ok && rr.text) parts.push('#### ' + rr.file + '\n' + rr.text.slice(0, 9000));
        } catch (_) {}
      }
      if (parts.length) skillAutoText[sk.id] = parts.join('\n\n');
    }
    renderSkillList();
    return all;
  }

  function renderSkillList() {
    const box = els.skillList;
    if (!box) return;
    const list = (state.settings && state.settings.skills) || [];
    box.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'skill-empty';
      empty.textContent = '还没有安装技能 —— 点「＋ 安装技能…」选择文件夹 / SKILL.md / .zip';
      box.appendChild(empty);
      return;
    }
    for (const sk of list) {
      const item = document.createElement('div');
      item.className = 'skill-item' + (sk.enabled ? ' on' : '');
      item.innerHTML =
        '<div class="skill-head">' +
          '<div class="skill-info">' +
            '<div class="skill-name">' + escapeHtml(sk.name) + '</div>' +
            '<div class="skill-desc">' + escapeHtml(sk.missing ? '技能文件已不在磁盘上（可重新安装，提示词配置已为你保留）' : (sk.description || '（无描述）')) + '</div>' +
          '</div>' +
          (sk.missing ? '<span class="skill-badge" style="background:rgba(229,72,77,.15);color:#e5484d">未找到</span>' : '') +
          (sk.prompt ? '<span class="skill-badge">自定义提示词</span>' : '') +
          '<label class="switch" title="是否使用该技能">' +
            '<input type="checkbox" ' + (sk.enabled ? 'checked' : '') + '>' +
            '<span class="slider"></span>' +
          '</label>' +
        '</div>' +
        '<div class="skill-body">' +
          '<textarea class="skill-prompt" rows="3" placeholder="可选：该技能的系统提示词（填写后将优先于全局系统提示词）">' + escapeHtml(sk.prompt || '') + '</textarea>' +
          '<div class="skill-actions">' +
            '<button class="btn-secondary btn-sm skill-save">保存提示词</button>' +
            '<button class="btn-secondary btn-sm skill-remove">移除技能</button>' +
          '</div>' +
        '</div>';

      const cb = item.querySelector('input[type=checkbox]');
      cb.addEventListener('change', () => {
        sk.enabled = cb.checked;
        item.classList.toggle('on', sk.enabled);
        window.niuai.setSettings(state.settings).catch(() => {});
        toast(sk.enabled ? '已启用技能「' + sk.name + '」' : '已停用技能「' + sk.name + '」');
      });
      const ta = item.querySelector('.skill-prompt');
      ta.addEventListener('input', () => { sk.prompt = ta.value; });
      item.querySelector('.skill-save').addEventListener('click', () => {
        sk.prompt = ta.value;
        window.niuai.setSettings(state.settings).catch(() => {});
        renderSkillList();
        toast('技能提示词已保存');
      });
      item.querySelector('.skill-remove').addEventListener('click', async () => {
        const r = await window.niuai.skillsRemove(sk.id);
        if (r && r.ok) {
          state.settings.skills = (state.settings.skills || []).filter((x) => x.id !== sk.id);
          window.niuai.setSettings(state.settings).catch(() => {});
          renderSkillList();
          toast('已移除技能「' + sk.name + '」');
        } else {
          toast('移除失败：' + ((r && r.error) || '未知错误'));
        }
      });
      box.appendChild(item);
    }
  }

  async function installSkill() {
    const r = await window.niuai.skillsInstall({});
    if (!r || r.canceled) return;
    if (!r.ok) { toast('安装失败：' + (r.error || '未知错误')); return; }
    await loadSkills(true);
    const sk = (state.settings.skills || []).find((x) => x.id === r.skill.id) || r.skill;
    if (sk) {
      sk.enabled = true;                       // 新装默认启用
      if (r.skill.body) skillBodies[sk.id] = r.skill.body;
      state.settings.skills = (state.settings.skills || []).map((x) => (x.id === sk.id ? sk : x));
      if (!state.settings.skills.some((x) => x.id === sk.id)) state.settings.skills.push(sk);
      window.niuai.setSettings(state.settings).catch(() => {});
      renderSkillList();
    }
    toast('已安装并启用技能「' + (r.skill.name || r.skill.id) + '」');
  }

  // ==================== 虚拟形象 & 语音播报 ====================
  const avatar = {
    handle: null,
    ready: false,
    loading: false,
    lastSpoken: '',      // 最后播报的文本（避免重复播报）
  };

  function setAvatarStatus(mode) {
    const map = { idle: '待机中', thinking: '思考中…', speaking: '正在播报…' };
    if (els.avatarStatus) {
      els.avatarStatus.textContent = map[mode] || '待机中';
      els.avatarStatus.className = 'avatar-status' + (mode === 'idle' ? '' : ' ' + mode);
    }
    if (els.avatarPanel) els.avatarPanel.classList.toggle('speaking', mode === 'speaking');
  }

  /** 加载（或切换）人物模型；force=true 用于换模型时重载 */
  async function initAvatar(force) {
    if (!window.NiuAvatar3D || !els.avatarCanvas) return;
    if (avatar.loading) return;
    if (avatar.handle && !force) return;
    avatar.loading = true;
    const modelFile = (state.settings && state.settings.avatarModel) || '';
    try {
      const info = await window.niuai.avatarInfo(modelFile);
      if (!info || !info.ok) throw new Error((info && info.error) || '未找到人物模型文件');
      // 原模型已不存在（如被删除/替换）→ 自动切换到可用模型并写回设置
      if (info.file && info.file !== state.settings.avatarModel) {
        state.settings.avatarModel = info.file;
        window.niuai.setSettings(state.settings).catch(() => {});
      }
      if (els.avatarLoading) {
        els.avatarLoading.innerHTML = '<div class="avatar-spinner"></div><span>正在唤醒形象…</span>';
        els.avatarLoading.classList.remove('hidden');
      }
      if (avatar.handle) disposeAvatar();
      avatar.handle = window.NiuAvatar3D.create(els.avatarCanvas);
      const buf = await window.niuai.loadAvatar(modelFile);
      const model = await avatar.handle.load(buf);
      avatar.ready = true;
      const meta = model && model.meta ? model.meta : {};
      if (els.avatarName) els.avatarName.textContent = avatarDisplayName(info.file, meta.name);
      els.avatarLoading.classList.add('hidden');
      setAvatarStatus('idle');
      bindAvatarPointer();
      applyMouthSpeed();
      applyAvatarBackground(info.file);
      const st = avatar.handle.stats();
      if (!st.visemeOpenCount && (!st.visemeMap || Object.keys(st.visemeMap).length === 0)) {
        toast('该模型未找到口型表情，播报时嘴部不会动', 4000);
      }
    } catch (e) {
      if (els.avatarLoading) {
        els.avatarLoading.innerHTML = '<span>形象加载失败：' + escapeHtml(e.message || String(e)) + '</span>';
        els.avatarLoading.classList.remove('hidden');
      }
      toast('人物模型加载失败：' + (e.message || e));
    } finally {
      avatar.loading = false;
    }
  }

  /** 列出可用模型 → 填充下拉框 */
  async function fillAvatarModels(keepValue) {
    if (!els.setAvatarModel || !window.niuai.avatarList) return;
    try {
      const list = await window.niuai.avatarList();
      const cur = keepValue || (state.settings && state.settings.avatarModel) || '';
      els.setAvatarModel.innerHTML = (list || []).map((v) => {
        const shown = AVATAR_NAMES[v.file];
        const label = shown
          ? shown + '（' + v.file + ' · ' + Math.round(v.size / 1048576) + 'MB）'
          : v.file + '（' + Math.round(v.size / 1048576) + 'MB' + (v.builtin ? '' : ' · 自定义') + '）';
        return '<option value="' + escapeHtml(v.file) + '">' + escapeHtml(label) + '</option>';
      }).join('') || '<option value="">（未找到 .vrm 模型）</option>';
      if (cur && (list || []).some((v) => v.file === cur)) els.setAvatarModel.value = cur;
    } catch (_) {}
  }

  /** 鼠标在画布上移动 → 角色视线跟随；点击 → 微笑 + 打招呼 */
  let avatarPointerBound = false;
  function bindAvatarPointer() {
    const canvas = els.avatarCanvas;
    if (avatarPointerBound) return;
    avatarPointerBound = true;
    canvas.addEventListener('mousemove', (e) => {
      if (!avatar.handle) return;
      const r = canvas.getBoundingClientRect();
      const dx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      const dy = ((e.clientY - r.top) / r.height - 0.5) * -2;
      avatar.handle.look(dx, dy);
    });
    canvas.addEventListener('mouseleave', () => { avatar.handle && avatar.handle.look(0, 0); });
    canvas.addEventListener('click', () => {
      if (!avatar.handle) return;
      if (avatar.handle.wasDragged && avatar.handle.wasDragged()) return;   // 拖动旋转时不要触发表情
      avatar.handle.setExpression('happy', 0.85);
      setTimeout(() => avatar.handle && avatar.handle.setExpression('happy', 0), 1200);
    });
  }

  /** 让形象播报一段文本 */
  function speakText(text, opts) {
    if (voiceInput && voiceInput.state().requestId) voiceInput.cancel();
    const o = opts || {};
    const cleaned = window.Speech ? window.Speech.clean(text) : '';
    if (!cleaned) { toast('没有可播报的内容'); return false; }
    if (!window.Speech || !window.Speech.isSupported()) { toast('当前环境不支持语音播报'); return false; }
    avatar.lastSpoken = text;
    if (!avatar.ready) { if (!avatar.loading) initAvatar(); }  // 形象仍在加载时也允许播报
    setAvatarStatus('speaking');
    if (avatar.handle) avatar.handle.setMood('speaking');
    window.Speech.speak(text, {
      onChunk: (chunkText, durationMs, boundaries) => {
        // 每块开始时生成口型轨道；Edge 引擎用词边界时间轴 + 真实音频时长精确对齐
        if (avatar.handle) avatar.handle.beginSpeech(chunkText, { durationMs, boundaries });
        setAvatarStatus('speaking');
      },
      onFallback: (info) => {
        const why = info && info.reason ? info.reason : 'Edge 语音不可用';
        toast(why + '，已切换到系统语音', 4000);
      },
      onUnsupported: () => toast('当前环境不支持语音播报'),
    }).catch((error) => {
      stopSpeaking();
      if (voiceInput) voiceInput.cancel('语音播报失败，请点击麦克风重试。');
      toast('语音播报失败：' + error.message);
    });
    return true;
  }

  function stopSpeaking() {
    if (window.Speech) window.Speech.stop();
    if (avatar.handle) avatar.handle.endSpeech();
    setAvatarStatus(isAnyThinking() ? 'thinking' : 'idle');
  }

  function isAnyThinking() {
    const conv = currentConv();
    return !!(conv && isStreaming(conv.id));
  }

  // 语音事件：播报结束 → 回到待机/思考状态
  if (window.Speech) {
    window.Speech.on('error', (event) => {
      if (voiceInput) voiceInput.cancel('语音播报失败，连续对话已暂停。');
      toast(event.message || '语音播报失败，请检查声音设备。');
    });
    window.Speech.on('end', () => {
      if (avatar.handle) avatar.handle.endSpeech();
      setAvatarStatus(isAnyThinking() ? 'thinking' : 'idle');
      if (voiceInput) voiceInput.playbackEnded();
    });
    if (els.setAvatarRate) {
      els.setAvatarRate.addEventListener('input', () => {
        if (els.rateVal) els.rateVal.textContent = Number(els.setAvatarRate.value).toFixed(1);
      });
    }
  }

  /** 把设置同步到语音模块 */
  const mouthSpeedLabel = (v) => (v <= 0.65 ? '很慢' : v <= 0.85 ? '慢' : v < 1.05 ? '正常' : v < 1.3 ? '较快' : '快');

  /** 把口型速度同步到形象句柄 */
  function applyMouthSpeed() {
    const v = state.settings && state.settings.avatarMouthSpeed != null ? state.settings.avatarMouthSpeed : 0.75;
    if (avatar.handle && avatar.handle.setMouthSpeed) avatar.handle.setMouthSpeed(v);
    if (els.setMouthSpeed) els.setMouthSpeed.value = String(v);
    if (els.mouthSpeedVal) els.mouthSpeedVal.textContent = mouthSpeedLabel(v);
  }

  function applySpeechConfig() {
    if (!window.Speech || !state.settings) return;
    window.Speech.configure({
      engine: state.settings.ttsEngine || 'edge',
      voice: state.settings.ttsVoice || 'zh-CN-XiaoxiaoNeural',
      rate: state.settings.ttsRate != null ? state.settings.ttsRate : 0,
      volume: state.settings.ttsVolume != null ? state.settings.ttsVolume : 0,
      systemVoice: state.settings.avatarVoice || '',
      systemRate: Number(state.settings.avatarRate) || 1,
    });
  }

  async function fillVoiceSelect() {
    if (!window.Speech) return;
    const engine = (state.settings && state.settings.ttsEngine) || 'edge';
    if (els.setTtsEngine) els.setTtsEngine.value = engine;
    const edgeOn = engine === 'edge';
    if (els.fieldTtsVoice) els.fieldTtsVoice.style.display = edgeOn ? '' : 'none';
    if (els.fieldTtsRate) els.fieldTtsRate.style.display = edgeOn ? '' : 'none';
    if (els.fieldSystemVoice) els.fieldSystemVoice.style.display = edgeOn ? 'none' : '';
    if (els.fieldSystemRate) els.fieldSystemRate.style.display = edgeOn ? 'none' : '';

    // Edge 语音列表
    if (els.setTtsVoice) {
      const rec = window.Speech.recommendedVoices();
      const labels = {
        'zh-CN-XiaoxiaoNeural': '晓晓 · 中文女声（温暖）',
        'zh-CN-XiaoyiNeural': '晓伊 · 中文女声（活泼）',
        'en-US-AvaMultilingualNeural': 'Ava · 中英双语女声',
        'en-US-EmmaMultilingualNeural': 'Emma · 中英双语女声',
      };
      els.setTtsVoice.innerHTML = rec.map((v) => {
        const label = labels[v.name] || (v.name + ' · ' + v.locale + ' · ' + (v.gender === 'Female' ? '女声' : '男声'));
        return '<option value="' + escapeHtml(v.name) + '">' + escapeHtml(label) + '</option>';
      }).join('') || '<option value="">（未获取到语音列表）</option>';
      const want = (state.settings && state.settings.ttsVoice) || 'zh-CN-XiaoxiaoNeural';
      if (rec.some((v) => v.name === want)) els.setTtsVoice.value = want;
      else if (rec.length) els.setTtsVoice.value = rec[0].name;
    }
    if (els.setTtsRate) {
      const r = state.settings && state.settings.ttsRate != null ? state.settings.ttsRate : 0;
      els.setTtsRate.value = String(r);
      if (els.ttsRateVal) els.ttsRateVal.textContent = (r > 0 ? '+' : '') + r + '%';
    }
    // 系统语音列表
    if (els.setAvatarVoice) {
      const list = window.Speech.systemVoices();
      const cur = (state.settings && state.settings.avatarVoice) || '';
      els.setAvatarVoice.innerHTML = '<option value="">自动（系统默认中文语音）</option>' +
        list.map((v) => '<option value="' + escapeHtml(v.name) + '">' + escapeHtml(v.name) + ' · ' + escapeHtml(v.lang) + '</option>').join('');
      els.setAvatarVoice.value = cur;
    }
    if (els.setAvatarRate) {
      els.setAvatarRate.value = String(state.settings && state.settings.avatarRate != null ? state.settings.avatarRate : 1);
      if (els.rateVal) els.rateVal.textContent = Number(els.setAvatarRate.value).toFixed(1);
    }
    // Edge 可用性状态
    if (els.ttsStatus) {
      const st = await window.Speech.edgeStatus();
      els.ttsStatus.textContent = st.available
        ? ('Edge 语音可用 · ' + (st.info && st.info.version ? st.info.version : '') + ' · ' + st.voices + ' 个语音')
        : ('Edge 语音不可用（' + ((st.info && st.info.reason) || '未安装 edge-tts') + '）· 将使用系统语音');
    }
  }

  function applyAvatarVisibility() {
    const on = !!(state.settings && state.settings.avatarEnabled);
    els.avatarPanel.classList.toggle('hidden', !on);
    if (on) {
      initAvatar();
    } else {
      stopSpeaking();
      disposeAvatar();
      applyAvatarBackground(null);
    }
  }

  /** 人物形象背景：仅火星姐有，其他模型清除 */
  function applyAvatarBackground(modelFile) {
    const stage = document.querySelector('.avatar-stage');
    if (!stage) return;
    if (modelFile === AVATAR_BG_MODEL) {
      stage.style.backgroundImage = 'url("' + AVATAR_BG_PICK + '")';
      stage.style.backgroundSize = 'cover';
      stage.style.backgroundPosition = 'center';
      stage.classList.add('has-bg');
    } else {
      stage.style.backgroundImage = '';
      stage.style.backgroundSize = '';
      stage.style.backgroundPosition = '';
      stage.classList.remove('has-bg');
    }
  }

  /** 释放 3D 资源（关闭人物 / 切换模型时用），并换上全新画布便于重建 */
  function disposeAvatar() {
    if (avatar.handle) {
      try { avatar.handle.dispose(); } catch (_) {}
      avatar.handle = null;
    }
    avatar.ready = false;
    if (els.avatarCanvas && els.avatarCanvas.parentNode) {
      const fresh = els.avatarCanvas.cloneNode(false);
      els.avatarCanvas.parentNode.replaceChild(fresh, els.avatarCanvas);
      els.avatarCanvas = fresh;
      avatarPointerBound = false;
    }
    if (els.avatarLoading) els.avatarLoading.classList.remove('hidden');
  }

  /** 只更新发送/停止按钮状态（不重载草稿，避免输入时打断光标）*/
  function updateSendButtonState() {
    if (!els.btnSend) return;
    const streaming = isStreaming(state.currentId);
    els.btnSend.classList.toggle('stop', streaming);
    els.btnSend.innerHTML = streaming ? SVG_STOP : SVG_SEND;
    els.btnSend.title = streaming ? '停止生成（仅停止当前对话）' : '发送 (Enter)';
    const canSend = !!state.currentId && !streaming && (!!els.input.value.trim() || attachments.length > 0);
    els.btnSend.disabled = !canSend && !streaming;
  }

  function updateSearchToggleUI() {
    if (!els.btnWebSearch) return;
    const on = !!(state.settings && state.settings.webSearch);
    els.btnWebSearch.classList.toggle('active', on);
    els.btnWebSearch.style.color = on ? 'var(--accent)' : 'var(--text-tertiary)';
    els.btnWebSearch.style.opacity = on ? '1' : '0.55';
    els.btnWebSearch.title = on ? '联网搜索：已开启（点击关闭）' : '联网搜索：已关闭（点击开启）';
  }

  function updateSpeakToggleUI() {
    const on = !!(state.settings && state.settings.avatarAutoSpeak);
    els.btnSpeakToggle.classList.toggle('muted', !on);
    els.btnSpeakToggle.title = on ? '自动播报 AI 输出：开' : '自动播报 AI 输出：关';
    els.btnSpeakToggle.style.color = on ? 'var(--accent)' : 'var(--text-tertiary)';
    els.btnSpeakToggle.style.opacity = on ? '1' : '0.55';
  }


  // ==================== 文件夹视图 / 对话窗口 / 分叉 ====================
  const FOLDER_ICON_IDS = ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17'];

  /** 只给「火星姐」形象配背景图（每次启动随机一张）*/
  const AVATAR_BG_MODEL = 'Martian.vrm';
  const AVATAR_BG_FILES = ['assets/bg/bg-1.jpg', 'assets/bg/bg-2.jpg', 'assets/bg/bg-3.jpg'];
  const AVATAR_BG_PICK = AVATAR_BG_FILES[Math.floor(Math.random() * AVATAR_BG_FILES.length)];   // 每次打开随机

  /** 人物模型的显示名（可覆盖 VRM 元数据里的名字）*/
  const AVATAR_NAMES = {
    'Martian.vrm': '火星姐',
  };
  const avatarDisplayName = (file, fallback) =>
    AVATAR_NAMES[file] || fallback || String(file || '').replace(/\.vrm$/i, '');
  const iconPath = (id) => 'assets/folder-icons/' + (FOLDER_ICON_IDS.includes(String(id)) ? id : FOLDER_ICON_IDS[0]) + '.png';
  const randomIconId = () => FOLDER_ICON_IDS[Math.floor(Math.random() * FOLDER_ICON_IDS.length)];

  /** 为没有图标的对话随机分配（一次绑定，之后不再变） */
  function migrateIcons() {
    let changed = false;
    for (const c of state.conversations) {
      if (!c.icon || !FOLDER_ICON_IDS.includes(String(c.icon))) { c.icon = randomIconId(); changed = true; }
    }
    if (changed) persist();
  }

  function viewMode() { return (state.settings && state.settings.viewMode) || 'list'; }

  function setViewMode(mode) {
    if (voiceInput) voiceInput.cancel();
    state.settings.viewMode = mode === 'folder' ? 'folder' : 'list';
    window.niuai.setSettings(state.settings).catch(() => {});
    applyViewMode();
  }

  function applyViewMode() {
    const folder = viewMode() === 'folder';
    document.getElementById('folder-view').classList.toggle('hidden', !folder);
    document.getElementById('main').classList.toggle('hidden', folder);
    document.getElementById('sidebar').classList.toggle('hidden', folder);
    if (els.avatarPanel) els.avatarPanel.classList.toggle('hidden', folder || !(state.settings && state.settings.avatarEnabled));
    windowLayer().classList.toggle('hidden', !folder);
    if (folder) {
      renderFolderGrid();
      if (state.currentId) selectFolder(state.currentId);
    } else {
      closeAllWindows();
      renderMessages();
    }
    const btn = els.btnViewToggle;
    if (btn) {
      btn.title = folder ? '切换为列表显示' : '切换为文件夹显示';
      btn.classList.toggle('active', folder);
    }
  }

  const windowLayer = () => document.getElementById('window-layer');

  function renderFolderGrid() {
    const grid = els.folderGrid;
    if (!grid || viewMode() !== 'folder') return;
    const list = state.conversations;
    const count = document.getElementById('folder-count');
    if (count) count.textContent = '（' + list.length + ' 个）';
    grid.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'folder-empty';
      empty.textContent = '还没有对话 —— 点右上角「＋ 新建对话」开始';
      grid.appendChild(empty);
      return;
    }
    for (const c of list) {
      const card = document.createElement('div');
      card.className = 'folder-card' + (c.id === state.folderSelection ? ' selected' : '');
      card.dataset.id = c.id;
      const msgs = c.messages || [];
      card.innerHTML =
        '<img src="' + iconPath(c.icon) + '" alt="" draggable="false">' +
        '<div class="fc-name" title="' + escapeHtml(c.title) + '">' + escapeHtml(c.title) + '</div>' +
        '<div class="fc-meta">' + msgs.length + ' 条 · ' + relTime(c.updatedAt) + '</div>';
      card.addEventListener('mousedown', (e) => { if (e.button === 0) selectFolder(c.id, e); });
      card.addEventListener('dblclick', () => openConversationWindow(c.id));
      card.addEventListener('contextmenu', (e) => { e.preventDefault(); selectFolder(c.id); showFolderMenu(e.clientX, e.clientY, c.id); });
      grid.appendChild(card);
    }
  }

  function selectFolder(convId, e) {
    state.folderSelection = convId;
    for (const el of document.querySelectorAll('.folder-card')) el.classList.toggle('selected', el.dataset.id === convId);
    if (e && e.metaKey) return;
  }

  // ---------- 对话窗口 ----------
  function openConversationWindow(convId) {
    const conv = state.conversations.find((c) => c.id === convId);
    if (!conv) return;
    let win = state.windows.get(convId);
    if (!win) {
      const el = document.createElement('div');
      el.className = 'conv-window focused';
      el.dataset.id = convId;
      const base = 90 + state.windows.size * 26;
      el.style.left = Math.min(base + 40, window.innerWidth - 500) + 'px';
      el.style.top = Math.min(base, window.innerHeight - 600) + 'px';
      el.innerHTML =
        '<div class="cw-titlebar">' +
          '<div class="cw-dots">' +
            '<i class="cw-close-dot" title="关闭窗口"></i>' +
            '<i class="cw-min-dot" title="折叠 / 展开"></i>' +
            '<i class="cw-zoom-dot" title="最大化 / 还原"></i>' +
          '</div>' +
          '<img class="cw-icon" src="' + iconPath(conv.icon) + '" alt="">' +
          '<div class="cw-title"></div>' +
        '</div>' +
        '<div class="cw-body">' +
          '<div class="cw-messages"></div>' +
          '<div class="cw-input-row">' +
            '<textarea class="cw-input" rows="1" placeholder="输入消息…（Enter 发送）"></textarea>' +
            '<button class="cw-send" title="发送">' +
              '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3.4 20.4 20.85 12 3.4 3.6l.01 6.53L15.6 12 3.41 13.87 3.4 20.4z"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>';
      windowLayer().appendChild(el);
      win = {
        el,
        messagesEl: el.querySelector('.cw-messages'),
        inputEl: el.querySelector('.cw-input'),
        sendEl: el.querySelector('.cw-send'),
        titleEl: el.querySelector('.cw-title'),
        iconEl: el.querySelector('.cw-icon'),
      };
      state.windows.set(convId, win);
      // 交通灯：红=关闭，黄=折叠/展开，绿=最大化/还原
      el.querySelector('.cw-close-dot').addEventListener('click', () => closeConversationWindow(convId));
      el.querySelector('.cw-min-dot').addEventListener('click', () => toggleWindowMinimize(convId));
      el.querySelector('.cw-zoom-dot').addEventListener('click', () => toggleWindowZoom(convId));
      el.querySelector('.cw-titlebar').addEventListener('dblclick', () => toggleWindowZoom(convId));
      el.addEventListener('mousedown', () => focusWindow(convId));
      win.inputEl.addEventListener('input', () => {
        win.inputEl.style.height = 'auto';
        win.inputEl.style.height = Math.min(win.inputEl.scrollHeight, 120) + 'px';
      });
      win.inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendFromWindow(convId); }
      });
      win.sendEl.addEventListener('click', () => sendFromWindow(convId));
      makeWindowDraggable(el, el.querySelector('.cw-titlebar'));
    }
    win.titleEl.textContent = conv.title;
    win.iconEl.src = iconPath(conv.icon);
    renderConversationInto(win.messagesEl, conv, false);
    win.messagesEl.scrollTop = win.messagesEl.scrollHeight;
    focusWindow(convId);
    updateWindowSendState(convId);
  }

  function focusWindow(convId) {
    for (const [id, w] of state.windows) w.el.classList.toggle('focused', id === convId);
    state.currentId = convId;                 // 流式更新据此路由
    renderSidebar();
    updateWindowSendState(convId);
  }

  function updateWindowSendState(convId) {
    const win = state.windows.get(convId);
    if (!win) return;
    const streaming = isStreaming(convId);
    win.el.classList.toggle('streaming', streaming);
    win.sendEl.innerHTML = streaming
      ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
      : '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3.4 20.4 20.85 12 3.4 3.6l.01 6.53L15.6 12 3.41 13.87 3.4 20.4z"/></svg>';
    win.sendEl.title = streaming ? '停止生成' : '发送';
  }

  /** 折叠 / 展开窗口（黄灯）*/
  function toggleWindowMinimize(convId) {
    const win = state.windows.get(convId);
    if (!win) return;
    const el = win.el;
    const min = el.classList.toggle('minimized');
    if (min) {
      el.dataset.prevHeight = el.style.height || '';
      el.style.height = '';
    } else if (el.dataset.prevHeight) {
      el.style.height = el.dataset.prevHeight;
    }
  }

  /** 最大化 / 还原窗口（绿灯）*/
  function toggleWindowZoom(convId) {
    const win = state.windows.get(convId);
    if (!win) return;
    const el = win.el;
    const zoomed = el.classList.toggle('maximized');
    if (zoomed) {
      el.dataset.prev = JSON.stringify({ left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height });
    } else if (el.dataset.prev) {
      try {
        const p = JSON.parse(el.dataset.prev);
        el.style.left = p.left; el.style.top = p.top;
        el.style.width = p.width; el.style.height = p.height;
      } catch (_) {}
    }
  }

  function closeConversationWindow(convId) {
    const win = state.windows.get(convId);
    if (!win) return;
    win.el.remove();
    state.windows.delete(convId);
  }

  function closeAllWindows() {
    for (const id of Array.from(state.windows.keys())) closeConversationWindow(id);
  }

  function makeWindowDraggable(el, handle) {
    let start = null;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const r = el.getBoundingClientRect();
      start = { x: e.clientX - r.left, y: e.clientY - r.top };
      e.preventDefault();
      const move = (ev) => {
        if (!start) return;
        el.style.left = Math.max(0, Math.min(window.innerWidth - 120, ev.clientX - start.x)) + 'px';
        el.style.top = Math.max(38, Math.min(window.innerHeight - 40, ev.clientY - start.y)) + 'px';
      };
      const up = () => { start = null; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  // ---------- 分叉（⌘C / ⌘V）与右键菜单 ----------
  function copyConversation(convId) {
    state.folderClipboard = convId;
    const c = state.conversations.find((x) => x.id === convId);
    if (c) toast('已复制「' + c.title + '」，按 ⌘V 分叉');
  }

  function pasteConversation() {
    const srcId = state.folderClipboard;
    if (!srcId) { toast('剪贴板里没有对话'); return; }
    const src = state.conversations.find((c) => c.id === srcId);
    if (!src) { toast('原对话已不存在'); return; }
    const copy = {
      id: uid(),
      title: (src.title || '新对话') + ' 副本',
      icon: src.icon,                       // 分叉继承原文件夹图标
      forkedFrom: src.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: JSON.parse(JSON.stringify(src.messages || [])).map((m) => ({ ...m, id: uid() })),
    };
    state.conversations.unshift(copy);
    state.folderSelection = copy.id;
    state.folderClipboard = copy.id;        // 连续粘贴可继续分叉
    renderSidebar();
    renderFolderGrid();
    persist();
    toast('已分叉出新对话「' + copy.title + '」（继承同一图标）');
  }

  function showFolderMenu(x, y, convId) {
    const conv = state.conversations.find((c) => c.id === convId);
    if (!conv) return;
    showContextMenu(x, y, [
      { label: '打开', action: () => openConversationWindow(convId) },
      { label: '复制（⌘C）', action: () => copyConversation(convId), disabled: false },
      { label: '粘贴分叉（⌘V）', action: () => pasteConversation() },
      { sep: true },
      { label: '修改图标…', action: () => showIconPicker(x, y, convId) },
      { label: '重命名', action: () => startRenameCard(convId) },
      { sep: true },
      { label: '删除对话', action: () => deleteConv(convId), danger: true },
    ].map((it) => it) , conv.title);
  }

  function showContextMenu(x, y, items, title) {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.id = 'ctx-menu';
    if (title) {
      const h = document.createElement('div');
      h.className = 'ctx-label';
      h.textContent = title;
      menu.appendChild(h);
    }
    for (const it of items) {
      if (it.sep) { const sep = document.createElement('div'); sep.className = 'ctx-sep'; menu.appendChild(sep); continue; }
      const el = document.createElement('div');
      el.className = 'ctx-item' + (it.danger ? ' danger' : '');
      el.textContent = it.label;
      el.addEventListener('click', () => { closeContextMenu(); it.action(); });
      menu.appendChild(el);
    }
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
    // 关闭交给全局 outside-closer（在自身内部按下不关闭，否则 click 来不及触发）
  }

  function closeContextMenu() {
    const m = document.getElementById('ctx-menu');
    if (m) m.remove();
  }

  /** 点击菜单/选择器「外部」才关闭（capture 阶段判断，不会打断内部点击）*/
  function initOutsideClosers() {
    document.addEventListener('mousedown', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (!t.closest('#ctx-menu')) closeContextMenu();
      if (!t.closest('#icon-picker')) closeIconPicker();
    }, true);
    window.addEventListener('blur', () => { closeContextMenu(); closeIconPicker(); });
  }

  function showIconPicker(x, y, convId) {
    closeIconPicker();
    const conv = state.conversations.find((c) => c.id === convId);
    const box = document.createElement('div');
    box.className = 'icon-picker';
    box.id = 'icon-picker';
    for (const id of FOLDER_ICON_IDS) {
      const img = document.createElement('img');
      img.src = iconPath(id);
      img.alt = id;
      img.className = conv && String(conv.icon) === String(id) ? 'active' : '';
      img.title = '图标 ' + id;
      img.addEventListener('click', () => {
        conv.icon = id;
        persist();
        closeIconPicker();
        renderFolderGrid();
        const win = state.windows.get(convId);
        if (win) win.iconEl.src = iconPath(id);
        toast('已更换图标');
      });
      box.appendChild(img);
    }
    document.body.appendChild(box);
    const r = box.getBoundingClientRect();
    box.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
    box.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
  }

  function closeIconPicker() {
    const p = document.getElementById('icon-picker');
    if (p) p.remove();
  }

  /** 卡片内联重命名 */
  function startRenameCard(convId) {
    const card = document.querySelector('.folder-card[data-id="' + convId + '"]');
    const conv = state.conversations.find((c) => c.id === convId);
    if (!card || !conv) return;
    const nameEl = card.querySelector('.fc-name');
    const input = document.createElement('input');
    input.className = 'fc-rename';
    input.value = conv.title;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = (save) => {
      if (save && input.value.trim()) {
        conv.title = input.value.trim().slice(0, 60);
        conv.updatedAt = Date.now();
        persist();
        renderSidebar();
        const win = state.windows.get(convId);
        if (win) win.titleEl.textContent = conv.title;
      }
      renderFolderGrid();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', () => commit(true));
  }

  /** 文件夹视图下的键盘：⌘C / ⌘V / 回车打开 / 删除 */
  function onFolderKeydown(e) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const meta = e.metaKey || e.ctrlKey;
    // 视图切换快捷键在两种模式下都可用
    if (meta && e.key === '1') { e.preventDefault(); setViewMode('list'); return; }
    if (meta && e.key === '2') { e.preventDefault(); setViewMode('folder'); return; }
    if (viewMode() !== 'folder') return;
    if (meta && e.key.toLowerCase() === 'c') { if (state.folderSelection) { e.preventDefault(); copyConversation(state.folderSelection); } return; }
    if (meta && e.key.toLowerCase() === 'v') { if (state.folderClipboard) { e.preventDefault(); pasteConversation(); } return; }
    if (e.key === 'Enter' && state.folderSelection) { e.preventDefault(); openConversationWindow(state.folderSelection); return; }
    if (e.key === 'Escape') { closeContextMenu(); closeIconPicker(); }
  }

  // ---------- 中文语音输入 ----------
  async function initVoiceInput() {
    const mic = $('btn-mic'), chat = $('btn-voice-chat'), status = $('voice-status');
    if (!mic || !chat || !window.VoiceInput || !window.CloudVoice) return;
    const voiceBridge = window.CloudVoice.create(window.niuai);
    const update = (v) => {
      const recording = ['starting', 'listening', 'finishing'].includes(v.phase);
      const working = recording || v.phase === 'transcribing';
      mic.classList.toggle('recording', working);
      mic.setAttribute('aria-pressed', String(working));
      mic.setAttribute('aria-label', v.phase === 'transcribing' ? '取消语音识别' : recording ? '结束本句语音识别' : '开始中文语音识别');
      mic.title = v.phase === 'transcribing' ? '取消语音识别（Esc）' : recording ? '结束本句（Esc 取消）' : '中文语音提问';
      chat.classList.toggle('active', v.continuous);
      chat.setAttribute('aria-pressed', String(v.continuous));
      chat.textContent = v.continuous ? '结束语音对话' : '连续语音对话';
      status.textContent = v.transcript && v.phase === 'listening' ? v.transcript :
        (v.message || '点击麦克风录音并发送到语音服务 · Esc 取消');
    };
    voiceInput = window.VoiceInput.create({
      bridge: voiceBridge,
      context: () => ({ convId: state.currentId, busy: isStreaming(state.currentId),
        hasKey: !!(state.settings && state.settings.apiKey),
        hasSpeechKey: !!(state.settings && (state.settings.sttApiKey || state.settings.sttEndpoint === 'macos')),
        speechHost: state.settings && state.settings.sttEndpoint === 'macos' ? '本机' :
          (() => { try { return new URL(state.settings.sttEndpoint || 'https://api.siliconflow.cn').host; } catch (_) { return '设置中的语音服务'; } })(),
        hasDraft: !!els.input.value.trim() || attachments.length > 0 }),
      update,
      error: (message) => toast(message, 6000),
      stopSpeaking,
      isSpeaking: () => !!(window.Speech && window.Speech.isSpeaking()),
      submit: (text) => { els.input.value = text; send(true); },
      repeat: () => {
        const conv = currentConv();
        const last = conv && [...conv.messages].reverse().find((m) => m.role === 'assistant' && m.content && !m.error);
        return !!last && speakText(last.content);
      },
    });
    mic.addEventListener('click', () => voiceInput.toggleMic());
    chat.addEventListener('click', () => voiceInput.toggleContinuous());
    window.addEventListener('beforeunload', () => { voiceInput.dispose(); voiceBridge.dispose(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) voiceInput.cancel(); });
    try {
      const info = await voiceBridge.sttInfo();
      if (!info.available) {
        mic.disabled = chat.disabled = true;
        status.textContent = info.reason;
      }
    } catch (_) { mic.disabled = chat.disabled = true; status.textContent = '无法连接语音组件，请重启应用。'; }
  }

  // ---------- 初始化 ----------
  async function init() {
    const [settings, conversations] = await Promise.all([
      window.niuai.getSettings(),
      window.niuai.getConversations(),
    ]);
    state.settings = settings;
    state.conversations = Array.isArray(conversations) ? conversations : [];
    if (state.conversations.length === 0) {
      newChat();
    } else {
      state.currentId = state.conversations[0].id;
    }
    els.modelBadge.textContent = settings.model;
    await initVoiceInput();

    // 会话与发送
    els.btnNew.addEventListener('click', newChat);
    els.btnTopNew.addEventListener('click', newChat);
    els.btnSettings.addEventListener('click', openSettings);
    els.btnSend.addEventListener('click', () => (isStreaming(state.currentId) ? stop() : send()));

    els.input.addEventListener('input', () => { if (voiceInput) voiceInput.cancel(); autoGrow(); saveCurrentDraft(); updateSendButtonState(); });
    els.input.addEventListener('keydown', (e) => {
      const isEnter = e.key === 'Enter';
      const isCmdEnter = (e.metaKey || e.ctrlKey) && isEnter;
      if (isEnter && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      } else if (isCmdEnter) {
        e.preventDefault();
        send();
      }
    });

    // 附件：按钮 / 粘贴 / 拖放
    els.btnAttach.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', () => {
      handleFiles(els.fileInput.files);
      els.fileInput.value = '';
    });
    els.input.addEventListener('paste', onPaste);
    ['dragenter', 'dragover'].forEach((ev) =>
      els.inputArea.addEventListener(ev, (e) => { e.preventDefault(); els.inputShell.classList.add('drag-over'); }));
    ['dragleave', 'drop'].forEach((ev) =>
      els.inputArea.addEventListener(ev, (e) => { e.preventDefault(); els.inputShell.classList.remove('drag-over'); }));
    els.inputArea.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });

    // 设置弹窗
    els.btnToggleKey.addEventListener('click', () => {
      els.setApiKey.type = els.setApiKey.type === 'password' ? 'text' : 'password';
    });
    els.btnCloseSettings.addEventListener('click', closeSettings);
    els.btnCancelSettings.addEventListener('click', closeSettings);
    els.btnSaveSettings.addEventListener('click', saveSettings);
    els.settingsOverlay.addEventListener('click', (e) => { if (e.target === els.settingsOverlay) closeSettings(); });
    // 首次启动引导弹窗必须点「开始使用」完成设置，因此不支持 Esc / 点空白关闭
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (voiceInput) voiceInput.cancel('已取消语音。');
      if (els.healthOverlay && !els.healthOverlay.classList.contains('hidden')) { closeHealthWarning(); return; }
      if (!els.settingsOverlay.classList.contains('hidden')) closeSettings();
      const lb = document.getElementById('lightbox'); if (lb) lb.classList.remove('show');
    });
    els.setTemperature.addEventListener('input', () => { els.tempVal.textContent = els.setTemperature.value; });
    if (els.setTtsRate) {
      els.setTtsRate.addEventListener('input', () => {
        const v = parseInt(els.setTtsRate.value, 10) || 0;
        if (els.ttsRateVal) els.ttsRateVal.textContent = (v > 0 ? '+' : '') + v + '%';
      });
    }
    // 人物模型：切换 / 选择文件 / 刷新 / 打开目录
    if (els.setAvatarModel) {
      els.setAvatarModel.addEventListener('change', async () => {
        const file = els.setAvatarModel.value;
        if (!file) return;
        state.settings.avatarModel = file;
        await window.niuai.setSettings(state.settings);
        if (state.settings.avatarEnabled) await initAvatar(true);
        toast('已切换到 ' + file);
      });
    }
    if (els.btnAvatarPick) {
      els.btnAvatarPick.addEventListener('click', async () => {
        const r = await window.niuai.avatarPick();
        if (!r || r.canceled) return;
        if (!r.ok) { toast('导入失败：' + (r.error || '未知错误')); return; }
        state.settings.avatarModel = r.file;
        await window.niuai.setSettings(state.settings);
        await fillAvatarModels(r.file);
        if (state.settings.avatarEnabled) await initAvatar(true);
        toast('已导入并切换到 ' + r.file);
      });
    }
    if (els.btnAvatarRefresh) {
      els.btnAvatarRefresh.addEventListener('click', async () => {
        await fillAvatarModels();
        toast('模型列表已刷新');
      });
    }
    if (els.btnAvatarFolder) {
      els.btnAvatarFolder.addEventListener('click', () => window.niuai.avatarOpenFolder());
    }
    if (els.setWebSearch) {
      els.setWebSearch.addEventListener('change', () => {
        if (els.fieldWebSearchRounds) els.fieldWebSearchRounds.style.display = els.setWebSearch.checked ? '' : 'none';
      });
    }
    if (els.setWebSearchRounds) {
      els.setWebSearchRounds.addEventListener('input', () => {
        if (els.roundsVal) els.roundsVal.textContent = els.setWebSearchRounds.value;
      });
    }
    if (els.setMouthSpeed) {
      els.setMouthSpeed.addEventListener('input', () => {
        const v = parseFloat(els.setMouthSpeed.value);
        if (avatar.handle && avatar.handle.setMouthSpeed) avatar.handle.setMouthSpeed(v);
        if (els.mouthSpeedVal) els.mouthSpeedVal.textContent = mouthSpeedLabel(v);
      });
    }
    if (els.setTtsEngine) {
      els.setTtsEngine.addEventListener('change', () => {
        // 切换引擎后立即刷新面板显示
        const prev = state.settings.ttsEngine;
        state.settings.ttsEngine = els.setTtsEngine.value;
        applySpeechConfig();
        fillVoiceSelect().catch(() => {});
        state.settings.ttsEngine = prev;
      });
    }
    const sttEngineSel = $('set-sttEngine');
    if (sttEngineSel) sttEngineSel.addEventListener('change', toggleSttEngine);

    // 菜单事件
    window.niuai.onMenu((action) => {
      if (action === 'new-chat') newChat();
      else if (action === 'stop') stop();
      else if (action === 'settings') openSettings();
      else if (action === 'delete-current') { if (state.currentId) deleteConv(state.currentId); }
    });

    // 虚拟形象 & 播报
    applySpeechConfig();
    els.btnAvatarToggle.addEventListener('click', () => {
      state.settings.avatarEnabled = !state.settings.avatarEnabled;
      window.niuai.setSettings(state.settings);
      applyAvatarVisibility();
      toast(state.settings.avatarEnabled ? '已显示虚拟形象' : '已隐藏虚拟形象');
    });
    els.btnSpeakToggle.addEventListener('click', () => {
      if (window.Speech && window.Speech.isSpeaking()) { if (voiceInput) voiceInput.cancel(); stopSpeaking(); return; }
      state.settings.avatarAutoSpeak = !state.settings.avatarAutoSpeak;
      window.niuai.setSettings(state.settings);
      updateSpeakToggleUI();
      toast(state.settings.avatarAutoSpeak ? '已开启自动播报' : '已关闭自动播报');
    });
    els.btnAvatarSay.addEventListener('click', () => {
      const conv = currentConv();
      const last = conv && [...conv.messages].reverse().find((m) => m.role === 'assistant' && m.content);
      if (last) speakText(last.content);
      else toast('还没有可播报的回答');
    });
    els.btnAvatarStop.addEventListener('click', () => { if (voiceInput) voiceInput.cancel(); stopSpeaking(); });

    applyAvatarVisibility();
    updateSpeakToggleUI();

    // 文件夹视图：图标分配 + 视图切换 + 交互
    migrateIcons();
    initOutsideClosers();
    // 技能：安装 / 目录 / 刷新
    if (els.btnSkillInstall) els.btnSkillInstall.addEventListener('click', () => installSkill().catch((e) => toast('安装失败：' + e.message)));
    if (els.btnSkillFolder) els.btnSkillFolder.addEventListener('click', () => window.niuai.skillsOpenFolder());
    if (els.btnSkillRefresh) els.btnSkillRefresh.addEventListener('click', async () => { await loadSkills(true); toast('技能列表已刷新'); });
    await loadSkills(true);
    if (els.btnViewToggle) els.btnViewToggle.addEventListener('click', () => setViewMode(viewMode() === 'folder' ? 'list' : 'folder'));
    if (els.btnFolderNew) els.btnFolderNew.addEventListener('click', () => { newChat(); if (viewMode() === 'folder') openConversationWindow(state.currentId); });
    if (els.btnViewList) els.btnViewList.addEventListener('click', () => setViewMode('list'));
    if (els.btnWebSearch) {
      els.btnWebSearch.addEventListener('click', () => {
        state.settings.webSearch = !state.settings.webSearch;
        window.niuai.setSettings(state.settings).catch(() => {});
        updateSearchToggleUI();
        toast(state.settings.webSearch ? '已开启联网搜索（模型会按需搜索）' : '已关闭联网搜索');
      });
    }
    updateSearchToggleUI();
    document.addEventListener('keydown', onFolderKeydown);
    document.addEventListener('mousedown', (e) => {
      if (viewMode() !== 'folder') return;
      if (e.target.closest('.folder-card') || e.target.closest('.ctx-menu') || e.target.closest('.icon-picker')) return;
      state.folderSelection = null;
      for (const el of document.querySelectorAll('.folder-card')) el.classList.remove('selected');
    });

    renderSidebar();
    renderMessages();
    renderFolderGrid();
    updateComposeUI();
    applyViewMode();

    // 火星小厨房：预加载人设档案（Skill.md / A.md / shtu / 档位映射）
    // 主界面无参数栏与控制面板：首次打开弹窗设置，之后在「设置」里修改。
    await loadMarsProfile();
    applyElderMode();
    bindMarsControls();
    syncMarsControls();
    maybeShowOnboard();
  }

  if (window.niuai) init().catch((e) => toast('初始化失败：' + e.message));

  // 调试句柄（自检用；生产无影响）
  window.__niuDebug = () => ({
    currentId: String(state.currentId || '').slice(0, 8),
    convs: state.conversations.map((c) => ({ id: c.id, title: c.title, msgs: c.messages.length, icon: c.icon })),
    viewMode: (state.settings && state.settings.viewMode) || 'list',
    render: Object.assign({}, renderProbe),
    windows: Array.from(state.windows.keys()),
    folderSelection: state.folderSelection,
    streams: Object.keys(state.streams).map((k) => k.slice(0, 8)),
    drafts: Object.keys(state.drafts).map((k) => [String(k).slice(0, 8), state.drafts[k].text]),
    attachCount: attachments.length,
  });

  // 虚拟形象调试句柄（自检用）
  window.__niuAvatar = () => {
    const canvas = els.avatarCanvas;
    const r = canvas ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
    const st = avatar.handle ? avatar.handle.stats() : { ready: false };
    return Object.assign(st, {
      panelVisible: els.avatarPanel ? !els.avatarPanel.classList.contains('hidden') : false,
      canvas: { w: Math.round(r.width), h: Math.round(r.height), bitmapW: canvas ? canvas.width : 0 },
      loadingVisible: els.avatarLoading ? !els.avatarLoading.classList.contains('hidden') : false,
      status: els.avatarStatus ? els.avatarStatus.textContent : '',
      speechSupported: !!(window.Speech && window.Speech.isSupported()),
      ttsEngine: window.Speech ? window.Speech.config().engine : null,
      ttsVoice: window.Speech ? window.Speech.config().voice : null,
      systemVoices: window.Speech ? window.Speech.systemVoices().length : 0,
      speakingFlag: window.Speech ? window.Speech.isSpeaking() : false,
      name: els.avatarName ? els.avatarName.textContent : '',
    });
  };
  /** 会话内部结构（自检用）*/
  window.__niuMessages = () => {
    const conv = currentConv();
    if (!conv) return [];
    return conv.messages.map((m) => ({
      id: String(m.id).slice(0, 8),
      role: m.role,
      hidden: !!m.hidden,
      len: (m.content || '').length,
      reasoningLen: (m.reasoning || '').length,
      toolCalls: m.toolCalls ? m.toolCalls.map((t) => t.name + '(' + String(t.arguments).slice(0, 30) + ')') : null,
      toolCallId: m.toolCallId || null,
      searchSteps: m.searchSteps ? m.searchSteps.length : 0,
      error: !!m.error,
    }));
  };
  window.__niuSearch = () => ({
    enabled: !!(state.settings && state.settings.webSearch),
    rounds: (state.settings && state.settings.webSearchRounds) || 3,
    tools: (window.API && window.API.WEB_TOOLS ? window.API.WEB_TOOLS.length : 0),
  });
  // 火星小厨房 调试/自检句柄：人设档案、档位参数、组装后的 System Prompt、控制面板计数
  window.__niuMars = () => {
    const conv = currentConv();
    const lastUser = conv ? [...conv.messages].reverse().find((m) => m.role === 'user') : null;
    return {
      profile: window.Mars ? window.Mars.profileInfo() : null,
      settings: {
        version: state.settings.marsVersion,
        elderMode: state.settings.marsVersion === 'elderly',
        spicy: state.settings.marsSpicy,
        sweet: state.settings.marsSweet,
        salty: state.settings.marsSalty,
        avoid: state.settings.marsAvoid,
        onboarded: state.settings.marsOnboarded === true,
      },
      snapshot: window.Mars ? window.Mars.snapshot(state.settings) : null,
      systemPrompt: resolveSystemPrompt(lastUser ? lastUser.content : ''),
      counts: marsCounts(conv),
      elderClass: document.body.classList.contains('elder-mode'),
      bodyFontSize: getComputedStyle(document.body).fontSize,
      answerFontSize: (() => {
        const el = document.querySelector('#messages .assistant-body');
        return el ? getComputedStyle(el).fontSize : null;
      })(),
      onboardVisible: els.onboardOverlay ? !els.onboardOverlay.classList.contains('hidden') : false,
      mainHasParamBar: !!document.getElementById('mars-bar'),
      mainHasControlPanel: !!document.getElementById('control-panel'),
      avatar: {
        enabled: !!state.settings.avatarEnabled,
        autoSpeak: !!state.settings.avatarAutoSpeak,
        model: state.settings.avatarModel,
        ttsEngine: state.settings.ttsEngine,
        panelVisible: els.avatarPanel ? !els.avatarPanel.classList.contains('hidden') : false,
      },
    };
  };
  window.__niuAvatarHandle = () => avatar.handle;
  window.__niuSpeakText = (t) => speakText(t);
  // 供自检直接驱动口型（不依赖 TTS 是否可用）
  window.__niuAvatarSpeak = (text) => {
    if (!avatar.handle) return false;
    avatar.handle.beginSpeech(text || '这是一段播报测试文本。');
    setAvatarStatus('speaking');
    return true;
  };
  window.__niuAvatarEnd = () => {
    if (avatar.handle) avatar.handle.endSpeech();
    setAvatarStatus('idle');
  };
})();
