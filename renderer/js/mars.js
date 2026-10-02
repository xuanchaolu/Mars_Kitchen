/* 火星小厨房 — System Prompt 组装 / 参数解析 / 输出解析模块
 *
 * 架构（对齐需求文档「4 System Prompt组装逻辑（核心）」）：
 *
 *   完整 System Prompt = Skill.md 全文
 *                      + 【A.md 或者 shtu 二选一】
 *                      + 档位映射规则
 *                      + 用户当前参数快照
 *
 * 静态素材由主进程从 mars_profile/ 读取后经 IPC 交给前端「预加载」（见 app.js loadMarsProfile），
 * 本模块只做纯函数组装与解析，便于在 Node 里直接单元测试。
 */
(function () {
  'use strict';

  // ---------- 版本与人设文件 ----------
  const VERSIONS = {
    normal: { key: 'normal', label: '普通版', persona: 'personaNormal', file: 'A.md' },
    elderly: { key: 'elderly', label: '老年人版', persona: 'personaElderly', file: 'shtu' },
  };
  const VERSION_KEYS = ['normal', 'elderly'];

  // ---------- 档位定义（与 mars_profile/档位映射.md 一一对应） ----------
  const LEVELS = {
    spicy: {
      key: 'spicy', label: '辣度', max: 4,
      names: ['0 无辣', '1 微辣', '2 中辣', '3 特辣', '4 爆辣'],
      rules: ['不含辣椒，清淡', '轻微辣味，刺激低', '明显辣味', '强烈辣味', '重辣，需要附带肠胃风险提示'],
    },
    sweet: {
      key: 'sweet', label: '甜度', max: 4,
      names: ['0 无糖', '1 微甜', '2 中甜', '3 很甜', '4 超甜'],
      rules: ['无额外添加糖', '淡淡甜味', '均衡适口', '甜味突出', '甜度很高，附带高糖提醒'],
    },
    salty: {
      key: 'salty', label: '咸度', max: 4,
      names: ['0 无盐', '1 微咸', '2 中咸', '3 很咸', '4 超咸'],
      rules: ['不加盐', '淡淡咸香', '咸淡均衡', '咸味偏重', '高盐，附带健康提示'],
    },
  };
  const LEVEL_KEYS = ['spicy', 'sweet', 'salty'];

  /** 档位序号 → 显示名（越界自动夹取到 0..4） */
  function levelName(kind, n) {
    const def = LEVELS[kind];
    if (!def) return String(n);
    const i = Math.max(0, Math.min(def.max, Math.round(Number(n) || 0)));
    return def.names[i];
  }

  function versionLabel(v) {
    return (VERSIONS[v] || VERSIONS.normal).label;
  }

  /** 设置项字段名：marsSpicy / marsSweet / marsSalty → 档位定义 */
  const settingKey = (kind) => 'mars' + kind.charAt(0).toUpperCase() + kind.slice(1);

  // ---------- 问题类型判定（边界规则 7.1 / 7.3） ----------
  // 美食/菜谱类关键词：菜名、食材、进食场景、口味与饮食健康词汇（不含「怎么做」等泛化问法，
  // 避免把「股票怎么做技术分析」这类问题误判成美食类；菜谱问法由 FOOD_NOUN_RE 兜住）
  const FOOD_RE = /菜谱|食谱|做法|烹饪|下厨|做饭|烧菜|炒菜|菜|饭|面条|面粉|拉面|炒面|拌面|泡面|粥|汤|饺子|包子|馒头|饼|火锅|烧烤|小吃|点心|甜品|蛋糕|面包|奶茶|果汁|饮料|食材|用料|配料|调料|口味|好吃|吃什么|吃啥|早餐|午餐|晚餐|夜宵|加餐|下饭|忌口|过敏|营养|热量|减脂餐|健身餐|月子餐|辅食|辣|甜|咸|蛋|肉|鸡|鸭|鹅|鱼|虾|蟹|豆腐|番茄|西红柿|土豆|青椒|辣椒|花椒|白菜|青菜|菠菜|排骨|蘑菇|香菇|洋葱|萝卜|黄瓜|茄子|豆角|粉丝|牛奶|酸奶|水果|苹果|香蕉|西瓜|草莓|葱|姜|蒜|酱油|醋|淀粉/;

  // 明确的「做饭 / 用火 / 烧水 / 燃气」用词（老年人版煤气安全提醒的强制触发条件）
  const KITCHEN_RE = /做饭|做菜|炒菜|烧菜|煮饭|烧饭|下厨|厨房|用火|明火|开火|关火|火候|燃气|煤气|天然气|灶|烧水|开水|热水|高压锅|油锅|下锅|出锅|烤箱|微波炉|电磁炉|电饭煲|煲汤|炖汤|蒸锅|焖|卤|腌/;
  const COOK_ACTION_RE = /做|炒|煮|蒸|炖|煎|炸|烤|焖|拌|腌|卤|煲|烧|下锅|出锅|火候/;

  function isFoodQuestion(text) {
    return FOOD_RE.test(String(text || ''));
  }

  /** 是否属于「做饭 / 用火 / 烧水 / 燃气」场景（决定老年人版是否强制追加煤气安全提醒） */
  function isKitchenQuestion(text) {
    const t = String(text || '');
    if (KITCHEN_RE.test(t)) return true;
    return isFoodQuestion(t) && COOK_ACTION_RE.test(t);
  }

  // ---------- 参数快照 ----------
  /** 由 settings 生成「当前生效全部参数」快照（供 prompt 与 Control 提示面板共用） */
  function snapshot(settings) {
    const s = settings || {};
    const version = VERSIONS[s.marsVersion] ? s.marsVersion : 'normal';
    const out = {
      version: version,
      versionLabel: VERSIONS[version].label,
      personaFile: VERSIONS[version].file,
      avoid: String(s.marsAvoid == null ? '' : s.marsAvoid).trim(),
    };
    for (const k of LEVEL_KEYS) {
      const n = Math.max(0, Math.min(LEVELS[k].max, Math.round(Number(s[settingKey(k)]) || 0)));
      out[k] = { level: n, label: LEVELS[k].label, name: levelName(k, n), rule: LEVELS[k].rules[n] };
    }
    return out;
  }

  /** 一行式参数摘要：版本=老年人版，辣度=1（微辣），甜度=2（中甜）；忌口：虾过敏 */
  function snapshotLine(snap) {
    const parts = LEVEL_KEYS.map((k) => snap[k].label + '=' + snap[k].level + '（' + snap[k].name.replace(/^\d+\s*/, '') + '）');
    const avoid = snap.avoid ? snap.avoid : '无';
    return '版本=' + snap.versionLabel + '，' + parts.join('，') + '；忌口：' + avoid;
  }

  // ---------- System Prompt 组装 ----------
  /** 兼容主进程返回的 profile 结构，取出四份素材文本 */
  function parts(profile) {
    const f = (profile && profile.files) || {};
    const t = (k) => (f[k] && typeof f[k].text === 'string' ? f[k].text.trim() : '');
    return {
      skill: t('skill'),
      personaNormal: t('personaNormal'),
      personaElderly: t('personaElderly'),
      levels: t('levels'),
    };
  }

  /**
   * 组装完整 System Prompt
   * @param {object} profile  主进程 mars:profile 的返回值（含四份素材）
   * @param {object} settings 当前设置（marsVersion / marsSpicy / marsSweet / marsSalty / marsAvoid）
   * @param {object} [opts]   { userText } 本轮用户问题，用于判定档位是否生效
   * @returns {string}
   */
  function buildSystemPrompt(profile, settings, opts) {
    const o = opts || {};
    const p = parts(profile);
    const snap = snapshot(settings);
    const food = isFoodQuestion(o.userText);

    const blocks = [];
    if (p.skill) blocks.push(p.skill);

    const personaText = snap.version === 'elderly' ? p.personaElderly : p.personaNormal;
    if (personaText) blocks.push(personaText);
    else blocks.push('# 人设文件缺失\n未能加载 ' + snap.personaFile + '，请使用常规表达。');

    if (p.levels) blocks.push(p.levels);

    // —— 用户当前参数快照（追加到末尾） ——
    const lines = [];
    lines.push('## 当前用户配置（本次请求生效，必须严格遵守）');
    lines.push('版本=' + snap.versionLabel + '；' + LEVEL_KEYS.map((k) => snap[k].label + '=' + snap[k].level).join('；') + '；忌口&过敏：' + (snap.avoid || '无'));
    for (const k of LEVEL_KEYS) {
      lines.push('- ' + snap[k].label + '：' + snap[k].level + '（' + snap[k].name.replace(/^\d+\s*/, '') + '）→ ' + snap[k].rule);
    }
    lines.push('- 忌口&过敏（全局约束）：' + (snap.avoid || '无'));
    lines.push(food
      ? '- 问题类型判定：美食/菜谱类 → 辣度、甜度、咸度档位**全部生效**，并规避上述忌口过敏原。'
      : '- 问题类型判定：非美食/菜谱类 → **忽略辣度、甜度、咸度档位**，仅保留人设风格与忌口过敏约束。');

    // 档位应用原则（需求：档位是偏好上限，不要机械地每道菜都套用）
    if (food) {
      const sw = snap.sweet.level, sa = snap.salty.level;
      lines.push('- 档位是「口味偏好上限」而不是「每道菜都必须达到」的指标：菜品本身没有该味型时不要强行加辣/加糖/加盐（例：番茄炒蛋只有甜口与咸口，不要因为选了辣度档位就加辣椒）。');
      if (sw === sa) {
        lines.push('- 甜度档位=' + sw + ' 与咸度档位=' + sa + ' 相同：甜、咸都适用的菜按它的传统口味推荐，并说明另一种做法也可以。');
      } else if (sw > sa) {
        lines.push('- 甜度档位=' + sw + ' > 咸度档位=' + sa + '：甜、咸都适用的菜（如番茄炒蛋）**优先推荐甜口**，不要强加辣味。');
      } else {
        lines.push('- 咸度档位=' + sa + ' > 甜度档位=' + sw + '：甜、咸都适用的菜**优先推荐咸口**，不要强加辣味。');
      }
      lines.push('- 某道菜不适合某个档位时，用一句话说明原因，不要沉默忽略；高辣/高糖/高盐的健康提醒只在菜谱实际用到该味型时才给。');
    }

    // 老年人版专属（边界规则 7.3）：只有做饭/燃气用火场景才强制追加煤气安全提醒
    if (snap.version === 'elderly') {
      const kitchen = isKitchenQuestion(o.userText);
      if (kitchen) {
        lines.push('- 本题判定为「做饭 / 用火 / 烧水 / 燃气」场景 → **回答末尾要用一句话加上安全提醒**：做饭记得留意火候，用完记得关好煤气，注意用火安全。');
      } else {
        lines.push('- 本题若涉及做饭/用火/烧水/燃气，回答末尾要用一句话加上安全提醒（做饭记得留意火候，用完记得关好煤气，注意用火安全）；非厨房问题不需要煤气提醒，但要保持「您」称呼与通俗短句风格。');
      }
    }
    lines.push('只输出回答正文：不要输出【主体回答】【提示信息】等标记，也不要输出参数快照或联网搜索调用次数。全部内容必须遵守以上约束。');
    blocks.push(lines.join('\n'));

    return blocks.join('\n\n---\n\n');
  }

  // ---------- 输出解析 ----------
  const BODY_MARK = '【主体回答】';
  const HINT_MARK = '【提示信息】';

  /**
   * 把模型输出拆成【主体回答】与【提示信息】
   *  - 只剥离标记本身，标记之前/之后的正文一律保留（流式半截输出也不丢字）
   *  - 模型未按格式输出时：body = 原文，hasMarkers = false（前端仍渲染标准提示块）
   */
  function parseOutput(content) {
    const text = String(content == null ? '' : content);
    const iHint = text.indexOf(HINT_MARK);
    const iBody = text.indexOf(BODY_MARK);
    const head = iHint >= 0 ? text.slice(0, iHint) : text;
    const hint = iHint >= 0 ? text.slice(iHint + HINT_MARK.length).trim() : '';
    const body = head.split(BODY_MARK).join('').replace(/^\s*[-—]{3,}\s*$/gm, '').trim();
    return {
      body: body,
      hint: hint,
      hasBody: iBody >= 0,
      hasHint: iHint >= 0,
      hasMarkers: iBody >= 0 || iHint >= 0,
    };
  }

  // ---------- 高档位健康风险（老年模式：辣/甜/咸最上面两档要弹窗提醒） ----------
  const HEALTH_RISK_FROM = 3;      // 3 特辣 / 4 爆辣；3 很甜 / 4 超甜；3 很咸 / 4 超咸

  const HEALTH_TEXT = {
    spicy: [
      '强烈辣味，对肠胃刺激较大',
      '重辣，容易引起肠胃不适，老年人尤其要当心',
    ],
    sweet: [
      '甜味突出，糖分偏高，注意血糖',
      '甜度很高，糖分高，血糖偏高的人要格外注意',
    ],
    salty: [
      '咸味偏重，钠摄入偏高，注意血压',
      '高盐，钠摄入很高，血压偏高的人要格外注意',
    ],
  };

  /**
   * 返回本次选择里「最高两档」的健康风险清单（仅老年模式需要弹窗；普通模式返回空数组）
   * @returns {Array<{kind,label,name,level,text}>}
   */
  function healthRisks(settings) {
    const snap = snapshot(settings);
    if (snap.version !== 'elderly') return [];
    const out = [];
    for (const k of LEVEL_KEYS) {
      const lv = snap[k].level;
      if (lv < HEALTH_RISK_FROM) continue;
      out.push({
        kind: k,
        label: snap[k].label,
        name: snap[k].name.replace(/^\d+\s*/, ''),
        level: lv,
        text: HEALTH_TEXT[k][lv - HEALTH_RISK_FROM],
      });
    }
    return out;
  }

  // ---------- 预加载（浏览器环境） ----------
  let cachedProfile = null;

  /** 从主进程预加载四份素材（Skill.md / A.md / shtu / 档位映射） */
  async function load(force) {
    if (cachedProfile && !force) return cachedProfile;
    if (typeof window === 'undefined' || !window.niuai || !window.niuai.marsProfile) return null;
    try {
      cachedProfile = await window.niuai.marsProfile();
    } catch (_) {
      cachedProfile = null;
    }
    return cachedProfile;
  }

  function profile() { return cachedProfile; }

  function profileInfo() {
    const f = (cachedProfile && cachedProfile.files) || {};
    const info = (k) => (f[k] && !f[k].missing ? { file: f[k].file, chars: (f[k].text || '').length } : null);
    return {
      hasProfile: !!cachedProfile,
      ok: !!(cachedProfile && cachedProfile.ok),
      dir: (cachedProfile && cachedProfile.dir) || '',
      missing: (cachedProfile && cachedProfile.missing) || [],
      skill: info('skill'),
      personaNormal: info('personaNormal'),
      personaElderly: info('personaElderly'),
      levels: info('levels'),
    };
  }

  const API = {
    VERSIONS, VERSION_KEYS, LEVELS, LEVEL_KEYS,
    versionLabel, levelName, isFoodQuestion, isKitchenQuestion, snapshot, snapshotLine,
    buildSystemPrompt, parseOutput, healthRisks, HEALTH_RISK_FROM,
    load, profile, profileInfo,
  };

  if (typeof window !== 'undefined') window.Mars = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
