/* 复现 DSML bug 的模拟服务器：第一轮把工具调用写成 DSML 文本，第二轮返回正常回答 */
'use strict';
const http = require('http');
const fs = require('fs');
const PORT = Number(process.argv[2] || 8799);
const LOG = process.env.MOCK_LOG || '/tmp/dsml-reqs.jsonl';
const BAR = '\uff5c';                       // 全角竖线
const T = BAR + BAR + 'DSML' + BAR + BAR;   // DSML 标记前缀

let round = 0;
http.createServer((req, res) => {
  if (!req.url.includes('/chat/completions')) { res.writeHead(404).end(); return; }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    round++;
    try { fs.appendFileSync(LOG, JSON.stringify({ round, body: JSON.parse(body) }) + '\n'); } catch (_) {}
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
    const text = (t) => send({ choices: [{ delta: { content: t } }] });

    if (round === 1) {
      // 复刻用户遇到的情况：工具调用以 DSML 文本形式混在正文里
      text('我来帮你查一下。\n');
      text('<' + T + ' calls>\n');
      text('<' + T + ' invoke name="web_search">\n');
      text('<' + T + ' parameter name="query" string="true">测试查询关键词<' + T + ' parameter>\n');
      text('</' + T + ' invoke>\n');
      text('</' + T + ' calls>');
    } else {
      text('根据搜索到的资料，这是基于资料的正常回答（第二轮）。');
    }
    setTimeout(() => { res.write('data: [DONE]\n\n'); res.end(); }, 300);
  });
}).listen(PORT, '127.0.0.1', () => console.log('MOCK_DSML_UP ' + PORT));
