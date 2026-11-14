/* 轻量 Markdown 渲染器：先转义所有 HTML，再按行/块规则转换，杜绝 XSS */
(function () {
  'use strict';

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 行内格式：code、bold、italic、strikethrough、link
  function inline(s) {
    let out = '';
    let i = 0;
    const n = s.length;
    while (i < n) {
      // 行内代码
      if (s[i] === '`') {
        let j = s.indexOf('`', i + 1);
        if (j === -1) { out += esc(s.slice(i)); break; }
        out += '<code class="inline">' + esc(s.slice(i + 1, j)) + '</code>';
        i = j + 1;
        continue;
      }
      // 链接 [text](url)
      if (s[i] === '[') {
        const close = s.indexOf(']', i + 1);
        if (close !== -1 && s[close + 1] === '(') {
          const end = s.indexOf(')', close + 2);
          if (end !== -1) {
            const text = s.slice(i + 1, close);
            const url = s.slice(close + 2, end).trim();
            if (/^https?:\/\//i.test(url) || url.startsWith('#')) {
              out += '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + inline(text) + '</a>';
              i = end + 1;
              continue;
            }
          }
        }
        out += '[';
        i++;
        continue;
      }
      // 加粗 **x** 或 __x__
      if ((s[i] === '*' || s[i] === '_') && s[i + 1] === s[i] && s[i + 2] !== ' ') {
        const mark = s[i] + s[i + 1];
        const j = s.indexOf(mark, i + 2);
        if (j !== -1) {
          out += '<strong>' + inline(s.slice(i + 2, j)) + '</strong>';
          i = j + 2;
          continue;
        }
      }
      // 斜体 *x* 或 _x_
      if ((s[i] === '*' || s[i] === '_') && s[i + 1] !== ' ' && s[i + 1] !== s[i]) {
        const j = s.indexOf(s[i], i + 1);
        if (j !== -1) {
          out += '<em>' + inline(s.slice(i + 1, j)) + '</em>';
          i = j + 1;
          continue;
        }
      }
      // 删除线 ~~x~~
      if (s[i] === '~' && s[i + 1] === '~') {
        const j = s.indexOf('~~', i + 2);
        if (j !== -1) {
          out += '<del>' + inline(s.slice(i + 2, j)) + '</del>';
          i = j + 2;
          continue;
        }
      }
      // 自动链接裸 URL
      if (/^https?:\/\//i.test(s.slice(i, i + 12))) {
        const m = s.slice(i).match(/^https?:\/\/[^\s<)]+/i);
        if (m) {
          out += '<a href="' + esc(m[0]) + '" target="_blank" rel="noopener noreferrer">' + esc(m[0]) + '</a>';
          i += m[0].length;
          continue;
        }
      }
      out += esc(s[i]);
      i++;
    }
    return out;
  }

  function renderTable(rows) {
    if (rows.length < 2) return '';
    const parseRow = (r) => r.split('|').map((c) => c.trim()).filter((c, idx, arr) => !(idx === 0 && c === '') && !(idx === arr.length - 1 && c === ''));
    let html = '<table class="md-table"><thead><tr>';
    parseRow(rows[0]).forEach((c) => { html += '<th>' + inline(c) + '</th>'; });
    html += '</tr></thead><tbody>';
    for (let i = 2; i < rows.length; i++) {
      html += '<tr>';
      parseRow(rows[i]).forEach((c) => { html += '<td>' + inline(c) + '</td>'; });
      html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }

  function render(src) {
    if (!src) return '';
    const lines = String(src).replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let i = 0;
    let inCode = false;
    let codeLang = '';
    let codeBuf = [];
    let listType = null; // 'ul' | 'ol'
    let tableBuf = [];

    const closeList = () => {
      if (listType) { html.push('</' + listType + '>'); listType = null; }
    };

    // 表格可以直接打断段落（标题后无空行也算表格），判定必须同时用于主循环和段落合并
    const isTableStart = (idx) =>
      idx + 1 < lines.length &&
      lines[idx].includes('|') &&
      /^\s*\|?[\s:|-]+\|?[\s:|-]*$/.test(lines[idx + 1]) &&
      lines[idx + 1].includes('-');

    while (i < lines.length) {
      const line = lines[i];

      // 代码块 ```lang
      if (/^```/.test(line.trimStart())) {
        if (inCode) {
          html.push('<div class="code-block"><span class="code-lang">' + esc(codeLang) + '</span><pre><code>' + esc(codeBuf.join('\n')) + '</code></pre><button class="code-copy" data-copy="1">复制</button></div>');
          inCode = false; codeBuf = []; codeLang = '';
        } else {
          closeList();
          inCode = true;
          codeLang = line.trim().slice(3).trim();
        }
        i++;
        continue;
      }
      if (inCode) { codeBuf.push(line); i++; continue; }

      // 表格（连续包含 | 的行，且第二行是分隔符）
      if (isTableStart(i)) {
        closeList();
        tableBuf = [];
        while (i < lines.length && lines[i].includes('|')) { tableBuf.push(lines[i]); i++; }
        html.push(renderTable(tableBuf));
        continue;
      }

      const trimmed = line.trim();

      // 空行
      if (trimmed === '') { closeList(); html.push(''); i++; continue; }

      // 标题
      const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (h) { closeList(); html.push('<' + 'h' + h[1].length + '>' + inline(h[2]) + '</' + 'h' + h[1].length + '>'); i++; continue; }

      // 无序/有序列表
      const ul = trimmed.match(/^[-*+]\s+(.*)$/);
      const ol = trimmed.match(/^\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        const type = ul ? 'ul' : 'ol';
        if (listType !== type) { closeList(); html.push('<' + type + '>'); listType = type; }
        html.push('<li>' + inline((ul ? ul[1] : ol[1])) + '</li>');
        i++;
        continue;
      }

      // 引用
      if (trimmed.startsWith('>')) {
        closeList();
        const rest = trimmed.replace(/^>\s?/, '');
        html.push('<blockquote>' + inline(rest) + '</blockquote>');
        i++;
        continue;
      }

      // 分隔线
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { closeList(); html.push('<hr>'); i++; continue; }

      // 普通段落（合并后续非特殊行）
      closeList();
      let para = line;
      i++;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t === '' || /^```/.test(t) || /^#{1,6}\s/.test(t) || /^[-*+]\s/.test(t) || /^\d+[.)]\s/.test(t) || isTableStart(i)) break;
        para += '\n' + lines[i];
        i++;
      }
      html.push('<p>' + inline(para) + '</p>');
    }

    if (inCode) {
      html.push('<div class="code-block"><span class="code-lang">' + esc(codeLang) + '</span><pre><code>' + esc(codeBuf.join('\n')) + '</code></pre><button class="code-copy" data-copy="1">复制</button></div>');
    }
    closeList();

    return html.join('\n');
  }

  if (typeof window !== 'undefined') window.Markdown = { render: render };
  if (typeof module !== 'undefined' && module.exports) module.exports = { render: render };
})();
