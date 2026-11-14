#!/usr/bin/env node
/* 火星小厨房 端到端测试用 Mock DeepSeek 服务器（确定性，不依赖外网）
 *
 * 行为：
 *   第 1 轮 → 返回一个 web_search 工具调用（分片流式，模拟 DeepSeek 真实行为）
 *   第 2 轮（历史里已有 tool 结果）→ 返回带 markdown 表格的【主体回答】+【提示信息】
 *
 * 用法：node tools/mars-mock-server.js [端口]
 * 每次收到的请求（含 system 消息全文）会以 JSONL 追加写入 MARS_MOCK_LOG 指定的文件。
 */
'use strict';
const http = require('http');
const fs = require('fs');

const PORT = Number(process.argv[2] || 8757);
const LOG = process.env.MARS_MOCK_LOG || '/tmp/mars-mock.jsonl';

// 故意带上旧版的「【主体回答】+【提示信息】」结构：
// 需求要求回答里不要出现提示信息 / 参数快照 / 调用次数，前端必须把这些剥掉。
// 用这个 mock 就能验证「模型不听指令时，界面依然不显示提示信息」。
// 表格故意紧贴上一行（无空行）：覆盖模型不留空行时表格仍须渲染的场景。
const ANSWER = [
  '【主体回答】',
  '番茄炒蛋的做法（按您的档位调整）：',
  '| 步骤 | 操作 | 时间 |',
  '| --- | --- | --- |',
  '| 1 | 鸡蛋打散，加一点点盐 | 1 分钟 |',
  '| 2 | 热锅下油，炒蛋至凝固盛出 | 2 分钟 |',
  '| 3 | 番茄下锅炒出汁，回锅炒匀 | 3 分钟 |',
  '',
  '番茄炒蛋本身没有辣口，我就按您偏甜的口味来做，不放辣椒。本菜谱不含虾，符合您的忌口要求。',
  '',
  '【提示信息】',
  '> 当前生效参数：版本=老年人版，辣度=1，甜度=0，咸度=1；忌口：虾过敏',
  '> 联网搜索调用次数：1次',
].join('\n');

http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let parsed = {};
    try { parsed = JSON.parse(body); } catch (_) {}
    try {
      fs.appendFileSync(LOG, JSON.stringify({ url: req.url, headers: req.headers, body: parsed }) + '\n');
    } catch (_) {}

    const messages = (parsed && parsed.messages) || [];
    const hasToolResult = messages.some((m) => m.role === 'tool');
    const wantToolCall = !hasToolResult && (parsed.tools || []).some((t) => t.function && t.function.name === 'web_search');

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

    if (wantToolCall) {
      // 第一片：函数名 + id（DeepSeek 流式下 name 只在首片出现一次）
      send({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_mock_1', type: 'function', function: { name: 'web_search', arguments: '' } }] } }] });
      setTimeout(() => send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":"番茄炒蛋 家常做法"}' } }] } }] }), 80);
      setTimeout(() => {
        send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
        res.write('data: [DONE]\n\n');
        res.end();
      }, 160);
      return;
    }

    // 最终回答：分片流式输出
    const chunks = ANSWER.match(/[\s\S]{1,24}/g) || [ANSWER];
    let i = 0;
    const timer = setInterval(() => {
      if (i < chunks.length) {
        send({ choices: [{ delta: { content: chunks[i] } }] });
        i++;
        return;
      }
      clearInterval(timer);
      send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
      res.write('data: [DONE]\n\n');
      res.end();
    }, 30);
  });
}).listen(PORT, '127.0.0.1', () => console.log('MARS_MOCK_UP http://127.0.0.1:' + PORT + '/v1/chat/completions'));
