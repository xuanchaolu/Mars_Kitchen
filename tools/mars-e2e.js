#!/usr/bin/env node
/* 火星小厨房 端到端测试：真实启动 Electron 应用 + Mock DeepSeek 服务器，
 * 验证「前端参数表单 → System Prompt 组装 → 送入 Deepseek → 工具调用计数 → 控制面板/提示信息渲染」全链路。
 *
 * 用法：node tools/mars-e2e.js
 * 退出码 0 = 全部通过。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TIMEOUT_MS = 180000;

/** 自动挑一个空闲端口（避免与系统服务/上次残留进程冲突） */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failures.push(name + (detail ? ' → ' + detail : '')); console.log('  ✗ ' + name + (detail ? '\n      → ' + detail : '')); }
}
function includes(hay, needle) { return String(hay).indexOf(needle) !== -1; }

(async () => {
  const PORT = Number(process.env.MARS_E2E_PORT) || await freePort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mars-e2e-'));
  // 数据隔离验证：伪造 PerPer / 牛来 的历史数据放在同一个 appData 根下。
  // 用 MARS_APPDATA 把 appData 重定向到临时目录（不碰用户真实的 ~/Library/Application Support），
  // 应用数据目录应只落在 appData/火星小厨房/ 下，且绝不读取这些伪造的旧数据。
  const appData = path.join(tmp, 'appdata');
  const userData = path.join(appData, '火星小厨房');
  const shotDir = process.env.MARS_E2E_SHOT_DIR ? path.resolve(process.env.MARS_E2E_SHOT_DIR) : path.join(tmp, 'shots');
  const mockLog = path.join(tmp, 'mock.jsonl');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(shotDir, { recursive: true });

  const LEGACY_CONV = 'PERPER-LEGACY-CONV-不该出现';
  const NIULAI_CONV = 'NIULAI-LEGACY-CONV-不该出现';
  const perperDir = path.join(appData, 'PerPer');
  const niulaiDir = path.join(appData, '牛来');
  fs.mkdirSync(perperDir, { recursive: true });
  fs.mkdirSync(niulaiDir, { recursive: true });
  fs.writeFileSync(path.join(perperDir, 'conversations.json'), JSON.stringify([
    { id: 'perper-legacy', title: LEGACY_CONV, createdAt: 1, updatedAt: 1, messages: [{ id: 'pm', role: 'user', content: '来自 PerPer 的历史消息', createdAt: 1 }] },
  ]), 'utf8');
  fs.writeFileSync(path.join(perperDir, 'settings.json'), JSON.stringify({
    apiKey: 'perper-key-should-not-be-read', model: 'perper-model-should-not-be-read', configVersion: 2,
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(niulaiDir, 'conversations.json'), JSON.stringify([
    { id: 'niulai-legacy', title: NIULAI_CONV, createdAt: 1, updatedAt: 1, messages: [] },
  ]), 'utf8');
  const perperConvBefore = fs.readFileSync(path.join(perperDir, 'conversations.json'), 'utf8');
  const niulaiConvBefore = fs.readFileSync(path.join(niulaiDir, 'conversations.json'), 'utf8');

  // 预置「本应用自己的」设置：指向 Mock 服务器。
  // 刻意不写 avatarEnabled / avatarAutoSpeak：验证「火星姐显示 + 自动播报」的默认值（都为 true）。
  // ttsEngine 用系统语音，避免测试环境拉起 Edge TTS 的 Python 进程。
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    apiKey: 'test-key',
    baseURL: 'http://127.0.0.1:' + PORT + '/v1',
    model: 'deepseek-flash',
    reasoningEnabled: false,
    temperature: 0.7,
    systemPrompt: '',
    configVersion: 2,
    webSearch: true,
    webSearchRounds: 3,
    ttsEngine: 'system',
  }, null, 2), 'utf8');

  console.log('E2E 临时目录: ' + tmp);
  console.log('\n[1] 启动 Mock DeepSeek 服务器');
  const mock = spawn(process.execPath, [path.join(__dirname, 'mars-mock-server.js'), String(PORT)], {
    env: Object.assign({}, process.env, { MARS_MOCK_LOG: mockLog }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // 任何退出路径都回收 Mock 服务器，避免残留进程占用端口
  const killMock = () => { try { mock.kill('SIGKILL'); } catch (_) {} };
  process.on('exit', killMock);
  process.on('SIGINT', () => { killMock(); process.exit(130); });
  const mockUp = await new Promise((resolve) => {
    let buf = '';
    const t = setTimeout(() => resolve(false), 10000);
    mock.stdout.on('data', (d) => {
      buf += d.toString();
      if (includes(buf, 'MARS_MOCK_UP')) { clearTimeout(t); resolve(true); }
    });
    mock.stderr.on('data', (d) => process.stderr.write('[mock] ' + d));
  });
  check('Mock 服务器已就绪 (127.0.0.1:' + PORT + ')', mockUp);

  console.log('\n[2] 启动 Electron 应用（MARS_APPDATA 指向临时数据根）');
  const APP_BIN = process.env.MARS_E2E_APP || null;
  let electronPath = null;
  if (!APP_BIN) {
    try { electronPath = require('electron'); } catch (e) { electronPath = null; }
    if (!electronPath) { console.error('找不到 electron 依赖，请先 npm install'); process.exit(1); }
  }

  // MARS_APPDATA 把数据根重定向到临时目录：应用数据目录应为 appData/火星小厨房/
  // 不再使用 MARS_USERDATA / MARS_LEGACY_DIR（旧版本的历史迁移逻辑已彻底移除）
  const env = Object.assign({}, process.env, {
    MARS_APPDATA: appData,
    MARS_SELFTEST: '1',
    MARS_SELFTEST_EVAL: process.env.MARS_E2E_PROBE || path.join(__dirname, 'mars-probe.js'),
    MARS_SHOT_DIR: shotDir,
    MARS_MOCK_SEARCH: '1',
  });
  // 清掉可能残留的旧变量名，确保走 MARS_*
  for (const k of Object.keys(env)) if (/^PERPER_/.test(k)) delete env[k];
  // 可选：探针跑完后按指定文件名截图（配合 MARS_E2E_PROBE 可生成文档截图）
  if (process.env.MARS_E2E_SHOT) env.MARS_SELFTEST_EVAL_SHOT = process.env.MARS_E2E_SHOT;

  // --no-sandbox / --disable-gpu：CI 与受限 shell 里 Chromium 无法初始化沙箱/GPU 时使用
  // MARS_E2E_APP=<打包后的可执行文件> 可直接对 dist 里的 .app 做同样的端到端验证
  const app = APP_BIN
    ? spawn(APP_BIN, ['--no-sandbox', '--disable-gpu'], { env: env, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(electronPath, ['--no-sandbox', '--disable-gpu', '.'], { cwd: ROOT, env: env, stdio: ['ignore', 'pipe', 'pipe'] });
  if (APP_BIN) console.log('    被测应用: ' + APP_BIN);
  let stdout = '';
  app.stdout.on('data', (d) => { stdout += d.toString(); });
  app.stderr.on('data', (d) => { const s = d.toString(); if (!/^\s*$/.test(s)) process.stderr.write('[app] ' + s); });

  const exited = await new Promise((resolve) => {
    const t = setTimeout(() => { try { app.kill('SIGKILL'); } catch (_) {} resolve(false); }, TIMEOUT_MS);
    app.on('exit', () => { clearTimeout(t); resolve(true); });
  });
  check('Electron 应用正常退出', exited, '超时 ' + TIMEOUT_MS + 'ms');

  console.log('\n[3] 校验渲染进程探针结果');
  const evalLine = stdout.split('\n').find((l) => l.indexOf('SELFTEST_EVAL ') === 0);
  let probeResult = null;   // 供后续「数据隔离」小节复用
  const basicsLine = stdout.split('\n').find((l) => l.indexOf('SELFTEST_BASICS ') === 0);
  if (basicsLine) console.log('    ' + basicsLine.trim());
  if (!evalLine) {
    check('探针返回结果', false, '未找到 SELFTEST_EVAL（可能是界面初始化失败）');
    console.log(stdout.slice(-3000));
  } else {
    const probe = JSON.parse(evalLine.slice('SELFTEST_EVAL '.length));
    const p = probe;
    probeResult = p;
    if (!p || !p.ui || !p.profile) {
      check('探针返回结构化结果', false, JSON.stringify(p).slice(0, 800));
      console.log(stdout.slice(-3000));
      try { mock.kill('SIGKILL'); } catch (_) {}
      process.exit(1);
    }

    check('人设档案已预加载（Skill/A/shtu/档位映射）', p.profile && p.profile.hasProfile && p.profile.missing.length === 0,
      JSON.stringify(p.profile && p.profile.missing));

    // ---- 需求 2：主界面不放参数配置栏 / Control 控制面板，改为首次启动弹窗 ----
    check('主界面已移除参数配置栏与控制面板', p.ui.mainHasParamBar === false && p.ui.mainHasControlPanel === false,
      JSON.stringify({ bar: p.ui.mainHasParamBar, panel: p.ui.mainHasControlPanel }));
    check('首次打开 App 自动弹出设置向导', p.ui.hasOnboard && p.onboard.visibleOnFirstRun === true && p.ui.obControls.length === 0,
      JSON.stringify({ onboard: p.ui.hasOnboard, visible: p.onboard.visibleOnFirstRun, missing: p.ui.obControls }));
    check('弹窗内参数控件完整：老年模式开关 + 辣/甜/咸 0-4 档 + 忌口 + 恢复默认 + 开始使用',
      p.ui.setControls.length === 0 && p.ui.spicyOptions === 5 && p.ui.sweetOptions === 5 && p.ui.saltyOptions === 5,
      JSON.stringify(p.ui));
    check('首次打开默认值 = 普通模式 / 辣0 甜0 咸0 / 忌口空',
      p.onboard.elderChecked === false && p.onboard.spicy === '0' && p.onboard.sweet === '0' && p.onboard.salty === '0' && p.onboard.avoid === '',
      JSON.stringify(p.onboard));

    const L = p.layout || {};
    check('布局：主界面只有对话区 + 右侧火星姐面板，无横向溢出',
      L.messages && L.messages.w >= 500 && L.avatarPanel && L.avatarPanel.w >= 250 && L.win.w >= 900 && L.overflowX <= 1,
      JSON.stringify(L));

    // ---- 需求 1：老年模式放大字号 ----
    check('打开老年模式后整体字号放大（弹窗内即时预览）',
      parseFloat(p.fonts.bodyAfterElder) > parseFloat(p.fonts.bodyBefore) &&
      parseFloat(p.fonts.modalTitleAfterElder) > parseFloat(p.fonts.modalTitleBefore) &&
      p.fonts.elderClassPreview === true,
      JSON.stringify(p.fonts));
    check('老年模式写入成功并加载 shtu 人设', p.afterOnboard.elderMode === true && p.afterOnboard.elderClass === true &&
      p.afterOnboard.onboarded === true && p.elderPrompt.hasShtu && !p.elderPrompt.hasA && p.elderPrompt.hasSkill && p.elderPrompt.hasLevels && p.elderPrompt.hasSnapshot,
      JSON.stringify({ after: p.afterOnboard, prompt: p.elderPrompt }));
    check('弹窗参数生效：辣1 甜2 咸1 + 忌口「虾过敏」',
      p.afterOnboard.spicy === 1 && p.afterOnboard.sweet === 2 && p.afterOnboard.salty === 1 && p.afterOnboard.avoid === '虾过敏',
      JSON.stringify(p.afterOnboard));
    check('AI 回答正文在老年模式下也是放大字号', parseFloat(p.answer.fontSize) > 16,
      'answer font-size=' + p.answer.fontSize);

    // ---- 需求：老年模式 + 辣/甜/咸最高两档 → 健康提醒弹窗（返回修改 / 确认并继续） ----
    check('老年模式 + 辣3/甜3 → 点「开始使用」弹出健康提醒',
      p.ui.hasHealthDialog && p.health.shown === true && p.health.items.length === 2 &&
      includes(p.health.items.join('|'), '辣度 3') && includes(p.health.items.join('|'), '甜度 3'),
      JSON.stringify(p.health));
    check('健康提醒有「返回修改」与「确认并继续」两个选择，且未落库',
      p.health.hasBackBtn && p.health.hasOkBtn && p.health.onboarded === false && p.health.onboardStillVisible === true,
      JSON.stringify(p.health));
    check('「返回修改」关掉提醒并留在设置弹窗继续改',
      p.healthAfterBack.hidden === true && p.healthAfterBack.onboardStillVisible === true && p.healthAfterBack.onboarded === false,
      JSON.stringify(p.healthAfterBack));
    check('改成安全档位后不再弹健康提醒', p.afterOnboard.healthShown === false, JSON.stringify(p.afterOnboard));
    check('老年模式 + 超咸(4) → 设置面板保存也弹提醒，「确认并继续」后才落库',
      p.settingsHealth.shown === true && includes(p.settingsHealth.items.join('|'), '咸度 4') &&
      p.settingsHealth.settingsStillOpen === true &&
      p.afterHealthConfirm.elderMode === true && p.afterHealthConfirm.salty === 4 && p.afterHealthConfirm.settingsClosed === true,
      JSON.stringify({ health: p.settingsHealth, after: p.afterHealthConfirm }));
    check('非老年模式选高档位不弹提醒', p.afterNormalSave.healthShown === false, JSON.stringify(p.afterNormalSave));

    // ---- 需求：档位应用原则写进 System Prompt（不要机械套用；甜咸谁高听谁） ----
    check('System Prompt 要求「不要机械套用档位 + 甜咸谁高听谁 + 不输出提示信息」',
      p.elderPromptAfterChat.preferSweet === true && p.elderPromptAfterChat.notMechanical === true && p.elderPromptAfterChat.noHintFormat === true,
      JSON.stringify(p.elderPromptAfterChat));

    // ---- 需求 4：火星姐形象 + 语音默认开启 ----
    check('火星姐模型显示 + 自动播报默认开启',
      p.avatar && p.avatar.enabled === true && p.avatar.autoSpeak === true && p.avatar.model === 'Martian.vrm' && p.avatar.panelVisible === true,
      JSON.stringify(p.avatar));

    // ---- 回答渲染：不要提示信息 ----
    check('回答已渲染完成且带 markdown 表格', p.answer.finished && p.answer.hasTable && p.answer.tableRows >= 2, JSON.stringify(p.answer));
    check('回答里没有【提示信息】/参数快照/联网搜索次数',
      p.answer.containsHintMark === false && p.answer.containsBodyMark === false &&
      p.answer.containsParamSnapshot === false && p.answer.containsSearchCount === false &&
      p.answer.hasHintBlock === false && p.answer.hasBodyBadge === false,
      JSON.stringify(p.answer));
    check('正文本体（做法/忌口说明）仍然正常显示',
      includes(p.answer.text, '鸡蛋打散') && includes(p.answer.text, '不含虾'),
      p.answer.text.slice(0, 160));
    check('工具调用计数：联网搜索 1 次（次数仍在气泡搜索框里展示）',
      p.afterChat.counts.search === 1 && p.afterChat.counts.total === 1 && p.answer.containsSearchBox === true,
      JSON.stringify({ counts: p.afterChat.counts, searchBox: p.answer.containsSearchBox }));

    // ---- 之后可在「设置」里修改 ----
    check('设置面板同步显示已保存的参数',
      p.settingsPanel.elderChecked === true && p.settingsPanel.spicy === '1' && p.settingsPanel.sweet === '2' &&
      p.settingsPanel.salty === '1' && p.settingsPanel.avoid === '虾过敏',
      JSON.stringify(p.settingsPanel));
    check('在设置里关闭老年模式后字号恢复',
      p.afterNormalSave.elderMode === false && p.afterNormalSave.elderClass === false &&
      parseFloat(p.afterNormalSave.bodyFontSize) === parseFloat(p.fonts.bodyBefore),
      JSON.stringify(p.afterNormalSave));
  }

  console.log('\n[4] 校验真正发给 Deepseek 的 System Prompt / tools');
  const requests = fs.existsSync(mockLog)
    ? fs.readFileSync(mockLog, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean)
    : [];
  check('收到 2 轮请求（工具调用 + 最终回答）', requests.length >= 2, '实际 ' + requests.length);

  const first = requests[0];
  if (first) {
    const sys = (first.body.messages.find((m) => m.role === 'system') || {}).content || '';
    console.log('    System Prompt 长度: ' + sys.length + ' 字符');
    check('请求 1 System Prompt 含 Skill.md 全文', includes(sys, 'Skill.md 全局技能定义') && includes(sys, '## 1. 可用工具') && includes(sys, '## 3. 全局安全规则'));
    check('请求 1 System Prompt 含老年人版人设 shtu', includes(sys, 'shtu 老年人版人设') && includes(sys, '关好煤气'));
    check('请求 1 System Prompt 不含普通版 A.md', !includes(sys, 'A.md 普通版人设'));
    check('请求 1 System Prompt 含档位映射规则', includes(sys, '# 档位映射') && includes(sys, '4爆辣：重辣，需要附带肠胃风险提示') && includes(sys, '忌口过敏（全局生效，涉及食材必遵守）'));
    check('请求 1 System Prompt 含用户参数快照', includes(sys, '版本=老年人版') && includes(sys, '辣度=1') && includes(sys, '甜度=2') && includes(sys, '咸度=1') && includes(sys, '忌口&过敏：虾过敏'));
    const order = ['Skill.md 全局技能定义', 'shtu 老年人版人设', '# 档位映射', '## 当前用户配置'].map((t) => sys.indexOf(t));
    check('组装顺序 = Skill → 人设 → 档位映射 → 参数快照', order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), JSON.stringify(order));
    check('美食类问题 → 档位判定为生效', includes(sys, '档位**全部生效**'));
    check('老年人版 + 做饭场景 → System Prompt 强制要求追加煤气安全提醒',
      includes(sys, '本题判定为「做饭 / 用火 / 烧水 / 燃气」场景') && includes(sys, '回答末尾要用一句话加上安全提醒'), '');
    check('联网搜索工具仍然提供给模型', !!(first.body.tools || []).find((t) => t.function && t.function.name === 'web_search'));
    check('无关技能已移除（skill_hcy 不再随包，也不再注入）', !includes(sys, '德文猫') && !includes(sys, 'hcy-fan-insider'));
  }

  const second = requests[1];
  if (second) {
    const toolMsgs = second.body.messages.filter((m) => m.role === 'tool');
    check('请求 2 携带 web_search 工具结果（联网搜索已执行）', toolMsgs.length >= 1 && includes(JSON.stringify(toolMsgs[0]), '番茄炒蛋'),
      'tool 消息数=' + toolMsgs.length);
    const sys2 = (second.body.messages.find((m) => m.role === 'system') || {}).content || '';
    check('请求 2 System Prompt 仍保持 Mars 组装结构', includes(sys2, 'shtu 老年人版人设') && includes(sys2, '版本=老年人版'));
  }

  console.log('\n[5] 校验人设档案播种到用户数据目录');
  const seeded = path.join(userData, 'mars_profile');
  check('userData/mars_profile 已播种（可编辑）',
    ['Skill.md', 'A.md', 'shtu.md', '档位映射.md'].every((f) => fs.existsSync(path.join(seeded, f))),
    fs.existsSync(seeded) ? fs.readdirSync(seeded).join(', ') : '目录不存在');

  console.log('\n[6] 校验与 PerPer / 牛来 数据完全隔离');
  check('应用数据目录只落在 appData/火星小厨房/（目录名即产品名）',
    fs.existsSync(userData) && path.basename(userData) === '火星小厨房', userData);
  const convFile = path.join(userData, 'conversations.json');
  const convText = fs.existsSync(convFile) ? fs.readFileSync(convFile, 'utf8') : '';
  check('未导入 PerPer / 牛来的历史会话',
    !includes(convText, LEGACY_CONV) && !includes(convText, NIULAI_CONV) && convText.length > 0,
    'conversations.json 长度=' + convText.length);
  if (probeResult) {
    const titles = (probeResult.convs || []).join(' | ');
    check('界面上只有本次新建的对话（没有旧版历史）',
      !includes(titles, 'PERPER-LEGACY') && !includes(titles, 'NIULAI-LEGACY') && !includes(titles, 'PerPer'),
      titles);
  }
  check('未导入 PerPer 的 API Key / 模型设置',
    !includes(JSON.stringify(requests[0] && requests[0].body), 'perper-key-should-not-be-read') &&
    !includes(JSON.stringify(requests[0] && requests[0].body), 'perper-model-should-not-be-read'),
    'mock 收到的 model=' + (requests[0] && requests[0].body && requests[0].body.model));
  check('PerPer / 牛来 的原始数据文件未被修改',
    fs.readFileSync(path.join(perperDir, 'conversations.json'), 'utf8') === perperConvBefore &&
    fs.readFileSync(path.join(niulaiDir, 'conversations.json'), 'utf8') === niulaiConvBefore);

  try { mock.kill('SIGKILL'); } catch (_) {}

  console.log('\n──────────────────────────────');  if (failures.length) {
    console.log('❌ 端到端失败 ' + failures.length + ' 项 / 通过 ' + passed + ' 项');
    failures.forEach((f) => console.log('   · ' + f));
    process.exit(1);
  }
  console.log('✅ 端到端全部通过：' + passed + ' 项');
  process.exit(0);
})().catch((e) => {
  console.error('E2E 运行异常:', e);
  process.exit(1);
});
