const { app, BrowserWindow, shell, ipcMain, Menu, dialog, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

app.setName('火星小厨房');
// 环境变量：新名（MARS_*）优先，兼容旧名（PERPER_*），保证既有脚本/自检继续可用
const env = (name) => {
  const v = process.env['MARS_' + name];
  return v !== undefined && v !== '' ? v : process.env['PERPER_' + name];
};
// 便携模式/测试：可用环境变量重定向数据根目录（appData）与用户数据目录
// 注意：数据目录只由本应用名决定（~/Library/Application Support/火星小厨房），
// 与 PerPer AI / 牛来 完全隔离 —— 不读取、不迁移、不共享任何历史数据。
if (env('APPDATA')) {
  try {
    fs.mkdirSync(env('APPDATA'), { recursive: true });
    app.setPath('appData', env('APPDATA'));
  } catch (e) { console.error('[火星小厨房] appData 重定向失败:', e && e.message); }
}
if (env('USERDATA')) app.setPath('userData', env('USERDATA'));

// 允许语音播报在无用户手势时启动（虚拟形象自动播报 AI 输出）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow = null;
const { DEFAULT_STT, registerSpeech } = require('./lib/speech-service');
const speechService = registerSpeech({ app, ipcMain, getWindow: () => mainWindow,
  getSettings: () => ({ ...DEFAULT_STT, ...readJSON('settings.json', {}) }), systemPreferences });

// ---------- 数据持久化 ----------
const dataDir = () => app.getPath('userData');
const file = (name) => path.join(dataDir(), name);

function readJSON(name, fallback) {
  try {
    const p = file(name);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { /* ignore */ }
  return fallback;
}
function writeJSON(name, value) {
  try {
    fs.writeFileSync(file(name), JSON.stringify(value, null, 2), 'utf8');
  } catch (e) { /* ignore */ }
}

const DEFAULT_SETTINGS = {
  ...DEFAULT_STT,
  apiKey: '',                              // 默认留空，首次启动由用户自行填写（打包不携带个人 Key）
  baseURL: 'https://api.deepseek.com/v1',
  model: 'deepseek-flash',
  reasoningEnabled: true,
  temperature: 0.7,
  systemPrompt: '',
  referer: 'https://mars-kitchen.app',
  title: 'Mars Kitchen macOS', // 注意：会放入 HTTP 请求头，必须为 ASCII（Chromium 限制非 ISO-8859-1 头）
  // 虚拟形象
  avatarEnabled: true,      // 显示 3D 人物面板
  avatarModel: 'Martian.vrm',         // 人物模型文件名（默认：火星姐）
  avatarMouthSpeed: 0.75,             // 口型速度 0.5(慢) ~ 1.5(快)
  viewMode: 'list',                   // 显示方式：list = 侧边列表；folder = 文件夹视图
  skills: [],                         // 已安装技能：[{id,name,description,enabled,prompt}]
  webSearch: true,                    // 联网搜索（DuckDuckGo，无需 Key）
  webSearchRounds: 3,                 // 最多搜索轮次
  avatarAutoSpeak: true,    // 自动播报 AI 输出
  avatarVoice: '',          // 系统语音名（引擎为 system 时用），空 = 自动
  avatarRate: 1,            // 系统语音语速
  // 语音播报引擎
  ttsEngine: 'edge',                        // edge = 微软神经语音；system = 系统语音
  ttsVoice: 'zh-CN-XiaoxiaoNeural',         // Edge 语音（晓晓：中文女声，中英混读）
  ttsRate: 0,                               // Edge 语速百分比 -50..+50
  ttsVolume: 0,                             // Edge 音量百分比
  // ---------- 火星小厨房 人设 / 档位参数 ----------
  marsVersion: 'normal',   // 版本：normal = 普通版（加载 A.md）；elderly = 老年人版（加载 shtu）
  marsSpicy: 0,            // 辣度档位 0..4
  marsSweet: 0,            // 甜度档位 0..4
  marsSalty: 0,            // 咸度档位 0..4
  marsAvoid: '',           // 忌口&过敏（自由文本，全局约束）
  marsOnboarded: false,    // 是否已完成首次启动弹窗设置（false = 首次打开 App 时弹窗）
};

// ---------- 人设版本 / 档位参数的取值约束（与前端 renderer/js/mars.js 保持一致） ----------
const MARS_VERSIONS = ['normal', 'elderly'];
const clampLevel = (v) => Math.max(0, Math.min(4, Math.round(Number(v) || 0)));

/** 归一化人设与档位参数，避免脏数据进入 prompt */
function sanitizeMarsSettings(s) {
  if (MARS_VERSIONS.indexOf(s.marsVersion) === -1) s.marsVersion = 'normal';
  s.marsSpicy = clampLevel(s.marsSpicy);
  s.marsSweet = clampLevel(s.marsSweet);
  s.marsSalty = clampLevel(s.marsSalty);
  s.marsAvoid = String(s.marsAvoid == null ? '' : s.marsAvoid).slice(0, 500);
  s.marsOnboarded = s.marsOnboarded === true;
  return s;
}

// 请求头必须为 ASCII（Chromium 限制非 ISO-8859-1 头），历史设置里的中文标题在此归一化
function sanitizeSettings(s) {
  const ascii = (v) => String(v || '').replace(/[^\x20-\x7E]/g, '').trim();
  if (typeof s.title === 'string') s.title = ascii(s.title) || 'Mars Kitchen macOS';
  if (typeof s.referer === 'string') s.referer = ascii(s.referer) || 'https://mars-kitchen.app';
  return sanitizeMarsSettings(s);
}

// 一次性迁移：把旧的 OpenRouter 配置切到 DeepSeek 官方接口
// （用 configVersion 标记，只执行一次；之后用户在设置面板的修改都会被尊重）
const CONFIG_VERSION = 2;
function migrateToDeepseek(s) {
  if (s.configVersion === CONFIG_VERSION) return s;
  const legacyOpenRouter = typeof s.baseURL === 'string' && /openrouter\.ai/i.test(s.baseURL);
  const next = { ...s, configVersion: CONFIG_VERSION };
  if (legacyOpenRouter || !s.baseURL) {
    next.baseURL = DEFAULT_SETTINGS.baseURL;
    next.model = DEFAULT_SETTINGS.model;
    if (DEFAULT_SETTINGS.apiKey) next.apiKey = DEFAULT_SETTINGS.apiKey;   // 默认 Key 为空时保留用户已有的
  }
  writeJSON('settings.json', next);
  return next;
}

ipcMain.handle('settings:get', () => {
  const merged = { ...DEFAULT_SETTINGS, ...readJSON('settings.json', {}) };
  const normalized = sanitizeSettings(migrateToDeepseek(merged));
  // 首次启动：安装随包内置技能（并把默认提示词写入设置）+ 播种人设档案
  let changed = seedBundledSkills(normalized);
  changed = seedMarsProfile(normalized) || changed;
  changed = cleanupRemovedSkills(normalized) || changed;
  if (changed) {
    try { writeJSON('settings.json', { ...normalized, configVersion: CONFIG_VERSION }); } catch (_) {}
  }
  return normalized;
});
ipcMain.handle('settings:set', (_e, s) => {
  writeJSON('settings.json', { ...sanitizeSettings({ ...s }), configVersion: CONFIG_VERSION });
  return true;
});
ipcMain.handle('conv:get', () => readJSON('conversations.json', []));
ipcMain.handle('conv:set', (_e, c) => { writeJSON('conversations.json', c); return true; });

// ---------- VRM 人物模型管理（支持多模型切换） ----------
const BUNDLED_AVATAR_DIR = path.join(__dirname, 'renderer', 'assets', 'avatars');
const userAvatarDir = () => path.join(app.getPath('userData'), 'avatars');

function scanAvatarDir(dir, builtin) {
  const out = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!/\.vrm$/i.test(f)) continue;
      try {
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        out.push({ file: f, path: p, size: st.size, builtin: !!builtin });
      } catch (_) {}
    }
  } catch (_) {}
  return out;
}

function listAvatars() {
  const bundled = scanAvatarDir(BUNDLED_AVATAR_DIR, true);
  const user = scanAvatarDir(userAvatarDir(), false);
  // 同名时用户目录优先
  const map = new Map();
  bundled.forEach((v) => map.set(v.file, v));
  user.forEach((v) => map.set(v.file, v));
  return Array.from(map.values());
}

