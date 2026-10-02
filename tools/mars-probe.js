/* 火星小厨房 端到端探针：在渲染进程里驱动真实界面，验证
 *   - 首次打开 App 弹窗设置（老年模式开关 / 口味档位 / 忌口过敏）
 *   - 主界面没有参数配置栏、没有 Control 控制面板
 *   - 老年模式放大字号（含 AI 回答正文）
 *   - 老年模式 + 辣/甜/咸最高两档 → 健康提醒弹窗（返回修改 / 确认并继续）
 *   - 回答里不再出现【提示信息】/ 参数快照 / 联网搜索调用次数
 *   - 火星姐形象与自动播报默认开启
 * 由 tools/mars-e2e.js 通过 MARS_SELFTEST_EVAL 注入执行。
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);
  const out = {};

  // 0. 等人设档案预加载完成
  for (let i = 0; i < 75; i++) {
    const m = window.__niuMars ? window.__niuMars() : null;
    if (m && m.profile && m.profile.hasProfile) break;
    await sleep(200);
  }
  const mars = () => window.__niuMars();
  const healthVisible = () => !!(mars && $('health-overlay') && !$('health-overlay').classList.contains('hidden'));
  const onboardVisible = () => !!(mars && $('onboard-overlay') && !$('onboard-overlay').classList.contains('hidden'));
  const setSel = (id, v) => { const el = $(id); el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true })); };

  out.ui = {
    hasMarsModule: typeof window.Mars !== 'undefined',
    mainHasParamBar: !!$('mars-bar'),
    mainHasControlPanel: !!$('control-panel'),
    hasOnboard: !!$('onboard-overlay'),
    hasHealthDialog: !!$('health-overlay'),
    obControls: ['ob-elder', 'ob-spicy', 'ob-sweet', 'ob-salty', 'ob-avoid', 'ob-defaults', 'ob-save'].filter((id) => !$(id)),
    setControls: ['set-elder', 'set-spicy', 'set-sweet', 'set-salty', 'set-avoid'].filter((id) => !$(id)),
    spicyOptions: $('ob-spicy') ? $('ob-spicy').options.length : 0,
    sweetOptions: $('ob-sweet') ? $('ob-sweet').options.length : 0,
    saltyOptions: $('ob-salty') ? $('ob-salty').options.length : 0,
  };
  out.profile = mars().profile;

  // 布局体检：对话区够宽（没有侧边控制面板）、火星姐面板在右侧、无横向溢出
  const rect = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left) };
  };
  out.layout = {
    win: { w: window.innerWidth, h: window.innerHeight },
    messages: rect('#messages'),
    input: rect('#input-shell'),
    avatarPanel: rect('#avatar-panel'),
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  };

  // 1. 首次打开 App：引导弹窗应自动出现，且默认值 = 普通模式 / 辣0 甜0 咸0 / 忌口空
  out.onboard = {
    visibleOnFirstRun: mars().onboardVisible,
    elderChecked: $('ob-elder') ? $('ob-elder').checked : null,
    spicy: $('ob-spicy') ? $('ob-spicy').value : null,
    sweet: $('ob-sweet') ? $('ob-sweet').value : null,
    salty: $('ob-salty') ? $('ob-salty').value : null,
    avoid: $('ob-avoid') ? $('ob-avoid').value : null,
  };
  out.fonts = {
    bodyBefore: getComputedStyle(document.body).fontSize,
    modalTitleBefore: (() => {
      const el = document.querySelector('.onboard-modal .switch-text b');
      return el ? getComputedStyle(el).fontSize : null;
    })(),
  };

  // 2. 老年模式 + 辣3/甜3（最高两档）→ 点「开始使用」应弹健康提醒
  $('ob-elder').checked = true;
  $('ob-elder').dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(200);
  out.fonts.bodyAfterElder = getComputedStyle(document.body).fontSize;
  out.fonts.modalTitleAfterElder = (() => {
    const el = document.querySelector('.onboard-modal .switch-text b');
    return el ? getComputedStyle(el).fontSize : null;
  })();
  out.fonts.elderClassPreview = document.body.classList.contains('elder-mode');

  setSel('ob-spicy', 3);
  setSel('ob-sweet', 3);
  setSel('ob-salty', 0);
  $('ob-save').click();
  await sleep(250);
  out.health = {
    shown: healthVisible(),
    items: $('health-list') ? [...$('health-list').querySelectorAll('.health-item b')].map((e) => e.textContent) : [],
    hasBackBtn: !!$('health-back'),
    hasOkBtn: !!$('health-ok'),
    onboardStillVisible: onboardVisible(),
    onboarded: mars().settings.onboarded,
  };

  // 「返回修改」：关掉提醒，留在弹窗继续改（不落库）
  $('health-back').click();
  await sleep(200);
  out.healthAfterBack = {
    hidden: !healthVisible(),
    onboardStillVisible: onboardVisible(),
    onboarded: mars().settings.onboarded,
  };

  // 3. 改成安全档位（辣1 甜2 咸1）+ 忌口，再点「开始使用」→ 不应再弹提醒
  setSel('ob-spicy', 1);
  setSel('ob-sweet', 2);
  setSel('ob-salty', 1);
  $('ob-avoid').value = '虾过敏';
  $('ob-avoid').dispatchEvent(new Event('input', { bubbles: true }));
  $('ob-save').click();
  await sleep(350);

  out.afterOnboard = {
    visible: mars().onboardVisible,
    onboarded: mars().settings.onboarded,
    healthShown: healthVisible(),
    elderMode: mars().settings.elderMode,
    spicy: mars().settings.spicy,
    sweet: mars().settings.sweet,
    salty: mars().settings.salty,
    avoid: mars().settings.avoid,
    elderClass: mars().elderClass,
  };
  const promptElder = mars().systemPrompt;
  out.elderPrompt = {
    hasSkill: promptElder.indexOf('Skill.md 全局技能定义') >= 0,
    hasShtu: promptElder.indexOf('shtu 老年人版人设') >= 0,
    hasA: promptElder.indexOf('A.md 普通版人设') >= 0,
    hasLevels: promptElder.indexOf('# 档位映射') >= 0,
    hasSnapshot: promptElder.indexOf('版本=老年人版') >= 0,
    noHintFormat: promptElder.indexOf('不要输出【主体回答】【提示信息】') >= 0,
    preferSweet: false,   // 由聊天后的 elderPromptAfterChat 断言（需要一条美食类用户问题才会注入档位应用原则）
  };

  // 4. 火星姐形象与自动播报默认开启
  out.avatar = mars().avatar;

  // 5. 发送美食类问题（触发联网搜索工具调用 → 第二轮给出带表格的回答）
  const input = $('input');
  input.value = '番茄炒蛋怎么做？';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  $('btn-send').click();

  const t0 = Date.now();
  let finished = false;
  while (Date.now() - t0 < 90000) {
    await sleep(400);
    const rows = [...document.querySelectorAll('#messages .msg-row')];
    const last = rows[rows.length - 1];
    const b = last ? last.querySelector('.assistant-body') : null;
    const cursor = last ? last.querySelector('.typing-cursor') : null;
    if (b && !cursor && b.textContent.replace('思考中…', '').trim().length > 10) { finished = true; break; }
  }

  const rows = [...document.querySelectorAll('#messages .msg-row')];
  const last = rows[rows.length - 1];
  const body = last ? last.querySelector('.assistant-body') : null;
  const table = body ? body.querySelector('.md-table') : null;
  const text = body ? body.textContent.replace(/\s+/g, ' ').trim() : '';
  out.answer = {
    finished: finished,
    text: text.slice(0, 300),
    hasTable: !!table,
    tableRows: table ? table.querySelectorAll('tbody tr').length : 0,
    fontSize: body ? getComputedStyle(body).fontSize : null,
    hasHintBlock: !!(body && body.querySelector('.mars-hint')),
    hasBodyBadge: !!(body && body.querySelector('.mars-body-mark')),
    containsHintMark: text.indexOf('提示信息') >= 0,
    containsBodyMark: text.indexOf('主体回答') >= 0,
    containsParamSnapshot: text.indexOf('当前生效参数') >= 0,
    containsSearchCount: text.indexOf('联网搜索调用次数') >= 0,
    containsSearchBox: !!(last && last.querySelector('.search-box')),
  };
  out.afterChat = mars();
  const promptAfterChat = mars().systemPrompt;   // 此时有美食类用户问题，才会注入档位应用原则
  out.elderPromptAfterChat = {
    hasShtu: promptAfterChat.indexOf('shtu 老年人版人设') >= 0,
    preferSweet: promptAfterChat.indexOf('优先推荐甜口') >= 0,
    notMechanical: promptAfterChat.indexOf('菜品本身没有该味型时不要强行加辣/加糖/加盐') >= 0,
    noHintFormat: promptAfterChat.indexOf('不要输出【主体回答】【提示信息】等标记') >= 0,
  };
  out.messages = window.__niuMessages ? window.__niuMessages() : null;
  out.convs = window.__niuDebug ? window.__niuDebug().convs.map((c) => c.title) : null;

  // 6. 设置面板：改成普通模式 → 保存后字号恢复；再试一次老年模式 + 咸4 → 应弹健康提醒
  $('btn-settings').click();
  await sleep(250);
  out.settingsPanel = {
    elderChecked: $('set-elder') ? $('set-elder').checked : null,
    spicy: $('set-spicy') ? $('set-spicy').value : null,
    sweet: $('set-sweet') ? $('set-sweet').value : null,
    salty: $('set-salty') ? $('set-salty').value : null,
    avoid: $('set-avoid') ? $('set-avoid').value : null,
  };
  // 6a. 老年模式 + 超咸(4) → 保存应弹提醒，「确认并继续」后才落库
  setSel('set-salty', 4);
  $('btn-save-settings').click();
  await sleep(250);
  out.settingsHealth = {
    shown: healthVisible(),
    items: $('health-list') ? [...$('health-list').querySelectorAll('.health-item b')].map((e) => e.textContent) : [],
    settingsStillOpen: !$('settings-overlay').classList.contains('hidden'),
  };
  $('health-ok').click();
  await sleep(400);
  out.afterHealthConfirm = {
    elderMode: mars().settings.elderMode,
    salty: mars().settings.salty,
    settingsClosed: $('settings-overlay').classList.contains('hidden'),
  };

  // 6b. 关掉老年模式 → 字号恢复，且高档位不再弹提醒
  $('btn-settings').click();
  await sleep(250);
  $('set-elder').checked = false;
  $('set-elder').dispatchEvent(new Event('change', { bubbles: true }));
  setSel('set-salty', 4);
  $('btn-save-settings').click();
  await sleep(400);
  out.afterNormalSave = {
    elderMode: mars().settings.elderMode,
    elderClass: mars().elderClass,
    bodyFontSize: mars().bodyFontSize,
    healthShown: healthVisible(),
  };

  return out;
})()
