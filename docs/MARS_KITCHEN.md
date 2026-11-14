# 火星小厨房 功能与实现对照

本文把产品需求逐条对照到 火星小厨房 的实现位置，便于验收。

> 技术栈：Electron + 原生 JS 渲染层 + DeepSeek OpenAI 兼容接口。

---

## 1 项目概述

| 需求 | 实现 |
| --- | --- |
| 基于 DeepSeek API 构建 Agent | `renderer/js/api.js`（OpenAI 兼容 SSE 流式客户端）+ 设置面板可配 `baseURL` / `model` / `apiKey` |
| 具备联网搜索能力 | `main.js` 的 `search:web` / `search:fetch`（多引擎：百度 / DuckDuckGo / Bing / 搜狗 / 360），模型通过 function calling 自主调用 |
| 前端选择 普通模式 / 老年模式 | **首次打开 App 弹出的设置向导**里的「老年模式」开关 → `settings.marsVersion`（`elderly` / `normal`） |
| 动态加载对应人设（A.md / shtu） | `main.js` 的 `mars:profile` IPC 读取 `mars_profile/`，渲染层 `Mars.buildSystemPrompt()` 按版本二选一 |
| 口味档位映射为约束指令并入 prompt | `mars_profile/档位映射.md` 全文 + 参数快照（`renderer/js/mars.js`） |
| Agent 内部执行：参数解析 → 联网检索 → 推理生成 → 标准化输出 | `renderer/js/app.js` 的 `runAgentLoop()`（多轮工具调用循环） |
| 调用计数 / 表格输出模块 | 联网搜索次数在气泡内搜索框展示（「🔍 联网搜索 · N 次查询」）；markdown 表格在回答气泡内渲染。主界面无独立 Control 面板 |

## 2 Input 输入定义

### 2.1 系统侧静态文件

| 需求 | 文件 | 位置 |
| --- | --- | --- |
| Skill.md（全局总技能） | `mars_profile/Skill.md` | 项目内；随包 `Contents/Resources/mars_profile/`；运行时播种到 `~/Library/Application Support/火星小厨房/mars_profile/` |
| A.md（普通版人设） | `mars_profile/A.md` | 同上 |
| shtu（老年模式人设） | `mars_profile/shtu.md`（加载器同时兼容无扩展名的 `shtu`） | 同上 |
| 档位映射配置 | `mars_profile/档位映射.md`（加载器同时兼容 `levels.md`） | 同上 |

### 2.2 用户前端输入

| 参数 | 界面元素 | 默认值 |
| --- | --- | --- |
| 老年模式开关 | `#ob-elder`（首次启动弹窗）/ `#set-elder`（设置面板） | 关（= `A.md`） |
| 辣度 0-4 | `#ob-spicy` / `#set-spicy` 下拉 | 0 无辣 |
| 甜度 0-4 | `#ob-sweet` / `#set-sweet` 下拉 | 0 无糖 |
| 咸度 0-4 | `#ob-salty` / `#set-salty` 下拉 | 0 无盐 |
| 忌口&过敏 | `#ob-avoid` / `#set-avoid` 文本框（自由文本） | 空 |
| 用户原始 Query | `#input` 输入框 + 发送按钮 | — |
| 恢复默认 | `#ob-defaults` 按钮 → `resetMarsParams("onboard")` | 恢复上述默认值 |

档位下拉的选项文案（`renderer/js/mars.js` 的 `LEVELS`）与 `档位映射.md` 一一对应。

### 2.3 档位映射规则

`mars_profile/档位映射.md` 原文收录辣/甜/咸 0-4 档含义与「忌口过敏（全局生效，涉及食材必遵守）」，
由 `Mars.buildSystemPrompt()` 追加到 System Prompt 中（位置：人设之后、参数快照之前）。

## 3 三个 md 文件

| 需求文件 | 实现文件 | 备注 |
| --- | --- | --- |
| Skill.md | `mars_profile/Skill.md` | 原文收录 §1 可用工具 / §2 固定执行流程 / §3 全局安全规则 / §4 输入输出格式；并含 §5 边界规则（需求 §7）、§6 输出硬性要求 |
| A.md | `mars_profile/A.md` | 原文收录 |
| shtu | `mars_profile/shtu.md` | 原文收录（「您」称呼、通俗短句、煤气安全提醒强制规则、高盐高糖重油提醒） |

## 4 System Prompt 组装逻辑（核心）

`renderer/js/mars.js` → `buildSystemPrompt(profile, settings, opts)`：

