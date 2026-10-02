/* OpenAI 兼容 Chat Completions 客户端（SSE 流式） */
(function () {
  'use strict';

  function buildEndpoint(baseURL) {
    let url = String(baseURL || '').trim();
    if (!url) return null;
    if (!/\/chat\/completions$/.test(url)) {
      url = url.replace(/\/+$/, '') + '/chat/completions';
    }
    return url;
  }

  // 组装请求消息：含 system prompt、tool_calls 与 tool 结果、reasoning_details 透传
  function buildMessages(settings, messages, opts) {
    const o = opts || {};
    const out = [];
    // system prompt：显式传入的优先（技能提示词会覆盖全局），技能说明追加在其后
    const sysText = (o.systemPrompt != null ? o.systemPrompt : settings.systemPrompt) || '';
    const parts = [];
    if (sysText.trim()) parts.push(sysText.trim());
    if (o.skillsContext && o.skillsContext.trim()) parts.push(o.skillsContext.trim());
    if (o.extraContext && o.extraContext.trim()) parts.push(o.extraContext.trim());
    if (parts.length) out.push({ role: 'system', content: parts.join('\n\n') });
    for (const m of messages) {
      if (m.role === 'tool') {
        out.push({ role: 'tool', tool_call_id: m.tool_call_id || m.toolCallId, content: m.content == null ? '' : m.content });
        continue;
      }
      const d = { role: m.role, content: m.content == null ? '' : m.content };
      const tcs = m.toolCalls || m.tool_calls;
      if (tcs && tcs.length) {
        d.tool_calls = tcs.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: (tc.function && tc.function.name) || tc.name,
            arguments: (tc.function && tc.function.arguments) || tc.arguments || '{}',
          },
        }));
        if (!d.content) d.content = '';
      }
      if (m.role === 'assistant' && m.reasoningDetails) {
        d.reasoning_details = m.reasoningDetails; // 原样回传，支持继续推理
      }
      out.push(d);
    }
    return out;
  }

  /** DeepSeek 流式模式下 tool_calls 不带函数名与 id，这里按参数结构推断 */
  function inferToolName(argsJson) {
    const raw = String(argsJson || '');
    try {
      const a = JSON.parse(raw || '{}');
      if (a && typeof a === 'object') {
        if ('query' in a) return 'web_search';
        if ('url' in a) return 'fetch_page';
      }
    } catch (_) {}
    if (/"url"\s*:/.test(raw)) return 'fetch_page';
    if (/"query"\s*:/.test(raw)) return 'web_search';
    return null;
  }

  // ---------- 技能工具 ----------
  const SKILL_TOOLS = [
    {
      type: 'function',
      function: {
        name: 'read_skill_file',
        description: '读取某个技能（Skill）目录内的资源文件。当技能说明里要求读取 references/ 等文件时使用；若文件名不确定，可先传 file="" 获取可用文件列表。',
        parameters: {
          type: 'object',
          properties: {
            skill: { type: 'string', description: '技能 id 或技能名称' },
            file: { type: 'string', description: '技能目录内的相对路径，例如 references/knowledge.md' },
          },
          required: ['skill'],
        },
      },
    },
  ];

  // ---------- DSML 兼容层 ----------
  // DeepSeek 有时把工具调用写成内部标记（DSML）混在正文里，而不是标准 tool_calls。
  // 这里把它解析成真正的工具调用，并从正文中剥掉（兼容带 / 与不带 / 的闭合写法）。
  const DSML_BAR = '\uff5c';                                   // 全角竖线
  const DSML_TAG = DSML_BAR + DSML_BAR + 'DSML' + DSML_BAR + DSML_BAR;
  const DSML_OPEN = '<' + DSML_BAR;
  const dsmlTagRe = () => new RegExp(DSML_TAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

  const stripWrapper = (v) => String(v == null ? '' : v)
    .trim()
    .replace(/^>+/, '')            // 标记残留的 '>'
    .replace(/<+$/, '')            // 标记残留的 '<'
    .replace(/^<[a-zA-Z_][\w-]*>\s*/, '')
    .replace(/\s*<\/[a-zA-Z_][\w-]*>$/, '')
    .trim();

  /** 用「按标记切分」的方式解析一段 DSML 区域 → [{name, args}] */
  function parseDsmlRegion(region) {
    const parts = region.split(dsmlTagRe());
    const calls = [];
    let cur = null;
    let param = null;
    const addVal = (txt) => {
      if (!cur || !param) return;
      const v = txt.trim();
      if (!v) return;
      cur.args[param] = (cur.args[param] || '') + v;
    };
    for (const raw of parts) {
      const seg = raw.trim();
      if (!seg) continue;
      let m = seg.match(/^invoke\s+name\s*=\s*"([^"]+)"/);
      if (m) { cur = { name: m[1], args: {} }; calls.push(cur); param = null; continue; }
      m = seg.match(/^parameter\s+name\s*=\s*"([^"]+)"/);
      if (m) {
        param = m[1];
        const gt = seg.indexOf('>');
        if (gt >= 0) addVal(seg.slice(gt + 1));
        continue;
      }
      // 闭合标记（invoke> / parameter> / calls>，可能带 /）或其它结构性片段
      if (/^\/?\s*(invoke|calls|parameter)\s*>/.test(seg)) {
        if (/^\/?\s*(parameter|invoke|calls)\s*>/.test(seg)) param = null;
        continue;
      }
      addVal(seg);       // 纯值文本
    }
    return calls
      .filter((c) => c && c.name)
      .map((c) => ({ name: c.name, args: Object.fromEntries(Object.entries(c.args).map(([k, v]) => [k, stripWrapper(v)])) }));
  }

  /** 流式过滤器：扣住 DSML 区域，只吐人类可读文本；顺带收集工具调用 */
  function makeDsmlFilter() {
    let buf = '';
    let calls = [];
    let sawDsml = false;

    function drain(final) {
      let out = '';
      for (;;) {
        const i = buf.indexOf(DSML_OPEN);
        if (i === -1) {
          // 没有标记：输出（非 final 时保留可能被截断的标记前缀）
          if (final) { out += buf; buf = ''; break; }
          let keep = buf.endsWith('<' + DSML_BAR) ? 2 : (buf.endsWith('<') ? 1 : 0);
          out += buf.slice(0, buf.length - keep);
          buf = buf.slice(buf.length - keep);
          break;
        }
        out += buf.slice(0, i);            // 标记之前的可见文本
        buf = buf.slice(i);
        // 判断是否真的是 DSML 标记
        const tagEnd = buf.indexOf('>');
        if (tagEnd === -1) { if (!final) break; out += buf; buf = ''; break; }
        if (buf.slice(0, tagEnd).indexOf(DSML_TAG) === -1) {
          out += buf.slice(0, tagEnd + 1);   // 普通标签，照常输出
          buf = buf.slice(tagEnd + 1);
          continue;
        }
        // 找这段 DSML 区域的结束：出现 calls> 的标记处（带不带 / 都算）
        const closerRe = new RegExp(DSML_TAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*calls\\s*>');
        const pos = buf.slice(tagEnd).search(closerRe);
        if (pos === -1) { if (!final) break; sawDsml = true; buf = ''; break; }   // 只有开头没有结尾：整段丢掉
        const closeEnd = buf.indexOf('>', tagEnd + pos);
        if (closeEnd === -1) { if (!final) break; sawDsml = true; buf = ''; break; }
        const region = buf.slice(0, closeEnd + 1);
        buf = buf.slice(closeEnd + 1);
        sawDsml = true;
        calls = calls.concat(parseDsmlRegion(region));
      }
      return out;
    }

    return {
      push(chunk) { buf += chunk; return drain(false); },
      flush() { return drain(true); },
      calls: () => calls,
      sawDsml: () => sawDsml,
    };
  }

  // ---------- 工具定义（联网搜索） ----------
  const WEB_TOOLS = [
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: '联网搜索，用于获取实时或训练数据之后的信息（新闻、天气、股价、最新版本、近期事件、具体数据等）。返回标题、链接与摘要。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词，建议用具体的关键词组合' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fetch_page',
        description: '读取某个网页的正文内容，用于在搜索后深入查看具体页面。',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '要读取的网页地址（http/https）' },
          },
          required: ['url'],
        },
      },
    },
  ];

  /**
   * 单轮流式对话（支持工具调用）
   * @param {object} opts
   *  - settings, messages, tools, signal
   *  - onDelta({content, reasoning, reasoningDetails})
   * @returns {Promise<{content, reasoning, reasoningDetails, toolCalls, count}>}
   */
  async function streamRound(opts) {
    const { settings, messages, tools, onDelta, signal } = opts;
    const url = buildEndpoint(settings.baseURL);
    if (!url) throw new Error('无效的接口地址，请在设置中检查');

    const body = {
      model: settings.model,
      messages: buildMessages(settings, messages, {
        systemPrompt: opts.systemPrompt,
        skillsContext: opts.skillsContext,
        extraContext: opts.extraContext,
      }),
      stream: true,
    };
    if (tools && tools.length) body.tools = tools;
    if (settings.reasoningEnabled) body.reasoning = { enabled: true };
    if (typeof settings.temperature === 'number' && settings.temperature > 0) {
      body.temperature = settings.temperature;
    }

    let res;
    try {
      // 请求头必须是 ISO-8859-1 可编码（Chromium 限制），剔除非 ASCII 字符
      const ascii = (s) => String(s || '').replace(/[^\x20-\x7E]/g, '');
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + settings.apiKey,
          'HTTP-Referer': ascii(settings.referer) || 'https://perper.app',
          'X-Title': ascii(settings.title) || 'PerPer macOS',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error('网络请求失败：' + e.message);
    }

    if (!res.ok) {
      let text = '';
      try { text = await res.text(); } catch (_) { /* ignore */ }
      throw new Error('请求失败 (HTTP ' + res.status + ')：' + text.slice(0, 500));
    }
    if (!res.body) throw new Error('响应没有内容流');

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let count = 0;
    let finished = false;
    const acc = { content: '', reasoning: '', reasoningDetails: null, toolCalls: [], finishReason: null };
    const dsml = makeDsmlFilter();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') { reader.releaseLock(); finished = true; break; }
        let j;
        try { j = JSON.parse(data); } catch (_) { continue; }
        const choice = j && j.choices && j.choices[0];
        if (choice && choice.finish_reason) acc.finishReason = choice.finish_reason;
        const delta = choice && choice.delta;
        if (!delta) continue;
        const chunk = {};
        if (typeof delta.content === 'string') {
          const visible = dsml.push(delta.content);
          if (visible) { chunk.content = visible; acc.content += visible; }
        }
        if (typeof delta.reasoning === 'string') chunk.reasoning = delta.reasoning;
        // DeepSeek 官方接口用 reasoning_content 字段
        if (typeof delta.reasoning_content === 'string') {
          chunk.reasoning = (chunk.reasoning || '') + delta.reasoning_content;
          acc.reasoning += delta.reasoning_content;
        }
        if (delta.reasoning_details && typeof delta.reasoning_details === 'object') {
          chunk.reasoningDetails = delta.reasoning_details;
          acc.reasoningDetails = delta.reasoning_details;
        }
        // 工具调用（分片到达，按 index 累积）
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const i = typeof tc.index === 'number' ? tc.index : 0;
            if (!acc.toolCalls[i]) acc.toolCalls[i] = { id: '', name: '', arguments: '' };
            const slot = acc.toolCalls[i];
            if (tc.id) slot.id = tc.id;
            if (tc.function && tc.function.name) slot.name += tc.function.name;
            if (tc.function && typeof tc.function.arguments === 'string') slot.arguments += tc.function.arguments;
          }
          chunk.toolCall = true;
        }
        if (chunk.content || chunk.reasoning || chunk.reasoningDetails) {
          count++;
          onDelta(chunk);
        } else if (chunk.toolCall) {
          onDelta({ toolCallOnly: true });   // 让 UI 知道模型在准备调用工具
        }
      }
      if (finished) break;
    }

    // 收尾：把扣住的文本吐出，并合并 DSML 形式的工具调用
    const tail = dsml.flush();
    if (tail) { acc.content += tail; onDelta({ content: tail }); }
    const dsmlCalls = dsml.calls().map((c, i) => ({
      id: 'call_dsml_' + i + '_' + Math.random().toString(36).slice(2, 8),
      name: c.name,
      arguments: JSON.stringify(c.args || {}),
      fromDsml: true,
    }));

    if ((acc.finishReason === 'tool_calls') && !acc.toolCalls.length && !dsmlCalls.length) {
      throw new Error('模型请求了工具调用，但未能解析出调用参数');
    }

    return {
      content: acc.content,
      reasoning: acc.reasoning,
      reasoningDetails: acc.reasoningDetails,
      toolCalls: acc.toolCalls.filter((t) => t && (t.name || t.arguments)).map((t) => ({
        // 流式下 DeepSeek 不给 id/name：id 自己生成，name 从参数结构推断
        id: t.id || ('call_' + Math.random().toString(36).slice(2, 12)),
        name: t.name || inferToolName(t.arguments) || 'web_search',
        arguments: t.arguments || '{}',
        inferredName: !t.name,
      })).concat(dsmlCalls),
      fromDsml: dsmlCalls.length > 0,
      finishReason: acc.finishReason || null,
      count,
    };
  }

  window.API = { streamRound, buildEndpoint, buildMessages, WEB_TOOLS, SKILL_TOOLS };
})();
