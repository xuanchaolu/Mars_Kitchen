/* 冒烟测试：用真实 DeepSeek API 验证连接 / 流式 / reasoning 字段格式（MARS_KEY 或 PERPER_KEY） */
'use strict';

const API_KEY = process.env.MARS_KEY || process.env.PERPER_KEY || '';   // 只从环境变量读取，切勿把密钥写进仓库
if (!API_KEY) {
  console.error('请先设置环境变量 MARS_KEY=<你的 DeepSeek API Key>');
  process.exit(1);
}
const MODEL = process.env.MARS_MODEL || process.env.PERPER_MODEL || 'deepseek-flash';

async function main() {
  const url = (process.env.MARS_BASE || process.env.PERPER_BASE || 'https://api.deepseek.com/v1') + '/chat/completions';
  const body = {
    model: MODEL,
    messages: [
      { role: 'user', content: '用一句话回答：英语单词 strawberry 里有几个字母 r？' },
    ],
    stream: true,
    reasoning: { enabled: true },
    temperature: 0.7,
  };

  console.log('POST', url, 'model:', MODEL);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + API_KEY,
      'HTTP-Referer': 'https://mars-kitchen.app',
      'X-Title': '火星小厨房 smoke test',
    },
    body: JSON.stringify(body),
  });
  console.log('HTTP status:', res.status);
  if (!res.ok) {
    const t = await res.text();
    console.log('ERROR BODY:', t.slice(0, 800));
    process.exit(1);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let contentLen = 0, reasonLen = 0, chunks = 0;
  let firstDelta = null, firstRaw = null, sawDetails = false;

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
      if (data === '[DONE]') { console.log('got [DONE]'); reader.releaseLock(); printSummary(); return; }
      try {
        const j = JSON.parse(data);
        const d = j.choices && j.choices[0] && j.choices[0].delta;
        if (!d) continue;
        if (!firstDelta) { firstDelta = d; firstRaw = data; }
        if (typeof d.content === 'string') contentLen += d.content.length;
        if (typeof d.reasoning === 'string') reasonLen += d.reasoning.length;
        if (d.reasoning_details) sawDetails = true;
        chunks++;
      } catch (_) { /* partial JSON lines */ }
    }
  }

  function printSummary() {
    console.log('chunks:', chunks, '| content chars:', contentLen, '| reasoning chars:', reasonLen);
    if (firstDelta) {
      console.log('first delta keys:', Object.keys(firstDelta));
      console.log('reasoning_details present in stream:', sawDetails);
      console.log('first delta (truncated 400):', JSON.stringify(firstDelta).slice(0, 400));
    }
  }
}

main().catch((e) => { console.error('SMOKE FAIL:', e.message); process.exit(1); });