```
Skill.md 全文
  \n\n---\n\n
A.md 或 shtu（二选一）
  \n\n---\n\n
档位映射.md 全文
  \n\n---\n\n
## 当前用户配置（本次请求生效）
版本=老年人版；辣度=1；甜度=2；咸度=2；忌口&过敏：虾过敏
- 辣度：1（微辣）→ 轻微辣味，刺激低
- 甜度：2（中甜）→ 均衡适口
- 咸度：2（中咸）→ 咸淡均衡
- 忌口&过敏（全局约束）：虾过敏
- 问题类型判定：美食/菜谱类 → 辣度、甜度、咸度档位全部生效 …
- 本题判定为「做饭 / 用火 / 烧水 / 燃气」场景 → 回答末尾一定要加上安全提示：…
只输出回答正文：不要输出【主体回答】【提示信息】等标记，也不要输出参数快照或联网搜索调用次数。全部内容必须遵守以上约束。
```

- 组装在前端完成（需求 §6.1「前端预加载」），静态素材由主进程 `mars:profile` 一次性读出后缓存。
- 端到端测试会抓取真正发给 DeepSeek 的 `system` 消息并断言上面的顺序与内容。

## 5 前端页面设计

| 需求模块 | 实现 |
| --- | --- |
| 1. 参数配置表单区（老年模式开关 / 辣甜咸下拉 / 忌口文本框 / 恢复默认 / 开始使用） | **首次打开 App 自动弹出的设置向导** `#onboard-overlay`（`#ob-*`）；之后可在设置面板 `#set-elder` / `#set-spicy` … 修改。主界面无参数栏 |
| 2. 对话输入区 | 输入框 `#input-shell`（支持图片/文本/PDF 附件）+ 麦克风语音输入 |
| 3. 对话展示区 | 气泡只渲染回答正文：`marsAnswerHtml()` → `Mars.parseOutput()` 剥掉分段标记 → Markdown（含表格） |
| 4. 调用计数 / 表格 | 联网搜索次数在气泡的搜索框里展示；对比型回答的 markdown 表格直接在气泡内渲染。主界面无独立 Control 面板 |

## 6 整体执行流程

1. 前端预加载 Skill.md、A.md、shtu、档位映射文本 —— `app.js init()` 里的 `await loadMarsProfile()`（走 `mars:profile`）
2. 首次打开弹窗选择老年模式、填写口味与忌口（之后在设置里改），输入问题 —— `#onboard-overlay` + `#input`
3. 程序读取对应版本 md —— `Mars.buildSystemPrompt()` 按 `marsVersion` 二选一
4. 拼接 System Prompt —— 同上（Skill + 人设 + 档位映射 + 用户参数）
5. 送入 DeepSeek，Agent 判断是否调用联网搜索 —— `api.js streamRound()` + `app.js runAgentLoop()` / `buildTools()`
6. 结合人设与约束生成回答 —— 第二轮请求携带 `tool` 结果
7. 返回标准化 Output，前端渲染对话正文 —— `marsAnswerHtml()`

## 7 边界规则

| 规则 | 实现 |
| --- | --- |
| 1. 辣/甜/咸只对美食菜谱类生效 | `Mars.isFoodQuestion()` 判定后写入参数快照（生效 / 忽略二选一），并在 `Skill.md` §5 声明 |
| 2. 忌口过敏全局约束 | `Skill.md` §3/§5 + `档位映射.md` 末节 + 每次请求的参数快照 |
| 3. shtu（老年模式）仅做饭/燃气用火场景强制煤气提醒 | `Mars.isKitchenQuestion()` 判定后写入针对性指令行；非厨房问题只保留「您」称呼与短句风格 |
| 4. 普通版不自动加煤气/居家安全提醒 | 普通版 prompt 只包含 `A.md`（无安全提醒规则），且参数快照不注入安全提醒行 |
| 5.（产品补充）老年模式放大字号 | `app.js applyElderMode()` 给 `<body>` 加 `elder-mode` 类，`style.css` 统一放大回答正文 / 标题 / 表格 / 输入框 / 侧边栏 / 弹窗字号 |
| 6. 档位不机械套用，甜咸谁高听谁 | `档位映射.md`「档位应用原则」+ `buildSystemPrompt()` 按用户实际档位动态追加「优先推荐甜口 / 咸口」 |
| 7. 老年模式高档位健康提醒 | `Mars.healthRisks()` 判定 + `app.js maybeShowHealthWarning()` 弹窗（返回修改 / 确认并继续），见 §10 |

