/* 本地 Mock OpenAI SSE 服务器：确定性验证流式管线（无外部限流干扰）
 * 用法: node tools/mock-server.js [端口]
 * 会把收到的最后一次请求(含头)写入 MOCK_LOG 环境变量指定文件
 */
'use strict';
const http = require('http');
const fs = require('fs');

const PORT = Number(process.argv[2] || 8642);
const LOG = process.env.MOCK_LOG || '/tmp/mock-last.json';

http
  .createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        // 追加方式记录每次请求（JSONL），便于按顺序核查 system 消息
        fs.appendFileSync(LOG, JSON.stringify({ url: req.url, headers: req.headers, body: JSON.parse(body) }) + '\n');
      } catch (_) {}

      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

      // 第一块：只有推理（此时正文为空 → 验证深度思考框动态创建）
      send({
        choices: [{
          delta: {
            role: 'assistant',
            reasoning: '用户问公司代号，',
            reasoning_details: [{ type: 'reasoning.text', text: '用户问公司代号，', format: 'unknown', index: 0 }],
          },
        }],
      });
      setTimeout(() => send({
        choices: [{ delta: { reasoning: '附件里写的是 NL-7723。' } }],
      }), 600);
      setTimeout(() => send({
        choices: [{ delta: { reasoning: '整理一下再回答。' } }],
      }), 1400);
      // 第二阶段：正文增量（分两段验证逐字渲染）
      setTimeout(() => send({ choices: [{ delta: { content: 'NL-' } }] }), 2600);
      setTimeout(() => send({ choices: [{ delta: { content: '7723' } }] }), 2800);
      setTimeout(() => {
        res.write('data: [DONE]\n\n');
        res.end();
      }, 3000);
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log('MOCK_UP on http://127.0.0.1:' + PORT + '/v1/chat/completions'));
