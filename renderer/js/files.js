/* 文件/图片附件处理：图片转 dataURL、文本直读、PDF 尽力提取文本 */
(function () {
  'use strict';

  const IMAGE_MAX = 6 * 1024 * 1024;   // 单张图片上限 6MB
  const TEXT_MAX = 400 * 1024;         // 文本文件上限 400KB
  const PDF_TEXT_KEEP = 60 * 1024;     // PDF 提取文本保留量

  const TEXT_EXT = new Set([
    'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'jsonl', 'xml', 'yml', 'yaml',
    'toml', 'ini', 'cfg', 'conf', 'env', 'properties', 'gradle',
    'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte',
    'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'dart',
    'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'php', 'pas', 'r', 'lua', 'pl', 'pm',
    'html', 'htm', 'css', 'scss', 'less', 'svg',
    'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'sql', 'gitignore', 'dockerfile', 'makefile',
  ]);

  const uid = () => 'att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  const extOf = (name) => {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
  };

  const readDataURL = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('读取失败'));
    r.readAsDataURL(file);
  });

  const readText = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('读取失败'));
    r.readAsText(file);
  });

  async function inflate(bytes, format) {
    const ds = new DecompressionStream(format);
    const resp = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await resp.arrayBuffer());
  }

  function unescapePdfString(s) {
    return s
      .replace(/\\([nrtbf])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '' }[c]))
      .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
      .replace(/\\([()\\])/g, '$1');
  }

  function parseContentOps(text) {
    // 收集内容流里的 (...) 字符串字面量（Tj/TJ 绘制的文本）
    const out = [];
    const re = /\((?:\\[\s\S]|[^\\()])*\)/g;
    let m;
    while ((m = re.exec(text))) {
      const inner = m[0].slice(1, -1);
      const dec = unescapePdfString(inner);
      let bad = 0;
      for (const ch of dec) {
        const cc = ch.codePointAt(0);
        if (cc < 9 || (cc > 13 && cc < 32) || cc === 127) bad++;
      }
      if (dec.length && bad * 3 > dec.length) continue; // 乱码过滤
      out.push(dec);
    }
    return out.join('');
  }

  /** 尽力提取 PDF 文本：解压 FlateDecode 流并解析文本操作符；失败返回空串 */
  async function extractPdfText(arrayBuffer) {
    try {
      const bytes = new Uint8Array(arrayBuffer);
      let latin = '';
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) {
        latin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      }
      const pieces = [];
      const re = /stream\r?\n/g;
      let m;
      while ((m = re.exec(latin))) {
        const start = m.index + m[0].length;
        const end = latin.indexOf('endstream', start);
        if (end < 0) break;
        re.lastIndex = end;
        const chunk = bytes.subarray(start, end);
        if (!chunk.length) continue;
        let content = null;
        if (chunk[0] === 0x78) {
          try { content = new TextDecoder('utf-8', { fatal: false }).decode(await inflate(chunk, 'deflate')); } catch (_) {}
        }
        if (content == null) {
          try { content = new TextDecoder('utf-8', { fatal: false }).decode(await inflate(chunk, 'deflate-raw')); } catch (_) {}
        }
        if (content == null) content = new TextDecoder('latin1').decode(chunk);
        if (/BT|Tj|TJ/.test(content)) pieces.push(parseContentOps(content));
        if (pieces.join('').length > PDF_TEXT_KEEP * 3) break;
      }
      return pieces.join('\n').replace(/[ \t]+\n/g, '\n').trim().slice(0, PDF_TEXT_KEEP);
    } catch (_) {
      return '';
    }
  }

  /**
   * 处理文件列表 → 附件对象数组；单个文件失败通过 onError(消息) 上报并跳过
   */
  async function processFiles(fileList, onError) {
    const out = [];
    for (const f of Array.from(fileList || [])) {
      const e = extOf(f.name);
      const isImage = (f.type && f.type.startsWith('image/')) || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(e);
      const isPdf = (f.type === 'application/pdf') || e === 'pdf';
      try {
        if (isImage) {
          if (f.size > IMAGE_MAX) throw new Error(`「${f.name}」超过图片大小上限（6MB）`);
          out.push({ id: uid(), kind: 'image', name: f.name, mime: f.type || 'image/png', size: f.size, dataUrl: await readDataURL(f) });
        } else if (isPdf) {
          if (f.size > 25 * 1024 * 1024) throw new Error(`「${f.name}」超过 PDF 大小上限（25MB）`);
          const text = await extractPdfText(await f.arrayBuffer());
          if (text.replace(/\s+/g, '').length < 30) {
            throw new Error(`「${f.name}」无法提取文本（扫描件/加密/纯图 PDF 暂不支持）`);
          }
          out.push({ id: uid(), kind: 'pdf', name: f.name, size: f.size, text });
        } else if (TEXT_EXT.has(e) || (f.type && f.type.startsWith('text/'))) {
          if (f.size > TEXT_MAX) throw new Error(`「${f.name}」文本超过 400KB 上限`);
          out.push({ id: uid(), kind: 'text', name: f.name, size: f.size, text: await readText(f) });
        } else {
          throw new Error(`暂不支持的类型：「${f.name}」（支持图片 / 文本 / PDF）`);
        }
      } catch (err) {
        if (onError) onError(err.message);
      }
    }
    return out;
  }

  const fmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : n >= 1024 ? (n / 1024).toFixed(1) + 'KB' : n + 'B';

  window.FilesHelper = { processFiles, fmtSize };
})();