## 8 Output 输出格式

`Skill.md` §4/§6 要求**只输出回答正文**，明确禁止输出：

```
【主体回答】 / 【提示信息】 等分段标记
> 当前生效参数：版本=…，辣度=…，甜度=…，咸度=…；忌口：…
> 联网搜索调用次数：N次
```

前端 `Mars.parseOutput()` 只取正文（若模型输出带分段标记，标记与提示信息会被整段剥掉），
再由 `marsAnswerHtml()` 走 Markdown 渲染。联网搜索次数在气泡上的搜索框展示。

---

## 9 品牌与数据隔离

| 需求 | 实现 |
| --- | --- |
| 界面名称 / 软件名称为「火星小厨房」 | `app.setName('火星小厨房')`、窗口标题、顶栏品牌、欢迎页标题、气泡助手名、虚拟形象名、首次启动弹窗、设置弹窗、菜单项（关于/隐藏/退出）、`Info.plist` 的 `CFBundleName` / `CFBundleDisplayName` / `CFBundleExecutable`、`package.json` 的 `productName` |
| 数据独立，不读写其他应用的数据 | 数据目录 = `~/Library/Application Support/火星小厨房/`；代码不引用其他应用的数据路径；E2E 用伪造的其他应用数据断言「一条都不读、原文件不改」 |

### 验证要点

- `npm test` 静态断言：`main.js` 含 `app.setName('火星小厨房')`，且不含 `migrateLegacyData` / `LEGACY_DIR` / 其他应用数据路径
- `npm run test:e2e` 行为断言：数据只落在 `appData/火星小厨房/`；伪造的其他应用会话与配置未被读取；原文件未被修改


## 10 健康提醒与输出约束

| 需求 | 实现 | 验证 |
| --- | --- | --- |
| 老年模式 + 辣/甜/咸最上面两档 → 弹窗健康提醒，可返回修改或确认 | `mars.js` 的 `healthRisks()` 判定（阈值 `HEALTH_RISK_FROM = 3`，仅 `version === 'elderly'` 生效）；`app.js` 的 `maybeShowHealthWarning()` 弹 `#health-overlay`：逐项列出「辣度 3 · 特辣 → 强烈辣味，对肠胃刺激较大」等；「返回修改」只关弹窗不落库，「确认并继续」才写 `settings` 并持久化。首次启动弹窗（`#ob-save`）与设置面板（`#btn-save-settings`）两条路径都会先检查 | `npm test` 的 [7b] 节 + E2E「健康提醒」4 项 |
| 输出不含【提示信息】/参数快照/调用次数 | `Skill.md` §4/§6 要求「只输出回答正文」，明确禁止输出 `【主体回答】`/`【提示信息】`、参数快照、调用次数；`buildSystemPrompt()` 末尾同步声明；前端 `marsAnswerHtml()` 只渲染 `Mars.parseOutput()` 出的正文，模型输出带标记也会被剥掉 | `npm test` [6] 节 + E2E「回答里没有【提示信息】」 |
| 档位不机械套用；甜咸谁高听谁 | `档位映射.md` 含「档位应用原则」（偏好上限、不强行加辣/加糖/加盐、番茄炒蛋例子、甜>咸→甜口、咸>甜→咸口、相同按传统口味）；`buildSystemPrompt()` 按用户实际档位动态追加「优先推荐甜口/咸口」 | `npm test` [7] 节 + E2E「System Prompt 要求不要机械套用档位」 |

### 健康提醒的判定与文案

触发条件：`老年模式` **且** 辣度 / 甜度 / 咸度中任意一项 ≥ 3。

| 档位 | 提醒文案 |
| --- | --- |
| 辣度 3 特辣 | 强烈辣味，对肠胃刺激较大 |
| 辣度 4 爆辣 | 重辣，容易引起肠胃不适，老年人尤其要当心 |
| 甜度 3 很甜 | 甜味突出，糖分偏高，注意血糖 |
| 甜度 4 超甜 | 甜度很高，糖分高，血糖偏高的人要格外注意 |
| 咸度 3 很咸 | 咸味偏重，钠摄入偏高，注意血压 |
| 咸度 4 超咸 | 高盐，钠摄入很高，血压偏高的人要格外注意 |


## 11 应用图标 / 界面 logo

应用图标与界面 logo 为透明底素材，由 `tools/gen-icon.py` 从源图生成。