function resolveAvatar(model) {
  const list = listAvatars();
  if (model) {
    const hit = list.find((v) => v.file === model || v.path === model);
    if (hit) return hit;
  }
  return list[0] || null;
}

ipcMain.handle('avatar:list', () => listAvatars().map((v) => ({ file: v.file, size: v.size, builtin: v.builtin })));
ipcMain.handle('avatar:info', (_e, model) => {
  const v = resolveAvatar(model);
  return v ? { ok: true, size: v.size, path: v.path, file: v.file } : { ok: false, error: '未找到人物模型文件' };
});
ipcMain.handle('avatar:load', async (_e, model) => {
  const v = resolveAvatar(model);
  if (!v) throw new Error('未找到人物模型文件');
  const buf = await fs.promises.readFile(v.path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});
// 选择本地 VRM 文件 → 复制到用户模型目录并返回文件名
ipcMain.handle('avatar:pick', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择 VRM 人物模型',
    filters: [{ name: 'VRM 模型', extensions: ['vrm'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  const src = r.filePaths[0];
  const dir = userAvatarDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    let name = path.basename(src);
    const dest = path.join(dir, name);
    if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest);
    return { ok: true, file: name, size: fs.statSync(dest).size };
  } catch (e) {
    return { ok: false, error: String(e.message) };
  }
});
ipcMain.handle('avatar:open-folder', () => {
  try {
    fs.mkdirSync(userAvatarDir(), { recursive: true });
    shell.openPath(userAvatarDir());
    return true;
  } catch (_) { return false; }
});



// ==================== 技能（Skills） ====================
const skillsDir = () => path.join(app.getPath('userData'), 'skills');

const slugify = (name) => String(name || 'skill')
  .toLowerCase()
  .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48) || 'skill';

/** 解析 SKILL.md 的 YAML frontmatter（name / description）与正文 */
function parseSkillFile(text, fallbackName) {
  let name = fallbackName || '';
  let description = '';
  let body = String(text || '');
  const m = body.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (m) {
    const fm = m[1];
    body = body.slice(m[0].length);
    const get = (key) => {
      const r = fm.match(new RegExp('^' + key + '\\s*:\\s*(.+)$', 'm'));
      return r ? r[1].trim().replace(/^["\']|["\']$/g, '') : '';
    };
    name = get('name') || name;
    description = get('description') || description;
  }
  if (!name) {
    const h = body.match(/^#\s+(.+)$/m);
    name = h ? h[1].trim() : (fallbackName || '未命名技能');
  }
  if (!description) {
    const lines = body.split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#') && !x.startsWith('---'));
    description = (lines[0] || '').slice(0, 140);
  }
  return { name, description, body: body.trim() };
}

/** 识别技能主文件：SKILL.md → 任意 SKILL*.md → 顶层其它 .md（兼容中文文件名） */
function findSkillMainFile(dir) {
  const exact = path.join(dir, 'SKILL.md');
  if (fs.existsSync(exact)) return exact;
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /\.md$/i.test(f) && !f.startsWith('.')); } catch (_) { return null; }
  const skillLike = files.find((f) => /^skill[^a-z]/i.test(f) || /^skill\.md$/i.test(f));
  if (skillLike) return path.join(dir, skillLike);
  const any = files.find((f) => !/^(readme|license|changelog|contributing)/i.test(f));
  return any ? path.join(dir, any) : null;
}

/** 技能目录内的资源文件（相对路径 + 大小）*/
function listSkillResources(dir, mainFile) {
  const out = [];
  const walk = (d, base, depth) => {
    if (depth > 3 || out.length > 40) return;
    let entries = [];
    try { entries = fs.readdirSync(d); } catch (_) { return; }
    for (const f of entries) {
      if (f.startsWith('.')) continue;
      const full = path.join(d, f);
      let st;
      try { st = fs.statSync(full); } catch (_) { continue; }
      const rel = base ? base + '/' + f : f;
      if (st.isDirectory()) { walk(full, rel, depth + 1); continue; }
      if (full === mainFile) continue;
      if (!/\.(md|txt|json|csv|ya?ml|html?)$/i.test(f)) continue;
      if (/^default-prompt\.txt$/i.test(f)) continue;      // 播种用的默认提示词，不作为技能资源
      out.push({ path: rel, size: st.size });
    }
  };
  walk(dir, '', 0);
  return out;
}

function listSkills() {
  const dir = skillsDir();
  const out = [];
  try {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry);
      let st;
      try { st = fs.statSync(p); } catch (_) { continue; }
      if (!st.isDirectory() || entry.startsWith('.')) continue;
      const mainFile = findSkillMainFile(p);
      if (!mainFile) continue;
      let text = '';
      try { text = fs.readFileSync(mainFile, 'utf8'); } catch (_) { continue; }
      const parsed = parseSkillFile(text, entry);
      out.push({
        id: entry,
        name: parsed.name,
        description: parsed.description,
        body: parsed.body.slice(0, 8000),
        mainFile: path.basename(mainFile),
        resources: listSkillResources(p, mainFile),
        dir: p,
      });
    }
  } catch (_) {}
  return out;
}

ipcMain.handle('skills:list', () => listSkills());

// ==================== 内置技能（随包分发，首次启动自动安装） ====================
// 火星小厨房 不预置任何技能：PerPer 时代的 hcy 粉丝知识库与本产品无关，已移除。
// 技能能力本身完整保留，用户可在「设置 → 技能」里自行安装。
const BUNDLED_SKILLS = [];

// 历史遗留清理：早期版本随包播种过 skill_hcy，升级后从设置与磁盘里移除
const REMOVED_SKILLS = ['skill_hcy'];
function cleanupRemovedSkills(settings) {
  try {
    let changed = false;
    if (Array.isArray(settings.skills) && settings.skills.some((s) => REMOVED_SKILLS.indexOf(s.id) >= 0)) {
      settings.skills = settings.skills.filter((s) => REMOVED_SKILLS.indexOf(s.id) === -1);
      changed = true;
    }
    for (const id of REMOVED_SKILLS) {
      const dir = path.join(skillsDir(), id);
      try { if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); changed = true; } } catch (_) {}
    }
    return changed;
  } catch (_) { return false; }
}

/** 找到随包内置的技能源目录（打包后走 extraResource，开发时走项目根目录） */
function bundledSkillRoot(entry) {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, entry.dir) : null,
    path.join(__dirname, entry.dir),
    path.join(__dirname, '..', entry.dir),
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(path.join(c, 'SKILL.md'))) return c; } catch (_) {}
  }
  return null;
}

/** 首次启动把内置技能安装到用户数据目录（只做一次，之后用户删除也不再自动装回）*/
function seedBundledSkills(settings) {
  try {
    const done = new Set(settings.seededSkills || []);
    let changed = false;
    for (const entry of BUNDLED_SKILLS) {
      if (done.has(entry.id)) continue;
      const src = bundledSkillRoot(entry);
      if (!src) continue;                                   // 包里没有就跳过
      const dst = path.join(skillsDir(), entry.id);
      if (!fs.existsSync(path.join(dst, 'SKILL.md'))) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.cpSync(src, dst, {
          recursive: true,
          filter: (p) => !path.basename(p).startsWith('.'),
        });
      }
      settings.skills = settings.skills || [];
      if (!settings.skills.some((x) => x.id === entry.id)) {
        let prompt = '';
        try {
          const pf = path.join(src, 'default-prompt.txt');
          if (fs.existsSync(pf)) prompt = fs.readFileSync(pf, 'utf8');
        } catch (_) {}
        settings.skills.push({
          id: entry.id, name: entry.name, description: entry.description,
          // 火星小厨房 默认不启用随包技能：否则其「perper 猫人设」提示词会覆盖
          // Skill.md + A.md/shtu 的 Mars 人设。技能本身完整保留，用户可在设置里一键启用。
          enabled: false, prompt: prompt,
        });
      }
      done.add(entry.id);
      changed = true;
    }
    settings.seededSkills = Array.from(done);
    return changed;
  } catch (_) {
    return false;
  }
}

