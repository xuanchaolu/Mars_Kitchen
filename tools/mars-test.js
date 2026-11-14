#!/usr/bin/env node
/* 火星小厨房 单元测试：System Prompt 组装 / 档位映射 / 输出解析 / 表格提取
 *
 * 用法：node tools/mars-test.js
 * 退出码 0 = 全部通过，1 = 有失败用例。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Mars = require(path.join(ROOT, 'renderer', 'js', 'mars.js'));
const Markdown = require(path.join(ROOT, 'renderer', 'js', 'markdown.js'));

// ---------- 迷你测试框架 ----------
let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failures.push({ name, message: e && e.message ? e.message : String(e) }); console.log('  ✗ ' + name + '\n      → ' + (e && e.message)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function assertIncludes(hay, needle, msg) {
  if (String(hay).indexOf(needle) === -1) throw new Error((msg || '缺少内容') + '：' + JSON.stringify(String(needle).slice(0, 60)));
}
function assertExcludes(hay, needle, msg) {
  if (String(hay).indexOf(needle) !== -1) throw new Error((msg || '不应包含') + '：' + JSON.stringify(String(needle).slice(0, 60)));
}

// ---------- 读取真实人设档案，构造与主进程一致的 profile ----------
const PROFILE_DIR = path.join(ROOT, 'mars_profile');
function readFile(name) {
  const p = path.join(PROFILE_DIR, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}
const profile = {
  ok: true,
  dir: PROFILE_DIR,
  files: {
    skill: { label: 'Skill.md', file: 'Skill.md', text: readFile('Skill.md') },
    personaNormal: { label: 'A.md', file: 'A.md', text: readFile('A.md') },
    personaElderly: { label: 'shtu', file: 'shtu.md', text: readFile('shtu.md') },
    levels: { label: '档位映射', file: '档位映射.md', text: readFile('档位映射.md') },
  },
  missing: [],
};

const NORMAL = { marsVersion: 'normal', marsSpicy: 0, marsSweet: 0, marsSalty: 0, marsAvoid: '' };
const ELDERLY = { marsVersion: 'elderly', marsSpicy: 1, marsSweet: 2, marsSalty: 2, marsAvoid: '虾过敏' };
const FOOD_Q = '番茄炒蛋怎么做才好吃？';
const NON_FOOD_Q = '秦始皇是哪一年统一六国的？';

console.log('\n[1] 人设档案文件');
test('四份素材文件都存在且非空', () => {
  for (const k of Object.keys(profile.files)) {
    assert(profile.files[k].text.trim().length > 20, k + ' 内容为空');
  }
});
test('Skill.md 含工具/流程/安全/输出/边界五节', () => {
  const s = profile.files.skill.text;
  for (const t of ['## 1. 可用工具', '## 2. 固定执行流程', '## 3. 全局安全规则', '## 4. 输入输出格式要求', '## 5. 边界规则']) {
    assertIncludes(s, t, 'Skill.md 缺少章节');
  }
});
test('档位映射文件含辣/甜/咸/忌口四节', () => {
  const s = profile.files.levels.text;
  for (const t of ['## 辣度', '## 甜度', '## 咸度', '## 忌口过敏']) assertIncludes(s, t, '档位映射缺少');
});
test('shtu 含长辈称呼与煤气安全提醒，A.md 不含', () => {
  const shtu = profile.files.personaElderly.text;
  const a = profile.files.personaNormal.text;
  assertIncludes(shtu, '您', 'shtu 缺少长辈称呼');
  assertIncludes(shtu, '关好煤气', 'shtu 缺少煤气安全提醒');
  assertExcludes(a, '关好煤气', 'A.md 不应含居家安全提醒');
  assertIncludes(a, '语言简洁清晰', 'A.md 内容不符');
});
test('无关技能（skill_hcy）已从项目中移除', () => {
  assert(!fs.existsSync(path.join(ROOT, 'skill_hcy')), 'skill_hcy 目录仍存在');
});
test('应用名为「火星小厨房」，且已彻底移除 PerPer / 牛来的历史数据迁移', () => {
  const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  assertIncludes(src, "app.setName('火星小厨房')", '应用名不是「火星小厨房」');
  assert(src.indexOf('migrateLegacyData') === -1, 'main.js 仍含历史数据迁移逻辑');
  assert(src.indexOf('LEGACY_DIR') === -1, 'main.js 仍引用 LEGACY_DIR 迁移开关');
  // 只看代码（去掉行注释），确认不再读写旧版本的数据目录
  const code = src.replace(/\/\/.*$/gm, '');
  assert(code.indexOf("'PerPer'") === -1 && code.indexOf('"PerPer"') === -1, 'main.js 仍引用 PerPer 数据目录');
  assert(code.indexOf('牛来') === -1, 'main.js 仍引用 牛来 数据目录');
});
test('界面文案已全部改为「火星小厨房」', () => {
  const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'renderer', 'js', 'app.js'), 'utf8');
  assertIncludes(html, '<title>火星小厨房</title>', '窗口标题未改名');
  assertIncludes(html, 'class="brand">火星小厨房', '顶栏品牌名未改名');
  assertIncludes(html, 'id="avatar-name">火星小厨房', '虚拟形象名未改名');
  assertIncludes(app, "'<h1>火星小厨房 AI</h1>'", '欢迎页标题未改名');
  assertIncludes(app, '<span class="msg-name">火星小厨房</span>', '气泡里的助手名未改名');
  for (const s of [html, app]) {
    assertExcludes(s, '火星小食堂', '界面仍残留旧中文名 火星小食堂');
    assertExcludes(s, 'Mars_Canteen', '界面仍残留旧英文名 Mars_Canteen');
    assertExcludes(s, 'Mars_Kitchen', '界面应只显示中文名，不应出现英文标识 Mars_Kitchen');
  }
});

console.log('\n[2] 版本选择：A.md / shtu 二选一');
test('普通版只加载 A.md，不含 shtu', () => {
  const p = Mars.buildSystemPrompt(profile, NORMAL, { userText: FOOD_Q });
  assertIncludes(p, 'A.md 普通版人设', '普通版应注入 A.md');
  assertExcludes(p, 'shtu 老年人版人设', '普通版不应注入 shtu');
  assertExcludes(p, '关好煤气', '普通版不应有煤气提醒');
});
test('老年人版只加载 shtu，不含 A.md', () => {
  const p = Mars.buildSystemPrompt(profile, ELDERLY, { userText: FOOD_Q });
  assertIncludes(p, 'shtu 老年人版人设', '老年人版应注入 shtu');
  assertIncludes(p, '关好煤气', '老年人版应有安全提醒规则');
  assertExcludes(p, 'A.md 普通版人设', '老年人版不应注入 A.md');
});
test('两个版本的 prompt 都包含 Skill.md 全文与档位映射', () => {
  for (const st of [NORMAL, ELDERLY]) {
    const p = Mars.buildSystemPrompt(profile, st, { userText: FOOD_Q });
    assertIncludes(p, 'Skill.md 全局技能定义', '缺少 Skill.md');
    assertIncludes(p, '# 档位映射', '缺少档位映射');
    assertIncludes(p, '4爆辣：重辣，需要附带肠胃风险提示', '档位映射内容不完整');
  }
});

console.log('\n[3] System Prompt 组装顺序（Skill → 人设 → 档位映射 → 参数快照）');
test('四段顺序正确且参数快照在最后', () => {
  const p = Mars.buildSystemPrompt(profile, ELDERLY, { userText: FOOD_Q });
  const iSkill = p.indexOf('Skill.md 全局技能定义');
  const iPersona = p.indexOf('shtu 老年人版人设');
  const iLevels = p.indexOf('## 辣度');
  const iSnap = p.indexOf('## 当前用户配置');
  assert(iSkill >= 0 && iPersona > iSkill && iLevels > iPersona && iSnap > iLevels,
    '顺序应为 Skill → 人设 → 档位映射 → 参数快照，实际: ' + [iSkill, iPersona, iLevels, iSnap].join(','));
});
test('参数快照完整包含版本/辣/甜/咸/忌口', () => {
  const p = Mars.buildSystemPrompt(profile, ELDERLY, { userText: FOOD_Q });
  assertIncludes(p, '版本=老年人版');
  assertIncludes(p, '辣度=1');
  assertIncludes(p, '甜度=2');
  assertIncludes(p, '咸度=2');
  assertIncludes(p, '忌口&过敏：虾过敏');
  assertIncludes(p, '只输出回答正文');
});
test('需求文档给出的老年人版组装片段形态一致', () => {
  const p = Mars.buildSystemPrompt(profile, ELDERLY, { userText: '红烧肉怎么做' });
  assert(/版本=老年人版；辣度=1；甜度=2；咸度=2；忌口&过敏：虾过敏/.test(p), '参数快照行格式不符');
});

console.log('\n[4] 边界规则：味觉档位只对美食类生效');
test('美食问题 → 档位全部生效', () => {
  const p = Mars.buildSystemPrompt(profile, ELDERLY, { userText: FOOD_Q });
  assertIncludes(p, '档位**全部生效**');
  assert(Mars.isFoodQuestion(FOOD_Q) === true, '番茄炒蛋应判定为美食类');
});
test('非美食问题 → 忽略辣/甜/咸，仅保留人设与忌口', () => {
  const p = Mars.buildSystemPrompt(profile, ELDERLY, { userText: NON_FOOD_Q });
  assertIncludes(p, '忽略辣度、甜度、咸度档位');
  assert(Mars.isFoodQuestion(NON_FOOD_Q) === false, '历史问题不应判定为美食类');
  assertIncludes(p, 'shtu 老年人版人设', '非美食问题仍应保留人设');
  assertIncludes(p, '忌口&过敏：虾过敏', '非美食问题仍应保留忌口约束');
});
test('问题分类器：常见菜谱/食材/做饭问法都算美食类', () => {
  const foods = ['番茄炒蛋怎么做？', '冰箱里有鸡蛋和青椒，能做什么？', '推荐几个低盐的菜', '红烧排骨的做法', '给宝宝做辅食要注意什么', '这汤咸不咸'];
  for (const q of foods) assert(Mars.isFoodQuestion(q) === true, '应判定为美食类：' + q);
});
test('问题分类器：非美食问题不误判', () => {
  const others = ['秦始皇是哪一年统一六国的？', '帮我写一段 Swift 代码', '介绍一下量子纠缠', '股票怎么做技术分析'];
  for (const q of others) assert(Mars.isFoodQuestion(q) === false, '不应判定为美食类：' + q);
});

console.log('\n[4b] 边界规则：老年人版煤气安全提醒只在做饭/用火场景强制');
test('老年人版 + 做饭问题 → 强制追加安全提示', () => {
  const p = Mars.buildSystemPrompt(profile, ELDERLY, { userText: '番茄炒蛋怎么做？' });
  assertIncludes(p, '回答末尾要用一句话加上安全提醒');
  assertIncludes(p, '用完记得关好煤气');
  assert(Mars.isKitchenQuestion('番茄炒蛋怎么做？') === true, '菜谱应判定为厨房场景');
});
test('老年人版 + 烧水/燃气问题 → 强制追加安全提示', () => {
  for (const q of ['烧水要注意什么', '家里燃气灶打不着火怎么办', '做饭时火候怎么掌握']) {
    assert(Mars.isKitchenQuestion(q) === true, '应判定为厨房场景：' + q);
    assertIncludes(Mars.buildSystemPrompt(profile, ELDERLY, { userText: q }), '回答末尾要用一句话加上安全提醒', q);
  }
});
test('老年人版 + 非厨房问题 → 不强制煤气提醒，但仍保持「您」称呼', () => {
  const p = Mars.buildSystemPrompt(profile, ELDERLY, { userText: '秦始皇是哪一年统一六国的？' });
  assert(Mars.isKitchenQuestion('秦始皇是哪一年统一六国的？') === false, '历史问题不应判定为厨房场景');
  assertExcludes(p, '本题判定为「做饭 / 用火 / 烧水 / 燃气」场景', '非厨房问题不应出现强制提醒行');
  assertIncludes(p, '非厨房问题不需要煤气提醒', '应显式说明非厨房场景不用煤气提醒');
  assertIncludes(p, 'shtu 老年人版人设', '仍应加载老年人版人设（含「您」称呼）');
});
test('普通版 → 任何问题都不会追加煤气安全提醒', () => {
  for (const q of ['番茄炒蛋怎么做？', '烧水要注意什么']) {
    const p = Mars.buildSystemPrompt(profile, NORMAL, { userText: q });
    assertExcludes(p, '回答末尾一定要加上安全提示', '普通版不应有安全提醒强制行：' + q);
    assertExcludes(p, '关好煤气', '普通版不应出现煤气提醒：' + q);
  }
});

console.log('\n[5] 档位取值与快照');
test('档位越界/脏数据被夹取到 0..4', () => {
  const s = Mars.snapshot({ marsVersion: 'elderly', marsSpicy: 9, marsSweet: -3, marsSalty: '2.6' });
  assert(s.spicy.level === 4, '辣度应夹到 4，实际 ' + s.spicy.level);
  assert(s.sweet.level === 0, '甜度应夹到 0，实际 ' + s.sweet.level);
  assert(s.salty.level === 3, '咸度应四舍五入到 3，实际 ' + s.salty.level);
});
test('未知版本回落普通版', () => {
  assert(Mars.snapshot({ marsVersion: 'xxx' }).version === 'normal', '未知版本应回落 normal');
});
test('档位名称与档位映射一致', () => {
  assert(Mars.levelName('spicy', 4) === '4 爆辣', '辣度名称不符');
  assert(Mars.levelName('sweet', 0) === '0 无糖', '甜度名称不符');
  assert(Mars.levelName('salty', 3) === '3 很咸', '咸度名称不符');
});
test('snapshotLine 一行式摘要格式正确', () => {
  const line = Mars.snapshotLine(Mars.snapshot(ELDERLY));
  assert(line === '版本=老年人版，辣度=1（微辣），甜度=2（中甜），咸度=2（中咸）；忌口：虾过敏', '实际: ' + line);
});

console.log('\n[6] 输出解析（只要正文，不显示提示信息）');
test('旧版两段式输出被剥成纯正文', () => {
  const raw = '【主体回答】\n番茄炒蛋的做法：\n1. 打蛋\n2. 炒制\n\n【提示信息】\n> 当前生效参数：版本=老年人版，辣度=1，甜度=2，咸度=2；忌口：虾过敏\n> 联网搜索调用次数：1次';
  const r = Mars.parseOutput(raw);
  assert(r.hasMarkers === true, '应识别到标记');
  assertIncludes(r.body, '番茄炒蛋的做法', '正文内容缺失');
  assertExcludes(r.body, '【主体回答】', '正文不应保留标记');
  assertExcludes(r.body, '【提示信息】', '正文不应含提示信息标记');
  assertExcludes(r.body, '当前生效参数', '正文不应含参数快照');
  assertExcludes(r.body, '联网搜索调用次数', '正文不应含调用次数');
});
test('只有主体回答时也能解析', () => {
  const r = Mars.parseOutput('【主体回答】\n随便写点');
  assert(r.body.trim() === '随便写点', '实际: ' + JSON.stringify(r.body));
  assert(r.hint === '', 'hint 应为空');
});
test('模型直接输出纯正文时原样返回', () => {
  const r = Mars.parseOutput('完全没有标记的一段回答');
  assert(r.hasMarkers === false, 'hasMarkers 应为 false');
  assert(r.body === '完全没有标记的一段回答', 'body 应为原文');
});
test('流式过程中的半截标记不丢正文', () => {
  const r = Mars.parseOutput('番茄炒蛋要先【主体回答】');
  assertIncludes(r.body, '番茄炒蛋要先', '正文丢失');
  assert(r.hasBody === true, '应识别到标记');
});
test('Skill.md 已删除【主体回答】/【提示信息】输出格式要求', () => {
  const skill = profile.files.skill.text;
  assertExcludes(skill, '【提示信息】\n', 'Skill.md 仍把提示信息当作输出段落');
  assertExcludes(skill, '当前生效参数：版本=xxx', 'Skill.md 仍在要求输出参数快照');
  assertIncludes(skill, '只输出回答正文', 'Skill.md 未声明只输出正文');
  assertIncludes(skill, '不要输出「联网搜索调用次数：N次」', 'Skill.md 未禁止输出调用次数');
});
test('System Prompt 末尾明确要求不输出提示信息', () => {
  const p = Mars.buildSystemPrompt(profile, ELDERLY, { userText: FOOD_Q });
  assertIncludes(p, '不要输出【主体回答】【提示信息】等标记', '未禁止输出标记');
  assertIncludes(p, '也不要输出参数快照或联网搜索调用次数', '未禁止输出参数快照/次数');
});

console.log('\n[7] 档位应用原则（不机械套用 + 甜咸谁高听谁）');
test('档位映射文件写明「偏好上限、不要强行加辣/加糖/加盐」', () => {
  const levels = profile.files.levels.text;
  assertIncludes(levels, '档位应用原则', '缺少档位应用原则章节');
  assertIncludes(levels, '口味偏好上限', '缺少「偏好上限」说明');
  assertIncludes(levels, '番茄炒蛋', '缺少番茄炒蛋的例子');
  assertIncludes(levels, '甜度档位 > 咸度档位 → 建议**甜口**', '缺少甜>咸的规则');
  assertIncludes(levels, '咸度档位 > 甜度档位 → 建议**咸口**', '缺少咸>甜的规则');
});
test('甜度档位 > 咸度档位 → System Prompt 优先推荐甜口', () => {
  const p = Mars.buildSystemPrompt(profile, { marsVersion: 'normal', marsSpicy: 2, marsSweet: 2, marsSalty: 1, marsAvoid: '' }, { userText: '番茄炒蛋怎么做' });
  assertIncludes(p, '优先推荐甜口', '应优先推荐甜口');
  assertIncludes(p, '菜品本身没有该味型时不要强行加辣/加糖/加盐', '缺少不机械套用的约束');
});
test('咸度档位 > 甜度档位 → System Prompt 优先推荐咸口', () => {
  const p = Mars.buildSystemPrompt(profile, { marsVersion: 'normal', marsSpicy: 2, marsSweet: 0, marsSalty: 3, marsAvoid: '' }, { userText: '番茄炒蛋怎么做' });
  assertIncludes(p, '优先推荐咸口', '应优先推荐咸口');
});
test('甜咸档位相同 → 按传统口味推荐并给出另一种做法', () => {
  const p = Mars.buildSystemPrompt(profile, { marsVersion: 'normal', marsSpicy: 0, marsSweet: 2, marsSalty: 2, marsAvoid: '' }, { userText: '红烧肉怎么做' });
  assertIncludes(p, '甜度档位=2 与咸度档位=2 相同', '应提示两档相同');
  assertIncludes(p, '说明另一种做法也可以', '应说明另一种做法');
});
test('非美食问题不注入档位应用原则', () => {
  const p = Mars.buildSystemPrompt(profile, ELDERLY, { userText: NON_FOOD_Q });
  assertExcludes(p, '优先推荐甜口', '非美食问题不应有口味推荐');
});

console.log('\n[7b] 老年模式高档位健康提醒');
test('非老年模式：任何档位都不触发健康提醒', () => {
  assert(Mars.healthRisks({ marsVersion: 'normal', marsSpicy: 4, marsSweet: 4, marsSalty: 4 }).length === 0, '普通模式不应有提醒');
});
test('老年模式：只有最高两档（3、4）才触发', () => {
  assert(Mars.healthRisks({ marsVersion: 'elderly', marsSpicy: 2, marsSweet: 2, marsSalty: 2 }).length === 0, '中档不应提醒');
  assert(Mars.healthRisks({ marsVersion: 'elderly', marsSpicy: 3 }).length === 1, '特辣应提醒');
  assert(Mars.healthRisks({ marsVersion: 'elderly', marsSpicy: 4 }).length === 1, '爆辣应提醒');
});
test('老年模式：辣/甜/咸多项超档时逐项给出理由', () => {
  const risks = Mars.healthRisks({ marsVersion: 'elderly', marsSpicy: 3, marsSweet: 4, marsSalty: 3 });
  assert(risks.length === 3, '应给出 3 条风险，实际 ' + risks.length);
  const kinds = risks.map((r) => r.kind).join(',');
  assert(kinds === 'spicy,sweet,salty', '顺序应为 辣→甜→咸，实际 ' + kinds);
  assertIncludes(risks[1].label, '甜度');
  assertIncludes(risks[1].text, '血糖');
  assertIncludes(risks[2].text, '血压');
  assert(typeof risks[0].text === 'string' && risks[0].text.length > 5, '风险文案不能为空');
});

console.log('\n[8] 缺素材时的健壮性');
test('素材缺失时仍能组装出可用 prompt', () => {
  const p = Mars.buildSystemPrompt({ files: {} }, ELDERLY, { userText: FOOD_Q });
  assertIncludes(p, '人设文件缺失', '应提示人设缺失');
  assertIncludes(p, '## 当前用户配置', '参数快照仍应在');
});

console.log('\n[9] Markdown 表格渲染');
const TABLE_SRC = '| 用料 | 份量 |\n|---|---|\n| 小圆面包或白馒头 | 3个 |\n| 鸡蛋 | 2个 |';
test('标题紧贴表格（无空行）仍渲染为表格', () => {
  const html = Markdown.render('用料（两三个人的量）\n' + TABLE_SRC);
  assertIncludes(html, '<p>用料（两三个人的量）</p>', '标题应独立成段');
  assertIncludes(html, '<table class="md-table">', '应渲染出表格');
  assertIncludes(html, '<th>用料</th><th>份量</th>', '表头单元格不符');
  assertIncludes(html, '<td>小圆面包或白馒头</td><td>3个</td>', '数据行不符');
  assertExcludes(html, '|---|', '分隔行不应以文本出现');
  assert((html.match(/<tr>/g) || []).length === 3, '应为 1 表头行 + 2 数据行');
});
test('表格前有空行时渲染不变', () => {
  const html = Markdown.render('用料（两三个人的量）\n\n' + TABLE_SRC);
  assertIncludes(html, '<table class="md-table">', '应渲染出表格');
  assertIncludes(html, '<td>鸡蛋</td><td>2个</td>', '数据行不符');
});
test('表格后紧贴正文：表格与段落各自独立', () => {
  const html = Markdown.render(TABLE_SRC + '\n做法如下。');
  assertIncludes(html, '</table>', '应有表格');
  assertIncludes(html, '<p>做法如下。</p>', '后续正文应独立成段');
});
test('对齐分隔行 |:---|---:| 可识别', () => {
  const html = Markdown.render('说明\n| 料 | 量 |\n|:---|---:|\n| 蛋 | 2个 |');
  assertIncludes(html, '<table class="md-table">', '对齐分隔行应触发表格');
});
test('普通段落含竖线不误判为表格', () => {
  const html = Markdown.render('用 A | B 两种方案\n下一行普通文本');
  assertExcludes(html, '<table', '不应出现表格');
  assertIncludes(html, '<p>', '应为普通段落');
});
test('表格单元格内的 HTML 被转义', () => {
  const html = Markdown.render('| 用料 |\n|---|\n| <script>alert(1)</script> |');
  assertExcludes(html, '<script>', 'script 标签必须被转义');
  assertIncludes(html, '&lt;script&gt;', '应以文本形式保留');
});
test('流式半截输出（只有表头没有分隔行）不崩溃、不出表格', () => {
  const html = Markdown.render('用料\n| 用料 | 份量 |');
  assertExcludes(html, '<table', '分隔行未到时不应出表格');
  assertIncludes(html, '用料', '文本不应丢失');
});

// ---------- 汇总 ----------
console.log('\n──────────────────────────────');
if (failures.length) {
  console.log('❌ 失败 ' + failures.length + ' 项 / 通过 ' + passed + ' 项');
  failures.forEach((f) => console.log('   · ' + f.name + ' → ' + f.message));
  process.exit(1);
}
console.log('✅ 全部通过：' + passed + ' 项');