| 项 | 说明 |
| --- | --- |
| 源图选择 | `gen-icon.py` 的候选顺序：根目录 `火星小厨房AI.png` → `logo.png` → `logo.PNG` → `logo.jpg`；仓库随附已生成的 `build/AppIcon.icns` 与 `renderer/assets/logo.png` |
| 透明源通道 | `source_has_alpha()` 检测到源图自带 alpha（透明像素 > 1%）时走 `from_transparent()`：**不估底色、不做反混合**，直接沿用 alpha；仅清理近全透明噪点与极小碎块 |
| 不透明源通道 | JPG/带底色 PNG 走「估底色 → 连通域泛洪 → 边缘颜色反混合」 |
| 缩放 | 交给 Pillow 的 RGBA 重采样（Pillow ≥ 10 已是 alpha 感知）；不做手工预乘，避免 LANCZOS 负振铃在边缘产生纯黑像素（黑边） |
| 自检 | 四角必须全透明、内容占比 15%~95%、内容居中（偏移 ≤ 6px）、半透明边缘不得出现纯黑像素（黑边） |
| 产物 | `build/AppIcon.iconset/*`（10 个尺寸）→ `build/AppIcon.icns`；`build/icon-preview.png`、`build/icon-preview-checker.png`（白底/深底/棋盘/透明 四宫格预览）；`renderer/assets/logo.png`(512)、`logo-128.png` |


## 测试与验收

```bash
cd Mars_Kitchen
npm test           # 单元测试（40 项）：组装顺序 / 版本二选一 / 档位夹取 / 边界规则 / 输出解析 / 表格提取
npm run test:voice # 语音测试（37 项）：录音编码 / 识别引擎 / 连续对话 / 播报衔接
npm run test:e2e   # 端到端（45 项）：真实 Electron + Mock DeepSeek，断言发出去的 System Prompt 与界面渲染

# 也可以直接对打包后的 .app 跑同一套端到端测试
MARS_E2E_APP="$PWD/dist/火星小厨房-darwin-arm64/火星小厨房.app/Contents/MacOS/火星小厨房" npm run test:e2e
```

E2E 断言覆盖（45 项）：

- 四份素材预加载；主界面**没有**参数栏与 Control 面板
- **首次打开自动弹出设置向导**，默认值 = 普通模式 / 辣0 甜0 咸0 / 忌口空
- 打开**老年模式**后整体字号放大（弹窗 + AI 回答正文），写入后加载 `shtu`、参数快照逐项一致
- **火星姐模型显示 + 自动播报默认开启**（`avatarEnabled` / `avatarAutoSpeak` / `Martian.vrm` / 面板可见）
- markdown 表格渲染、组装顺序、Skill/人设/档位映射/快照内容
- 联网搜索工具与工具结果；未启用技能不注入；人设档案播种到用户目录
- **健康提醒**：老年模式 + 辣3/甜3 → 弹窗列出两项；「返回修改」不落库、「确认并继续」才保存；普通模式不弹
- **回答不含提示信息**：mock 故意返回带 `【提示信息】` 的分段格式，界面必须把它剥干净
- **档位应用原则**：甜>咸 → System Prompt 出现「优先推荐甜口」
- 在「设置」里关闭老年模式后字号恢复
- **数据隔离**：数据只落在 `appData/火星小厨房/`；伪造的其他应用数据不被读取、原文件不被修改

## 完整功能清单

- 流式输出（SSE）+ 深度推理（`reasoning_content` / `reasoning_details`，思考中展开、结束自动折叠）
- 联网搜索（多引擎、来源可点击、`web_search` / `fetch_page` 工具调用与 DSML 兼容层）
- 图片视觉输入 + 文本 / PDF 附件（点击、粘贴、拖入）
- 中文语音输入（macOS 系统离线识别 / 云端接口）与连续语音对话，见 `docs/CHINESE_VOICE.md`
- 多对话并行生成、草稿按对话隔离、重新生成、复制消息
- 列表视图 / 文件夹视图（双击浮动窗口、⌘C/⌘V 分叉、17 款图标、右键菜单）
- 技能（Skills）安装 / 启停 / 自定义提示词 / 资源文件按需读取（`read_skill_file`）；随包不内置技能，启动时清理标记移除的技能条目（`cleanupRemovedSkills`）
- 3D 虚拟形象（VRM 多模型、口型同步、自动播报）与 Edge / 系统双语音引擎
- 会话与设置本地持久化（`~/Library/Application Support/火星小厨房/`），数据独立存储，不读写其他应用的数据