// 安装技能：传入 path 时直接安装（便于测试/拖入），否则弹文件选择框
ipcMain.handle('skills:install', async (_e, opts) => {
  const o = opts || {};
  let src = o.path || null;
  if (!src) {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择技能（文件夹、SKILL.md、.md 或 .zip）',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: '技能', extensions: ['md', 'markdown', 'zip'] }],
    });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    src = r.filePaths[0];
  }
  try {
    const dir = skillsDir();
    fs.mkdirSync(dir, { recursive: true });
    let name = '';
    let body = '';
    let description = '';
    const st = fs.statSync(src);

    if (st.isDirectory()) {
      const md = path.join(src, 'SKILL.md');
      const mdFile = fs.existsSync(md) ? md : (fs.readdirSync(src).find((f) => /\.md$/i.test(f)) ? path.join(src, fs.readdirSync(src).find((f) => /\.md$/i.test(f))) : null);
      if (!mdFile) return { ok: false, error: '文件夹里没有 SKILL.md 或 .md 文件' };
      const parsed = parseSkillFile(fs.readFileSync(mdFile, 'utf8'), path.basename(src));
      name = parsed.name; description = parsed.description; body = parsed.body;
      const slug = slugify(o.id || path.basename(src));
      const dest = path.join(dir, slug);
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(src, dest, { recursive: true });
    } else if (/\.zip$/i.test(src)) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mars-kitchen-skill-'));
      const r = require('child_process').spawnSync('unzip', ['-o', '-q', src, '-d', tmp]);
      if (r.status !== 0) return { ok: false, error: '解压失败（需要系统 unzip）：' + String(r.stderr || '').slice(0, 200) };
      const entries = fs.readdirSync(tmp).map((f) => path.join(tmp, f));
      const root = entries.length === 1 && fs.statSync(entries[0]).isDirectory() ? entries[0] : tmp;
      const mdFile = (() => {
        const direct = path.join(root, 'SKILL.md');
        if (fs.existsSync(direct)) return direct;
        const walk = (d, depth) => {
          if (depth > 2) return null;
          for (const f of fs.readdirSync(d)) {
            const p = path.join(d, f);
            if (fs.statSync(p).isDirectory()) { const r2 = walk(p, depth + 1); if (r2) return r2; }
            else if (/SKILL\.md$/i.test(f)) return p;
          }
          return null;
        };
        return walk(root, 0);
      })();
      if (!mdFile) return { ok: false, error: 'zip 里没有找到 SKILL.md' };
      const parsed = parseSkillFile(fs.readFileSync(mdFile, 'utf8'), path.basename(src).replace(/\.zip$/i, ''));
      name = parsed.name; description = parsed.description; body = parsed.body;
      const slug = slugify(o.id || name);
      const dest = path.join(dir, slug);
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(path.dirname(mdFile), dest, { recursive: true });
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
    } else {
      const parsed = parseSkillFile(fs.readFileSync(src, 'utf8'), path.basename(src).replace(/\.md$/i, ''));
      name = parsed.name; description = parsed.description; body = parsed.body;
      const slug = slugify(o.id || path.basename(src).replace(/\.md$/i, ''));
      const dest = path.join(dir, slug);
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, 'SKILL.md'), fs.readFileSync(src));
    }

    const slugId = slugify(o.id || name);
    return { ok: true, skill: { id: slugId, name, description, body } };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

ipcMain.handle('skills:read', (_e, opts) => {
  const o = opts || {};
  try {
    const dir = path.join(skillsDir(), slugify(o.id));
    if (!fs.existsSync(dir)) return { ok: false, error: '技能不存在', files: [] };
    const resources = listSkillResources(dir, findSkillMainFile(dir));
    const files = resources.map((r) => r.path);
    if (!o.file) return { ok: true, files };
    // 归一化请求路径（防目录穿越）
    const want = String(o.file).replace(/^[./\s]+/, '');
    const target = path.resolve(dir, want);
    if (!target.startsWith(path.resolve(dir))) return { ok: false, error: '路径不合法', files };
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      const text = fs.readFileSync(target, 'utf8').slice(0, 30000);
      return { ok: true, file: want, text, files };
    }
    // 模糊匹配：忽略路径前缀/扩展名/中文差异，找最接近的文件
    const base = path.basename(want).replace(/\.md$/i, '');
    const hit = resources.find((r) => {
      const rb = path.basename(r.path).replace(/\.md$/i, '');
      return rb === base || rb.includes(base) || base.includes(rb);
    }) || (resources.length === 1 ? resources[0] : null);
    if (hit) {
      const text = fs.readFileSync(path.join(dir, hit.path), 'utf8').slice(0, 30000);
      return { ok: true, file: hit.path, substituted: true, text, files };
    }
    return { ok: false, error: '技能里没有这个文件：' + want, files };
  } catch (e) {
    return { ok: false, error: String(e.message) };
  }
});

ipcMain.handle('skills:remove', (_e, id) => {
  try {
    const p = path.join(skillsDir(), slugify(id));
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message) };
  }
});

ipcMain.handle('skills:open-folder', () => {
  try { fs.mkdirSync(skillsDir(), { recursive: true }); shell.openPath(skillsDir()); return true; } catch (_) { return false; }
});

// ==================== 火星小厨房 人设档案（Skill.md / A.md / shtu / 档位映射） ====================
// System Prompt 的静态素材来源：
//   Skill.md     全局总能力、全局规则（所有版本共用）
//   A.md         普通版人设（仅普通版加载）
//   shtu         老年人版人设（仅老年人版加载，含长辈称呼与居家安全提醒）
//   档位映射.md   辣/甜/咸 + 忌口过敏的参数映射规则（每次请求追加到 System Prompt 末尾）
// 随包分发：打包后在 Contents/Resources/mars_profile，开发时在项目根目录 mars_profile/。
// 首次启动复制到 userData/mars_profile（用户可自由编辑），读取时「用户目录优先、随包目录兜底」。
const MARS_PROFILE_DIRNAME = 'mars_profile';
const MARS_FILES = {
  skill: ['Skill.md', 'skill.md', 'SKILL.md'],
  personaNormal: ['A.md', 'a.md'],
  personaElderly: ['shtu.md', 'shtu', 'shtu.markdown'],
  levels: ['档位映射.md', '档位映射', 'levels.md'],
};

const marsProfileUserDir = () => path.join(app.getPath('userData'), MARS_PROFILE_DIRNAME);

/** 随包人设档案目录（打包走 extraResource，开发走项目根目录） */
function bundledMarsRoot() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, MARS_PROFILE_DIRNAME) : null,
    path.join(__dirname, MARS_PROFILE_DIRNAME),
    path.join(__dirname, '..', MARS_PROFILE_DIRNAME),
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(path.join(c, 'Skill.md'))) return c; } catch (_) {}
  }
  return null;
}

/** 首次启动把随包人设档案播种到用户数据目录（只做一次；用户已改过的文件不会被覆盖） */
function seedMarsProfile(settings) {
  try {
    if (settings.seededMarsProfile) return false;
    const src = bundledMarsRoot();
    if (!src) return false;
    const dst = marsProfileUserDir();
    if (!fs.existsSync(path.join(dst, 'Skill.md'))) {
      fs.mkdirSync(dst, { recursive: true });
      fs.cpSync(src, dst, { recursive: true, filter: (p) => !path.basename(p).startsWith('.') });
    }
    settings.seededMarsProfile = true;
    return true;
  } catch (_) { return false; }
}

/** 读取人设文件：用户目录 → 随包目录，按候选文件名依次尝试 */
function readMarsFile(names) {
  const roots = [marsProfileUserDir(), bundledMarsRoot()].filter(Boolean);
  for (const root of roots) {
    for (const n of names) {
      const p = path.join(root, n);
      try {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return { file: n, text: fs.readFileSync(p, 'utf8'), path: p };
      } catch (_) { /* ignore */ }
    }
  }
  return null;
}

/** 汇总四份素材（供前端「预加载」后用 Mars.buildSystemPrompt 组装） */
function loadMarsProfile() {
  const bundle = (names, label) => {
    const r = readMarsFile(names);
    return r ? { label: label, file: r.file, path: r.path, text: r.text } : { label: label, file: null, path: null, text: '', missing: true };
  };
  const files = {
    skill: bundle(MARS_FILES.skill, 'Skill.md'),
    personaNormal: bundle(MARS_FILES.personaNormal, 'A.md'),
    personaElderly: bundle(MARS_FILES.personaElderly, 'shtu'),
    levels: bundle(MARS_FILES.levels, '档位映射'),
  };
  const missing = Object.keys(files).filter((k) => files[k].missing).map((k) => files[k].label);
  const userDir = marsProfileUserDir();
  return {
    ok: missing.length < 4,
    dir: fs.existsSync(userDir) ? userDir : (bundledMarsRoot() || ''),
    userDir: userDir,
    bundledDir: bundledMarsRoot() || '',
    files: files,
    missing: missing,
  };
}

ipcMain.handle('mars:profile', () => loadMarsProfile());
ipcMain.handle('mars:open-folder', () => {
  try { fs.mkdirSync(marsProfileUserDir(), { recursive: true }); shell.openPath(marsProfileUserDir()); return true; } catch (_) { return false; }
});
// 恢复出厂人设：清空用户目录后从随包目录重新播种（用户在设置面板里主动触发）
ipcMain.handle('mars:reset-profile', () => {
  try {
    const src = bundledMarsRoot();
    const dst = marsProfileUserDir();
    if (src && fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
    if (src) { fs.mkdirSync(dst, { recursive: true }); fs.cpSync(src, dst, { recursive: true, filter: (p) => !path.basename(p).startsWith('.') }); }
    return loadMarsProfile();
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// ==================== 联网搜索（DuckDuckGo，无需 API Key） ====================
const SEARCH_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const stripTags = (h) => String(h)
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  .trim();

/** 解码 DuckDuckGo 的跳转链接：//duckduckgo.com/l/?uddg=<encoded> */
function decodeDdgUrl(href) {
  try {
    let u = href;
    if (u.startsWith('//')) u = 'https:' + u;
    const m = u.match(/[?&]uddg=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
    return u;
  } catch (_) { return href; }
}

/** 解析 DuckDuckGo HTML 结果页 */
function parseDdgHtml(html) {
  const out = [];
  const blocks = String(html).split(/class="result__a"/).slice(1);
  for (const b of blocks) {
    const hrefM = b.match(/href="([^"]+)"/);
    const titleM = b.match(/^[^>]*>([\s\S]*?)<\/a>/);
    const snipM = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    if (!hrefM) continue;
    const url = decodeDdgUrl(hrefM[1]);
    const title = titleM ? stripTags(titleM[1]) : '';
    const snippet = snipM ? stripTags(snipM[1]) : '';
    if (!title || !url.startsWith('http')) continue;
    if (out.some((x) => x.url === url)) continue;
    out.push({ title, url, snippet });
  }
  return out;
}

const hasCJK = (t) => /[\u4e00-\u9fa5]/.test(String(t || ''));

/** 解析 Bing 结果页 */
function parseBingHtml(html) {
  const out = [];
  for (const chunk of String(html).split(/<li class="b_algo"/).slice(1)) {
    const m = chunk.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!m) continue;
    const url = m[1].replace(/&amp;/g, '&');
    const title = stripTags(m[2]);
    const p = chunk.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const snippet = p ? stripTags(p[1]).slice(0, 300) : stripTags(chunk).slice(0, 220);
    if (title && /^https?:/.test(url)) out.push({ title, url, snippet });
  }
  return out;
}

/** 解析百度结果页（结果以 <h3> 分块，标题链接是真实地址） */
function parseBaiduHtml(html) {
  const out = [];
  for (const chunk of String(html).split(/<h3/).slice(1)) {
    const m = chunk.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!m) continue;
    const url = m[1].replace(/&amp;/g, '&');
    const title = stripTags(m[2]);
    if (!title || !/^https?:/.test(url)) continue;
    const sn = chunk.match(/class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    let snippet = sn ? stripTags(sn[1]) : '';
    if (!snippet) snippet = stripTags(chunk).slice(0, 220);
    if (out.some((x) => x.url === url || x.title === title)) continue;
    out.push({ title, url, snippet: snippet.slice(0, 300) });
  }
  return out;
}

/** 通用：按 <h3><a> 结构解析（搜狗、360 等） */
function parseH3Links(html, getSnippet) {
  const out = [];
  for (const chunk of String(html).split(/<h3/).slice(1)) {
    const m = chunk.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!m) continue;
    let url = m[1].replace(/&amp;/g, '&');
    const title = stripTags(m[2]);
    if (!title || !url) continue;
    if (url.startsWith('//')) url = 'https:' + url;
    if (url.startsWith('/')) continue;                       // 站内跳转链接，跳过
    let snippet = '';
    const sn = getSnippet && getSnippet(chunk);
    snippet = sn || stripTags(chunk).replace(title, '').slice(0, 200);
    if (out.some((x) => x.title === title)) continue;
    out.push({ title, url, snippet: snippet.slice(0, 300) });
  }
  return out;
}

const parseSogouHtml = (html) => parseH3Links(html, (c) => {
  const m = c.match(/class="[^"]*(?:fz-mid|space-txt|str_info|text-layout)[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  return m ? stripTags(m[1]) : '';
});

const parseSo360Html = (html) => parseH3Links(html, (c) => {
  const m = c.match(/class="[^"]*(?:res-desc|res-rich|summary)[^"]*"[^>]*>([\s\S]*?)<\/p>/);
  return m ? stripTags(m[1]) : '';
});

/** B 站公开搜索 API（娱乐内容覆盖极好，无需 Key） */
async function searchBilibili(query, limit) {
  const url = 'https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=1&keyword=' + encodeURIComponent(query);
  const r = await fetch(url, {
    headers: {
      'User-Agent': SEARCH_UA,
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://search.bilibili.com/',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
  });
  if (!r.ok) throw new Error('bilibili HTTP ' + r.status);
  const j = await r.json();
  const list = (j && j.data && j.data.result) || [];
  return list.slice(0, limit).map((v) => ({
    title: stripTags(String(v.title || '')),
    url: v.bvid ? 'https://www.bilibili.com/video/' + v.bvid : (v.arcurl || ''),
    snippet: stripTags(String(v.description || '')).slice(0, 200) + (v.author ? '（UP：' + v.author + '）' : ''),
  })).filter((x) => x.title && x.url);
}

/** 相关性过滤：标题或摘要必须命中查询里的关键词，挡掉引擎兜底的无关结果 */
function relevantResults(results, query) {
  const q = String(query || '');
  const terms = [];
  for (const w of q.split(/[^\w\u4e00-\u9fa5]+/)) {
    if (!w) continue;
    if (/^[\u4e00-\u9fa5]+$/.test(w)) {
      if (w.length >= 2) terms.push(w);
      // 中文长词再拆成 2 字片段，提高召回
      for (let i = 0; i + 2 <= w.length && w.length > 3; i += 2) terms.push(w.slice(i, i + 2));
    } else if (w.length >= 2) terms.push(w);
  }
  const uniq = Array.from(new Set(terms)).filter((t) => t.length >= 2);
  if (!uniq.length) return results;
  return results.filter((r) => {
    const hay = (r.title || '') + ' ' + (r.snippet || '');
    return uniq.some((t) => hay.includes(t));
  });
}

/** 判断是否被反爬拦截 */
const looksBlocked = (html, status) => {
  if (status && status !== 200) return true;
  const t = String(html || '');
  if (t.length < 2500) return true;
  return /安全验证|请输入验证码|wappass|Just a moment|Enable JavaScript and cookies|captcha|unusual traffic|Too many requests/i.test(t);
};

async function fetchText(url, extraHeaders) {
  const r = await fetch(url, {
    headers: Object.assign({
      'User-Agent': SEARCH_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      'Referer': 'https://www.baidu.com/',
    }, extraHeaders || {}),
  });
  return { status: r.status, ok: r.ok, text: ok_text(r), url: r.url };
  function ok_text(resp) { return resp.text(); }
}

/** 多引擎搜索：中文查询百度优先，英文 DuckDuckGo 优先；不足则继续换引擎 */
async function webSearch(query, maxResults) {
  const n = Math.max(1, Math.min(10, Number(maxResults) || 6));
  const q = String(query || '');
  const enc = encodeURIComponent(q);
  const cjk = hasCJK(q);
  const htmlEngines = [
    { id: 'baidu', url: 'https://www.baidu.com/s?wd=' + enc, parse: parseBaiduHtml },
    { id: 'sogou', url: 'https://www.sogou.com/web?query=' + enc, parse: parseSogouHtml },
    { id: '360', url: 'https://www.so.com/s?q=' + enc, parse: parseSo360Html },
    { id: 'duckduckgo', url: 'https://html.duckduckgo.com/html/?q=' + enc, parse: parseDdgHtml },
    { id: 'bing', url: 'https://cn.bing.com/search?q=' + enc, parse: parseBingHtml },
  ];
  const engines = cjk
    ? htmlEngines
    : [htmlEngines[3], htmlEngines[4], htmlEngines[0], htmlEngines[1], htmlEngines[2]];
  // B 站放在中文查询的第二位（娱乐内容命中率高）
  if (cjk) engines.splice(1, 0, { id: 'bilibili', json: true });

  const merged = [];
  const used = [];
  const blocked = [];
  for (const e of engines) {
    if (merged.length >= n) break;
    try {
      let found = [];
      if (e.json) {
        found = await searchBilibili(q, n);
      } else {
        const r = await fetchText(e.url);
        const text = await r.text;
        if (looksBlocked(text, r.status)) { blocked.push(e.id); continue; }
        found = e.parse(text) || [];
      }
      found = relevantResults(found, q);            // 挡掉无关结果
      if (found.length) used.push(e.id + '(' + found.length + ')');
      for (const it of found) {
        if (merged.length >= n) break;
        if (merged.some((x) => x.url === it.url)) continue;
        merged.push(it);
      }
    } catch (err) {
      blocked.push(e.id + ':' + String(err && err.message || err).slice(0, 40));
    }
  }
  return {
    query: q,
    results: merged,
    engine: used.join(' + ') || 'none',
    blocked: blocked.length ? blocked : undefined,
  };
}

/** 读取网页正文（带反爬兜底：直连 → r.jina.ai 文本代理 → 明确失败原因） */
async function fetchPage(url, maxChars) {
  const limit = Math.max(500, Math.min(12000, Number(maxChars) || 6000));
  const clean = (body) => stripTags(body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')).slice(0, limit);

  const attempts = [];
  // 1) 直连
  try {
    const r = await fetchText(url);
    const body = await r.text;
    if (r.ok) {
      const text = clean(body);
      if (text.length > 80) return { url, text, via: 'direct' };
      attempts.push('直连内容过短');
    } else {
      attempts.push('直连 HTTP ' + r.status);
    }
  } catch (e) { attempts.push('直连失败 ' + String(e.message).slice(0, 60)); }

  // 2) r.jina.ai 文本代理（部分站点可绕过）
  try {
    const r = await fetchText('https://r.jina.ai/' + url, { Accept: 'text/plain' });
    const body = await r.text;
    if (r.ok && body && body.length > 200 && !/Just a moment|Enable JavaScript/i.test(body.slice(0, 400))) {
      return { url, text: body.slice(0, limit), via: 'proxy' };
    }
    attempts.push('代理不可用');
  } catch (e) { attempts.push('代理失败 ' + String(e.message).slice(0, 40)); }

  return {
    url,
    text: '',
    error: '该页面无法读取（' + attempts.join('；') + '）。请改用搜索结果里的标题与摘要作答，不要重复尝试同一链接。',
  };
}

ipcMain.handle('search:web', async (_e, opts) => {
  // 测试用桩：MARS_MOCK_SEARCH=1 时返回确定性结果，避免端到端测试依赖外网
  if (env('MOCK_SEARCH')) {
    const q = String((opts && opts.query) || '');
    const results = [
      { title: 'Mock 结果 A：' + q, url: 'https://example.com/a?q=' + encodeURIComponent(q), snippet: '这是测试桩返回的摘要 A，包含辣度与忌口相关信息。' },
      { title: 'Mock 结果 B：' + q, url: 'https://example.com/b?q=' + encodeURIComponent(q), snippet: '这是测试桩返回的摘要 B，包含盐分与糖分相关提示。' },
    ];
    return { ok: true, engine: 'mock', results: results.slice(0, Math.max(1, Number((opts && opts.maxResults) || 6))) };
  }
  try {
    return Object.assign({ ok: true }, await webSearch((opts && opts.query) || '', opts && opts.maxResults));
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

ipcMain.handle('search:fetch', async (_e, opts) => {
  try {
    return Object.assign({ ok: true }, await fetchPage((opts && opts.url) || '', opts && opts.maxChars));
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

// ==================== Edge TTS（微软神经网络语音） ====================
// 用打包内自带的 python 虚拟环境运行 edge-tts；找不到则回退系统语音
const exists = (p) => { try { return !!p && fs.existsSync(p); } catch (_) { return false; } };

/** 找出打包内附带的 site-packages（venv 解释器不可用时，用系统 python + PYTHONPATH 兜底） */
function bundledSitePackages() {
  // 优先：打包的依赖库目录
  const direct = [process.resourcesPath && path.join(process.resourcesPath, 'python-libs'), path.join(__dirname, 'python-libs')].filter(Boolean);
  for (const d of direct) if (exists(path.join(d, 'edge_tts'))) return d;
  // 兼容：旧版打包的 .venv
  const roots = [process.resourcesPath && path.join(process.resourcesPath, '.venv'), path.join(__dirname, '.venv')].filter(Boolean);
  for (const root of roots) {
    const libDir = path.join(root, 'lib');
    if (!exists(libDir)) continue;
    try {
      for (const name of fs.readdirSync(libDir)) {
        const sp = path.join(libDir, name, 'site-packages');
        if (exists(path.join(sp, 'edge_tts'))) return sp;
      }
    } catch (_) {}
  }
  return null;
}

/** 解析 TTS 运行方式：自带 venv → 系统 python + 打包依赖 → 系统 python */
function resolveTtsRunner() {
  const settings = readJSON('settings.json', {}) || {};
  const venvCandidates = [
    env('TTS_PYTHON'),
    settings.ttsPython,
    process.resourcesPath ? path.join(process.resourcesPath, '.venv', 'bin', 'python3') : null,
    path.join(__dirname, '.venv', 'bin', 'python3'),
  ];
  const NO_BYTECODE = { PYTHONDONTWRITEBYTECODE: '1' }; // 避免把 .pyc 写进应用包（会破坏签名封条）
  for (const p of venvCandidates) {
    if (exists(p)) return { python: p, env: Object.assign({}, NO_BYTECODE), tag: 'bundled-venv' };
  }
  const sysCandidates = ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'];
  const site = bundledSitePackages();
  for (const p of sysCandidates) {
    if (!exists(p)) continue;
    if (site) return { python: p, env: { PYTHONPATH: site, PYTHONDONTWRITEBYTECODE: '1' }, tag: 'system+site-packages' };
    return { python: p, env: Object.assign({}, NO_BYTECODE), tag: 'system' };
  }
  return null; // 渲染进程回退到系统语音
}

function runEdgeTts({ text, voice, rate, volume, pitch }) {
  return new Promise((resolve) => {
    const runner = resolveTtsRunner();
    if (!runner) { resolve({ ok: false, error: 'no-python' }); return; }
    const py = runner.python;
    const dir = path.join(os.tmpdir(), 'mars-kitchen-tts');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const mp3 = path.join(dir, stamp + '.mp3');
    const srt = path.join(dir, stamp + '.srt');
    const txt = path.join(dir, stamp + '.txt');
    fs.writeFileSync(txt, String(text || ''), 'utf8');

    const args = ['-B', '-m', 'edge_tts', '--file', txt,
      '--voice', voice || 'zh-CN-XiaoxiaoNeural',
      '--rate', rate || '+0%',
      '--volume', volume || '+0%',
      '--pitch', pitch || '+0Hz',
      '--write-media', mp3,
      '--write-subtitles', srt];

    const child = spawn(py, args, { windowsHide: true, env: Object.assign({}, process.env, runner.env) });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => resolve({ ok: false, error: e.message }));
    const timer = setTimeout(() => { try { child.kill(); } catch (_) {} resolve({ ok: false, error: 'tts-timeout' }); }, 45000);
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const audio = fs.readFileSync(mp3);
        const boundaries = parseSrt(fs.existsSync(srt) ? fs.readFileSync(srt, 'utf8') : '');
        // 清理临时文件
        [mp3, srt, txt].forEach((f) => { try { fs.unlinkSync(f); } catch (_) {} });
        if (code !== 0 && !audio.length) { resolve({ ok: false, error: err.trim().slice(0, 300) || ('exit ' + code) }); return; }
        resolve({
          ok: true,
          audio: audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength),
          boundaries,
          voice,
          bytes: audio.length,
        });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  });
}

/** 解析 edge-tts 输出的 SRT 词边界时间轴 → [{text, startMs, endMs}] */
function parseSrt(srt) {
  const out = [];
  const blocks = String(srt).split(/\r?\n\r?\n/);
  const re = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;
  for (const b of blocks) {
    const m = b.match(re);
    if (!m) continue;
    const toMs = (h, mi, s, ms) => (+h) * 3600000 + (+mi) * 60000 + (+s) * 1000 + (+ms);
    const text = b.split(/\r?\n/).slice(2).join(' ').trim();
    out.push({
      text,
      startMs: toMs(m[1], m[2], m[3], m[4]),
      endMs: toMs(m[5], m[6], m[7], m[8]),
    });
  }
  return out;
}

ipcMain.handle('tts:synth', (_e, opts) => runEdgeTts(opts || {}));
ipcMain.handle('tts:info', async () => {
  const runner = resolveTtsRunner();
  if (!runner) return { available: false, reason: '未找到可用的 python3' };
  const py = runner.python;
  return new Promise((resolve) => {
    const child = spawn(py, ['-B', '-m', 'edge_tts', '--version'], {
      windowsHide: true, env: Object.assign({}, process.env, runner.env),
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', (e) => resolve({ available: false, reason: e.message }));
    child.on('close', (code) => resolve(code === 0
      ? { available: true, python: py, version: out.trim(), mode: runner.tag }
      : { available: false, reason: 'edge-tts 未安装', python: py, mode: runner.tag }));
  });
});
ipcMain.handle('tts:voices', () => new Promise((resolve) => {
  const runner = resolveTtsRunner();
  if (!runner) { resolve({ ok: false, error: 'no-python' }); return; }
  const child = spawn(runner.python, ['-B', '-m', 'edge_tts', '--list-voices'], {
    windowsHide: true, env: Object.assign({}, process.env, runner.env),
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.on('close', () => {
    const voices = out.split(/\r?\n/).map((line) => {
      const m = line.match(/^(\S+)\s+(Female|Male)\s+(.+)$/);
      if (!m) return null;
      const parts = m[3].split(/\s{2,}/);
      const name = m[1];
      const locale = name.slice(0, name.indexOf('-', name.indexOf('-') + 1)) || '';
      return { name, locale, gender: m[2], categories: (parts[0] || '').trim(), personalities: (parts[1] || '').trim() };
    }).filter(Boolean);
    resolve({ ok: voices.length > 0, voices });
  });
  child.on('error', (e) => resolve({ ok: false, error: e.message }));
}));

// ---------- 菜单 ----------
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const send = (action) => () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu', action);
  };
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: '关于火星小厨房' },
        { type: 'separator' },
        { label: '设置…', accelerator: 'Cmd+,', click: send('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏火星小厨房' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出火星小厨房' },
      ],
    }] : []),
    {
      label: '对话',
      submenu: [
        { label: '新建对话', accelerator: 'Cmd+N', click: send('new-chat') },
        { label: '停止生成', accelerator: 'Cmd+.', click: send('stop') },
        { type: 'separator' },
        { label: '删除当前对话', click: send('delete-current') },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '显示',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front', label: '前置全部窗口' }] : [{ role: 'close', label: '关闭窗口' }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- 窗口 ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,          // 侧边栏 + 对话区 + Control 控制面板 + 虚拟形象
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: '火星小厨房',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 16 },
    backgroundColor: '#f7f7f8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  const localPage = require('url').pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;
  const trustedMedia = (contents) => contents === mainWindow?.webContents && contents.getURL() === localPage;
  mainWindow.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) =>
    permission === 'media' && trustedMedia(contents) && details.mediaType === 'audio');
  mainWindow.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(permission === 'media' && trustedMedia(contents) && details.mediaTypes?.length > 0 &&
      details.mediaTypes.every((type) => type === 'audio') && details.isMainFrame !== false));
  mainWindow.on('closed', () => speechService.cancel());
  mainWindow.webContents.on('render-process-gone', () => speechService.cancel());
  mainWindow.webContents.on('did-start-loading', () => speechService.cancel());
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // 外链用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // ---- UI 自检（仅当设置 PERPER_SELFTEST=1 时启用，不影响正常使用）----
  if (env('SELFTEST')) {
    mainWindow.webContents.on('console-message', (_e, ...args) => {
      const msg = typeof args[0] === 'object' && args[0] !== null
        ? (args[0].message || JSON.stringify(args[0]))
        : args.join(' | ');
      console.log('RENDERER_CONSOLE ' + msg);
    });
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const shot = (name) => mainWindow.webContents.capturePage().then((img) => {
            const dir = env('SHOT_DIR');
            if (dir) fs.writeFileSync(path.join(dir, name), img.toPNG());
          });
          const basics = await mainWindow.webContents.executeJavaScript(`(() => ({
            hasBridge: typeof window.niuai !== 'undefined',
            hasWelcome: !!document.querySelector('.welcome'),
            hasSidebarBtn: !!document.querySelector('#sidebar .btn-new'),
            hasInput: !!document.querySelector('#input'),
            modelBadge: (document.getElementById('model-badge')||{}).textContent || '',
            title: document.title,
          }))()`);
          console.log('SELFTEST_BASICS ' + JSON.stringify(basics));
          await shot('01-welcome.png');

          if (env('SELFTEST_CHAT')) {
            // —— 1. 模拟粘贴一个文本附件 ——
            await mainWindow.webContents.executeJavaScript(`
              (async () => {
                const dt = new DataTransfer();
                dt.items.add(new File(['公司代号是 NL-7723，请记住。'], 'info.txt', { type: 'text/plain' }));
                const ta = document.getElementById('input');
                ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
              })()
            `);
            await new Promise((r) => setTimeout(r, 1200));
            const attachInfo = await mainWindow.webContents.executeJavaScript(
              `(() => ({ chips: document.querySelectorAll('.attach-chip').length }))()`
            );
            console.log('SELFTEST_ATTACH ' + JSON.stringify(attachInfo));

            // —— 2. 输入并发送 ——
            await mainWindow.webContents.executeJavaScript(`(() => {
              const ta = document.getElementById('input');
              ta.value = '附件文件里的公司代号是什么？只回答代号本身。';
              ta.dispatchEvent(new Event('input', { bubbles: true }));
              document.getElementById('btn-send').click();
            })()`);
            await new Promise((r) => setTimeout(r, env('SELFTEST_NOSWITCH') ? 300 : 1200));
            const duringA = await mainWindow.webContents.executeJavaScript(`(() => ({
              btnStop: document.getElementById('btn-send').classList.contains('stop'),
              indicator: !document.getElementById('stream-indicator').classList.contains('hidden'),
            }))()`);
            console.log('SELFTEST_STREAMING_A ' + JSON.stringify(duringA));

            // —— 3. 并行状态 / 草稿隔离测试（PERPER_SELFTEST_NOSWITCH=1 时跳过，
            //      用于纯观察“深度思考框随流式动态创建”） ——
            if (!env('SELFTEST_NOSWITCH')) {
            // —— 3. 生成中切到新对话 B：按钮应是“发送”，输入应为空 ——
            await mainWindow.webContents.executeJavaScript(`document.getElementById('btn-new').click()`);
            await new Promise((r) => setTimeout(r, 400));
            const inB = await mainWindow.webContents.executeJavaScript(`(() => ({
              input: document.getElementById('input').value,
              btnStop: document.getElementById('btn-send').classList.contains('stop'),
              rows: document.querySelectorAll('.msg-row').length,
            }))()`);
            console.log('SELFTEST_NEWCHAT_B ' + JSON.stringify(inB));

            // —— 4. 在 B 里打字（不发送）——
            await mainWindow.webContents.executeJavaScript(`(() => {
              const ta = document.getElementById('input');
              ta.value = 'B对话的草稿内容XYZ';
              ta.dispatchEvent(new Event('input', { bubbles: true }));
            })()`);

            // —— 5. 切回 A（按标题定位：非“新对话”的那一项） ——
            await mainWindow.webContents.executeJavaScript(`(() => {
              const items = [...document.querySelectorAll('#conv-list .conv-item')];
              const target = items.find(it => {
                const t = it.querySelector('.conv-title');
                return t && t.textContent !== '新对话';
              });
              if (target) target.click();
              return items.map(it => (it.querySelector('.conv-title')||{}).textContent);
            })()`);
            await new Promise((r) => setTimeout(r, 400));
            const backA = await mainWindow.webContents.executeJavaScript(`(() => ({
              input: document.getElementById('input').value,
              btnStop: document.getElementById('btn-send').classList.contains('stop'),
              dbg: window.__niuDebug(),
            }))()`);
            console.log('SELFTEST_BACK_TO_A ' + JSON.stringify(backA));
            } // end NOSWITCH guard（并行/草稿切换部分）

            // —— 6. 等待 A 的流式输出完成并读取回答 ——
            const chatResult = await new Promise((resolve) => {
              const t0 = Date.now();
              let seenReasonWhileEmpty = false;
              let sawSpeaking = false;
              let sawAvatarMouth = false;
              let sawSpeakingStatus = '';
              const timer = setInterval(async () => {
                const r = await mainWindow.webContents.executeJavaScript(`(() => {
                  const b = document.querySelector('.msg-row:last-child .assistant-body');
                  const rb = document.querySelector('.msg-row:last-child .reason-body');
                  const av = window.__niuAvatar ? window.__niuAvatar() : null;
                  return {
                    rows: document.querySelectorAll('.msg-row').length,
                    content: b ? b.textContent : '',
                    reasoningLen: rb ? rb.textContent.length : 0,
                    hasReasonBox: !!document.querySelector('.msg-row:last-child .reason-box'),
                    cursor: !!document.querySelector('.typing-cursor'),
                    speaking: window.Speech ? window.Speech.isSpeaking() : false,
                    avatarMood: av ? av.mood : null,
                    avatarMouth: av ? av.mouth : 0,
                    avatarStatus: document.getElementById('avatar-status').textContent,
                  };
                })()`);
                if (r.reasoningLen > 0 && !r.content) seenReasonWhileEmpty = true;
                if (r.speaking) { sawSpeaking = true; sawSpeakingStatus = r.avatarStatus; }
                if (r.avatarMood === 'speaking' || r.avatarMouth > 0.05) sawAvatarMouth = true;
                r.seenReasonWhileEmpty = seenReasonWhileEmpty;
                r.sawSpeakingFromAnswer = sawSpeaking;
                r.sawAvatarMouthFromAnswer = sawAvatarMouth;
                r.speakingStatusText = sawSpeakingStatus;
                // 正文出现且流式光标消失 = 本轮回答结束（忽略“思考中…”占位文字）
                const realContent = r.content.replace('思考中…', '').trim();
                if ((realContent.length > 0 && !r.cursor) || Date.now() - t0 > 60000) {
                  clearInterval(timer);
                  resolve(r);
                }
              }, 350);
            });
            console.log('SELFTEST_CHAT ' + JSON.stringify(chatResult));

            // 回答刚结束的瞬间采样：确认「AI 输出 → 自动播报」已触发
            if (env('SELFTEST_AVATAR')) {
              const auto = await mainWindow.webContents.executeJavaScript(`(() => ({
                speaking: window.Speech ? window.Speech.isSpeaking() : false,
                status: document.getElementById('avatar-status').textContent,
                mood: window.__niuAvatar ? window.__niuAvatar().mood : null,
                mouth: window.__niuAvatar ? window.__niuAvatar().mouth : null,
              }))()`).catch((e) => ({ error: String(e && e.message) }));
              console.log('SELFTEST_AVATAR_AUTOSPEAK ' + JSON.stringify(auto));
            }

            // —— 7. 切回 B（标题为“新对话”的那一项）：草稿应保留 ——
            if (!env('SELFTEST_NOSWITCH')) {
            await mainWindow.webContents.executeJavaScript(`(() => {
              const items = [...document.querySelectorAll('#conv-list .conv-item')];
              const target = items.find(it => {
                const t = it.querySelector('.conv-title');
                return t && t.textContent === '新对话';
              });
              if (target) target.click();
            })()`);
            await new Promise((r) => setTimeout(r, 400));
            const draftB = await mainWindow.webContents.executeJavaScript(
              `JSON.stringify({ input: document.getElementById('input').value, dbg: window.__niuDebug() })`
            );
            console.log('SELFTEST_DRAFT_B ' + draftB);
            } // end NOSWITCH guard（草稿回看部分）

            await shot('02-chat.png');
          }

          // —— 通用调试：执行一个 JS 文件并把结果打进日志 ——
          if (env('SELFTEST_EVAL')) {
            try {
              const js = fs.readFileSync(env('SELFTEST_EVAL'), 'utf8');
              const out = await mainWindow.webContents.executeJavaScript(js);
              console.log('SELFTEST_EVAL ' + JSON.stringify(out));
              // 可选：探针跑完后截一张图，便于人工核对界面
              if (env('SELFTEST_EVAL_SHOT')) await shot(env('SELFTEST_EVAL_SHOT'));
            } catch (e) {
              console.log('SELFTEST_EVAL_ERROR ' + JSON.stringify(String(e && e.message ? e.message : e)));
            }
          }

          // —— 虚拟形象自检 ——
          if (env('SELFTEST_AVATAR')) {
            // 等待形象加载完成
            const av = await new Promise((resolve) => {
              const t0 = Date.now();
              const timer = setInterval(async () => {
                const r = await mainWindow.webContents.executeJavaScript(`window.__niuAvatar ? window.__niuAvatar() : null`);
                if ((r && r.ready) || Date.now() - t0 > 60000) { clearInterval(timer); resolve(r); }
              }, 700);
            });
            console.log('SELFTEST_AVATAR_LOAD ' + JSON.stringify(av));

            // 驱动口型，采样开合值变化
            await mainWindow.webContents.executeJavaScript(`window.__niuAvatarSpeak('这是一段中文播报测试，用来验证口型同步是否正常工作。')`);
            const mouthSamples = [];
            for (let i = 0; i < 8; i++) {
              await new Promise((r) => setTimeout(r, 160));
              const m = await mainWindow.webContents.executeJavaScript(`(() => { const a = window.__niuAvatar(); return { mouth: a.mouth, mood: a.mood, speaking: a.speaking }; })()`);
              mouthSamples.push(m);
            }
            const mouthValues = mouthSamples.map((s) => s.mouth);
            console.log('SELFTEST_AVATAR_LIPSYNC ' + JSON.stringify({
              samples: mouthValues,
              max: Math.max.apply(null, mouthValues),
              moved: new Set(mouthValues.map((v) => v.toFixed(2))).size > 2,
              mood: mouthSamples[0].mood,
            }));

            // 真实语音播报链路（若系统有语音）
            const speechTry = await mainWindow.webContents.executeJavaScript(`(() => {
              const sys = window.Speech ? window.Speech.systemVoices() : [];
              const cfg = window.Speech ? window.Speech.config() : {};
              if (window.Speech) window.Speech.speak('你好，我是火星小厨房助手。'); // 异步：不等待
              return { started: !!window.Speech, engine: cfg.engine, voice: cfg.voice, systemVoices: sys.length };
            })()`);
            await new Promise((r) => setTimeout(r, 1500));
            const speechState = await mainWindow.webContents.executeJavaScript(`(() => ({
              speaking: window.Speech ? window.Speech.isSpeaking() : false,
              status: document.getElementById('avatar-status') ? document.getElementById('avatar-status').textContent : '',
              avatarMood: window.__niuAvatar().mood,
              avatarMouth: window.__niuAvatar().mouth,
            }))()`);
            console.log('SELFTEST_AVATAR_SPEECH ' + JSON.stringify(Object.assign({ voices: speechTry.voices, firstVoice: speechTry.firstName }, speechState)));
            await mainWindow.webContents.executeJavaScript(`window.Speech && window.Speech.stop(); window.__niuAvatarEnd();`);
            await new Promise((r) => setTimeout(r, 400));
            await shot('03-avatar.png');

            // 设置面板（含语音引擎/语音选择）截图
            await mainWindow.webContents.executeJavaScript(`document.getElementById('btn-settings').click()`);
            await new Promise((r) => setTimeout(r, 4500)); // 等 Edge 语音检测完成再截图
            const settingsInfo = await mainWindow.webContents.executeJavaScript(`(() => ({
              engines: Array.from(document.querySelectorAll('#set-ttsEngine option')).map(o => o.value),
              voiceOptions: Array.from(document.querySelectorAll('#set-ttsVoice option')).map(o => o.textContent),
              selectedVoice: document.getElementById('set-ttsVoice').value,
              ttsStatus: document.getElementById('tts-status').textContent,
              rate: document.getElementById('set-ttsRate').value,
            }))()`);
            console.log('SELFTEST_TTS_SETTINGS ' + JSON.stringify(settingsInfo));
            await shot('04-settings.png');
            await mainWindow.webContents.executeJavaScript(`document.getElementById('btn-cancel-settings').click()`);
          }

          // —— 技能面板截图 ——
          if (env('SELFTEST_SKILLS')) {
            await mainWindow.webContents.executeJavaScript(`document.getElementById('btn-settings').click()`);
            await new Promise((r) => setTimeout(r, 1200));
            const info = await mainWindow.webContents.executeJavaScript(`(() => {
              const box = document.getElementById('skill-list');
              if (box && box.scrollIntoView) box.scrollIntoView({ block: 'center' });
              const items = Array.from(document.querySelectorAll('#skill-list .skill-item'));
              return {
                count: items.length,
                names: items.map((it) => it.querySelector('.skill-name').textContent),
                toggles: items.map((it) => it.querySelector('input[type=checkbox]').checked),
                prompts: items.map((it) => (it.querySelector('.skill-prompt').value || '').slice(0, 24)),
                hasInstallBtn: !!document.getElementById('btn-skill-install'),
              };
            })()`);
            console.log('SELFTEST_SKILLS ' + JSON.stringify(info));
            await new Promise((r) => setTimeout(r, 600));
            await shot('11-skills.png');
            await mainWindow.webContents.executeJavaScript(`document.getElementById('btn-cancel-settings').click()`);
          }

          // —— 拖动旋转截图（验证水平旋转渲染）——
          if (env('SELFTEST_ROTATE')) {
            // 等模型加载完成
            await new Promise((resolve) => {
              const t0 = Date.now();
              const timer = setInterval(async () => {
                const r = await mainWindow.webContents.executeJavaScript(`window.__niuAvatar ? window.__niuAvatar().ready : false`);
                if (r || Date.now() - t0 > 40000) { clearInterval(timer); resolve(); }
              }, 600);
            });
            await shot('09-front.png');
            await mainWindow.webContents.executeJavaScript(`window.__niuAvatarHandle().setYaw(1.05)`);   // 约 60°
            await new Promise((r) => setTimeout(r, 1200));
            const yawInfo = await mainWindow.webContents.executeJavaScript(`(() => ({ yawDeg: window.__niuAvatar().yawDeg }))()`);
            console.log('SELFTEST_ROTATE ' + JSON.stringify(yawInfo));
            await shot('10-rotated.png');
          }

          // —— 联网搜索自检与截图 ——
          if (env('SELFTEST_SEARCH')) {
            await mainWindow.webContents.executeJavaScript(`(() => {
              const ta = document.getElementById('input');
              ta.value = '搜索一下 DeepSeek V4 有哪些新特性';
              ta.dispatchEvent(new Event('input', { bubbles: true }));
              document.getElementById('btn-send').click();
            })()`);
            const info = await new Promise((resolve) => {
              const t0 = Date.now();
              const timer = setInterval(async () => {
                const r = await mainWindow.webContents.executeJavaScript(`(() => {
                  const last = Array.from(document.querySelectorAll('#messages .msg-row')).pop();
                  const body = last ? last.querySelector('.assistant-body') : null;
                  const box = last ? last.querySelector('.search-box') : null;
                  return {
                    content: body ? body.textContent : '',
                    cursor: !!(last && last.querySelector('.typing-cursor')),
                    searchBox: !!box,
                    label: box ? box.querySelector('.search-label').textContent : null,
                    sources: box ? box.querySelectorAll('.search-src').length : 0,
                    messages: window.__niuMessages ? window.__niuMessages().length : 0,
                  };
                })()`);
                if ((r.content.replace('思考中…', '').trim().length > 20 && !r.cursor) || Date.now() - t0 > 120000) {
                  clearInterval(timer); resolve(r);
                }
              }, 700);
            });
            console.log('SELFTEST_WEB_SEARCH ' + JSON.stringify(info));
            await shot('08-search.png');
          }

          // —— 文件夹视图自检与截图 ——
          if (env('SELFTEST_FOLDER')) {
            await mainWindow.webContents.executeJavaScript(`(() => {
              document.getElementById('btn-view-toggle').click();   // 切到文件夹视图
            })()`);
            await new Promise((r) => setTimeout(r, 800));
            // 打开第一个对话窗口
            await mainWindow.webContents.executeJavaScript(`(() => {
              const first = document.querySelector('.folder-card');
              if (first) {
                first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
                first.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
              }
            })()`);
            await new Promise((r) => setTimeout(r, 1200));
            const folderInfo = await mainWindow.webContents.executeJavaScript(`(() => ({
              cards: document.querySelectorAll('.folder-card').length,
              icons: Array.from(document.querySelectorAll('.folder-card img')).map(i => i.getAttribute('src').split('/').pop()),
              windows: document.querySelectorAll('.conv-window').length,
              windowTitle: document.querySelector('.conv-window .cw-title') ? document.querySelector('.conv-window .cw-title').textContent : null,
              messagesInWindow: document.querySelectorAll('.conv-window .cw-messages .msg-row').length,
              sidebarHidden: document.getElementById('sidebar').classList.contains('hidden'),
            }))()`);
            console.log('SELFTEST_FOLDER_VIEW ' + JSON.stringify(folderInfo));
            await shot('05-folder.png');

            // 模拟悬停交通灯，验证功能符号显示
            await mainWindow.webContents.executeJavaScript(`(() => {
              const st = document.createElement('style');
              st.textContent = '.conv-window .cw-dots i::after { opacity: 1 !important; }';
              document.head.appendChild(st);
            })()`);
            await new Promise((r) => setTimeout(r, 500));
            await shot('07-traffic-lights.png');

            // 在窗口里发一条消息（真实 API），验证窗口内流式渲染
            if (env('SELFTEST_FOLDER_CHAT')) {
              await mainWindow.webContents.executeJavaScript(`(() => {
                const ta = document.querySelector('.conv-window .cw-input');
                ta.value = '用一句话说明你叫什么名字';
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                document.querySelector('.conv-window .cw-send').click();
              })()`);
              const res = await new Promise((resolve) => {
                const t0 = Date.now();
                const timer = setInterval(async () => {
                  const r = await mainWindow.webContents.executeJavaScript(`(() => {
                    const rows = document.querySelectorAll('.conv-window .cw-messages .msg-row');
                    const last = rows[rows.length - 1];
                    const body = last ? last.querySelector('.assistant-body') : null;
                    return {
                      rows: rows.length,
                      content: body ? body.textContent : '',
                      cursor: !!(last && last.querySelector('.typing-cursor')),
                      streamingSend: document.querySelector('.conv-window .cw-send').title,
                    };
                  })()`);
                  if ((r.content.replace('思考中…', '').trim().length > 0 && !r.cursor) || Date.now() - t0 > 60000) {
                    clearInterval(timer); resolve(r);
                  }
                }, 500);
              });
              console.log('SELFTEST_FOLDER_CHAT ' + JSON.stringify(res));
              await shot('06-folder-chat.png');
            }
          }
        } catch (e) {
          console.error('SELFTEST_ERROR', e);
        }
        app.quit();
      }, 2500);
    });
  }
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
