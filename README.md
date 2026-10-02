# PerPer — macOS AI 对话客户端

**PerPer** — 一个参考 DeepSeek / 豆包界面的 macOS 桌面聊天应用（红色渐变主题，图标与对话头像取自 `logo.png`），通过 **OpenAI 兼容接口** 连接 **DeepSeek 官方 API**（默认模型 `deepseek-flash`，即 DeepSeek flash v4.1），支持流式输出、深度推理（`reasoning_content`）与图片视觉输入。

![界面](https://img.shields.io/badge/platform-macOS%20arm64-blue) ![Tech](https://img.shields.io/badge/tech-Electron%20%2B%20SwiftUI--style-8b5cf6)

## ✨ 功能

- 🎨 **红色渐变主题**：强调色/发送按钮/用户气泡/品牌文字均为红色渐变；图标与对话头像为抠除白底后的 `logo.png` 参考 DeepSeek 风格的聊天界面：侧边栏会话列表、欢迎页、消息气泡、Markdown 渲染、代码块一键复制
- ⚡ **流式输出**（SSE），逐字显示；可随时「停止生成」
- 🧠 **深度推理**：开启 `reasoning` 后显示「深度思考过程」——**思考中自动展开并实时流式显示**，**思考结束（开始输出答案）时自动折叠**，标签显示用时，点一下可再展开；并支持 `reasoning_details` 原样回传（模型可继续推理）
- 🧍 **3D 虚拟形象**：支持**多模型切换**（VRM 0.x / 1.0），自然站姿（手臂下垂 **自动校准**）、自动眨眼、呼吸起伏、视线跟随鼠标、说话时小幅手势；可在设置中一键关闭
- 🗣️ **语音播报**：AI 回答自动播报，口型按 Edge 词边界时间轴逐音节开合（每音节「张口→闭口」），播报结束自动闭嘴
- 🎙️ **Edge 神经语音**（默认）：微软神经网络语音，中英双语女声（晓晓 / 晓伊 / Ava / Emma 可选），自带依赖库、无需 API Key；不可用时自动回退系统语音
- 🧩 **技能（Skills）**：设置里可**安装技能**（文件夹 / `SKILL.md` / `.md` / `.zip`），每个技能有**独立开关**决定是否使用；技能还可选配一段**系统提示词**
  - **优先级**：启用技能若配了提示词 → **覆盖**全局系统提示词；未配 → 沿用全局（多个技能都配了则按顺序拼接）
  - 启用技能的说明（SKILL.md 正文）会作为「可用技能」注入到 system 消息中
  - 技能存放在 `~/Library/Application Support/PerPer/skills/<技能id>/SKILL.md`，可点「打开技能目录」直接管理
- 🌐 **联网搜索**（默认开启，无需任何 API Key）：DeepSeek 官方 API 本身**不提供**内置联网，PerPer 通过 **function calling + 内置 DuckDuckGo 搜索**实现——模型自主决定何时搜索（`web_search`）或读取网页（`fetch_page`），回答时在气泡里展示「搜索了几次 / 命中的来源链接」（来源可点击直接在浏览器打开）
  - 顶栏 🔍 一键开关；设置里可调「最多搜索轮次」（1~6，默认 3）
  - 搜索走主进程（无 CORS 限制），不需要任何第三方搜索 Key
- 📎 **上传图片 / 文本 / PDF**：点击回形针、直接粘贴或拖入输入框；图片以视觉格式发给模型，文本/PDF 提取正文内联发送
- 🔀 **多对话并行生成**：每个对话独立流式任务，切换对话互不打断；输入草稿、发送/停止按钮均按对话隔离
- 📁 **两种显示方式**（顶栏按钮一键切换）：
  - **列表模式**：左侧会话列表 + 主聊天区（经典布局）
  - **文件夹模式**：整个窗口变成文件管理器，每个对话是一个文件夹图标；**双击**在浮动窗口里打开对话（可多开、可拖动、可缩放）
  - **⌘C / ⌘V 分叉对话**：复制文件夹后粘贴即生成分支，**分支继承原文件夹图标**（并记录 `forkedFrom`）
  - 右键菜单：打开 / 复制 / 粘贴分叉 / **修改图标**（17 款可选）/ 重命名 / 删除
  - 每个对话在首次出现时**随机绑定一款文件夹图标**，之后固定不变
- 🔄 多轮对话、重新生成、复制消息
- 💾 会话历史自动保存在本机（`~/Library/Application Support/PerPer/conversations.json`；首次启动会自动从旧版「牛来」目录迁移设置/会话/自定义模型）
- ⚙️ 设置面板：API Key、接口地址、模型、推理开关、Temperature、系统提示词
- 🌙 跟随系统深色/浅色模式

## 🚀 使用

### 方式一：直接运行打包好的应用

```bash
open dist/PerPer.app
```

> 若首次打开提示「无法验证开发者」，在「系统设置 → 隐私与安全性」中点击「仍要打开」，或执行：
> ```bash
> xattr -dr com.apple.quarantine dist/PerPer.app
> ```

### 方式二：从源码构建

```bash
# 1. 安装依赖（首次需下载 Electron，约 100MB）
npm install

# 2. 构建 .app（生成图标 → 打包 → 签名）
bash build.sh
```

### 方式三：开发模式运行

```bash
npm start
```

## ⚙️ 连接配置（设置面板）

| 配置项 | 默认值 |
| --- | --- |
| API Key | DeepSeek 官方 Key（`sk-…`） |
| 接口地址 | `https://api.deepseek.com/v1` |
| 模型 | `deepseek-flash`（DeepSeek flash v4.1）或 `deepseek-v4-pro` |
| 深度推理 | 开启 |

接口完全兼容 OpenAI Chat Completions 协议，也可改成任意 OpenAI 兼容网关（如 DeepSeek、智谱、本地 Ollama 等）。

请求示例（等价于应用内发送的请求）：

```bash
curl https://api.deepseek.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-你的KEY" \
  -d '{
    "model": "deepseek-flash",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true,
    "reasoning": {"enabled": true}
  }'
```

## 📁 项目结构

```
PerPer/
├── main.js                 # Electron 主进程：窗口、菜单、设置/会话持久化 IPC
├── preload.js              # 安全桥接 (contextBridge)
├── renderer/
│   ├── index.html          # 界面骨架
│   ├── css/style.css       # DeepSeek 风格样式（含深色模式）
│   └── js/
│       ├── app.js          # 对话逻辑：发送/流式/停止/重新生成/设置
│       ├── api.js          # OpenAI 兼容 SSE 流式客户端
│       └── markdown.js     # 轻量 Markdown 渲染器（已转义，防 XSS）
├── src/
│   └── avatar-src.js         # 3D 形象模块源码（three.js + three-vrm），esbuild 打包成 avatar.bundle.js
├── renderer/assets/
│   ├── logo.png              # 抠白底后的应用 logo（界面头像/欢迎页）
│   ├── avatars/              # VRM 人物模型（3 个）
│   └── folder-icons/         # 文件夹视图图标（17 款 PNG + manifest.json）
├── python-libs/              # Edge TTS 依赖库（随应用打包，用系统 python3 + PYTHONPATH 运行）
├── .venv/                    # 开发用虚拟环境（生成 python-libs 的来源，不随应用打包）
├── tools/
│   ├── gen-icon.py           # 用 PIL 生成应用图标（build/perper.jpeg → 圆角+缩小 → iconset）
│   ├── package.js            # electron-packager 打包脚本（含 .venv 额外资源）
│   ├── mock-server.js        # 本地 Mock SSE 服务器（离线自测流式管线）
│   ├── make-python-libs.sh   # 生成 python-libs（edge-tts 依赖库）
│   └── smoke-test.js          # 接口冒烟测试
├── build.sh                  # 一键构建：图标 → 打包 → 签名
└── dist/PerPer.app             # 构建产物
```

## 🧩 技能（Skills）说明

**主文件识别（宽容）**：技能目录里的主文件可以是 `SKILL.md`、`SKILL.md（任意说明）.md`、任意 `SKILL*.md`，或目录内唯一的 `.md` —— 中文文件名也不会漏

**安装**：设置 → 技能 → 「＋ 安装技能…」，支持
- 文件夹（里面需有 `SKILL.md` 或任一 `.md`）
- 单个 `.md` / `SKILL.md` 文件
- `.zip` 压缩包（用系统 `unzip` 解压，自动寻找其中的 `SKILL.md`）

**SKILL.md 格式**（YAML frontmatter 可选）：
```markdown
---
name: 代码审查
description: 按团队规范审查代码，指出安全与性能问题
---
技能的具体指令正文……
```

**技能资源**：技能目录里的其它 `.md`/`.txt`/`.json` 等文件会作为「可用资源」注入清单；体积较小时（≤14KB）会**直接读进上下文**，体积大时模型可用 `read_skill_file` 工具按需读取（文件名不完全一致时自动模糊匹配）。

**开关与提示词**
| 技能状态 | 技能提示词 | 最终 system 消息 |
|---|---|---|
| 启用 | 已配置 | **技能提示词**（覆盖全局）+ 技能说明 |
| 启用 | 未配置 | 全局提示词（沿用）+ 技能说明 |
| 停用 | — | 仅全局提示词（技能完全不注入） |

## 🌐 联网搜索说明

- **为什么需要应用侧实现**：DeepSeek 的「联网搜索」只存在于它的网页版/App，官方 API 既不提供内置搜索，也不支持服务端搜索工具（实测 `plugins:[{id:'web'}]`、`web_search_options` 均被静默忽略）。好在 API **支持 function calling**，因此由应用代替模型去搜索。
- **工作方式**：模型需要实时信息时返回 `tool_calls` → 应用在主进程请求 DuckDuckGo 并解析结果 → 作为 `tool` 消息回传 → 模型基于资料作答（可多轮，默认最多 3 轮）。
- **多引擎搜索**：中文查询**优先百度**（对国内社区内容覆盖好），不足时自动换 DuckDuckGo、Bing 补齐；英文查询以 DuckDuckGo 优先。结果合并去重，界面会显示实际用了哪些引擎。
- **读页兜底**：直连被反爬拦截（如贴吧 403）时自动尝试文本代理；都失败会明确告知模型「改用搜索摘要作答」，避免它反复重试同一个打不开的链接。
- **DSML 兼容**：DeepSeek 有时会把工具调用写成内部标记语言（DSML）混在正文里，而不是标准 `tool_calls`。PerPer 会自动识别并解析成真实调用执行，同时把这些标记从回答里剥离（不会显示给你）；轮次用尽时会明确要求模型改用纯文本作答。
- **注意**：DuckDuckGo 为公开网页接口，解析规则可能随其改版失效；如需更稳定的结果，可换成 Tavily/Brave 等搜索 API（改 `main.js` 里的 `webSearch()` 即可）。

## 🧍 虚拟形象与语音播报

- **开关**：右上角「👤」切换形象面板；「🔊」切换自动播报；鼠标移到人物上会跟随视线，点一下会微笑
- **播报引擎**（设置面板）：
  - `Edge 神经语音`（默认）：微软神经网络语音，需联网，音质接近真人；支持中英混读
    - 晓晓（中文女声，温暖）· 晓伊（中文女声，活泼）· Ava / Emma（**中英双语女声**）
  - `系统语音`：macOS 内置语音，离线可用（语速可调）
- **口型同步**：播报时按真实音频时长驱动 VRM 的五个元音口型，并配合点头、轻微摆动与抬手小手势
- **姿态**：默认自然站姿（手臂下垂、肘部微曲、**左右完全对称**），加载时自动校准上臂方向与前臂弯曲方向（各模型骨骼朝向不同）
- **形象背景**：`火星姐` 专属 —— `bg/` 里的 3 张照片作为人物背后的背景（**每次打开随机一张**），切换到其他模型时自动不显示。图片放在 `renderer/assets/bg/bg-1..3.jpg`，想换图直接替换（保持文件名即可）
- **拖动旋转**：在人物上**左右拖动**即可水平旋转（±100°），双击复位正面；旋转时视线锁定不会乱甩，拖动不会误触表情
- **取景**：三分之四身（头部到裙摆 + 部分腿部），按模型包围盒与面板宽高比**自动计算相机距离**，换模型不用手动调；想更近/更远可改 `src/avatar-src.js` 里的 `frameH`（画幅高度比例，默认 0.73）与 `targetY`（中心位置，默认 0.665）
- **柔和面光**：正面主面光 + 面部补光 + 背后轮廓光（强度经实测标定：面部亮度提升约 20%，无过曝）
- **口型速度**：设置里的「口型速度」滑杆（很慢/慢/正常/较快/快），默认偏慢更自然；速度决定每个口型覆盖的字数与过渡平滑度

### 文件夹图标
- 内置 17 款文件夹图标（`renderer/assets/folder-icons/`，由 `icns/` 目录的 `.icns` 转换而来）
- 随机分配：新建对话或首次加载旧对话时随机绑定一款，之后固定；右键「修改图标…」可随时更换
- **注意**：图标素材作者标注「禁止商用」，仅供个人使用；若需商用请替换为自己的图标

### 切换人物模型
- **设置 → 人物模型**：下拉选择已导入的模型，立即切换（自动读取模型名、表情与口型名）
- **打开文件…**：从磁盘任意位置选择 `.vrm`，会复制到用户模型目录（`~/Library/Application Support/PerPer/avatars/`）并切换
- **打开模型目录**：把 `.vrm` 直接拖进去，再点「刷新列表」即可出现
- 内置 6 个模型（默认 **火星姐** `Martian.vrm`）：`Martian.vrm`（火星姐 · VRM 1.0）、`1620000625477528222`、`4961976968586841476`（林兰·希卡西）、`7062840423830520603`、`7779676433471406195`、`9140463356671483103`（Red）
- 显示名可在 `renderer/js/app.js` 的 `AVATAR_NAMES` 里覆盖（如 `'Martian.vrm': '火星姐'`）
- 兼容性：VRM 0.x 的 `a/i/u/e/o` 表情会自动映射为标准五元音；手臂静止姿态会在加载时**自动校准**（自动试出「手在肩下且贴身」的旋转方向）
- 关闭人物：设置里的「显示 3D 人物」取消勾选，或点顶栏 👤 按钮

### 口型同步说明
播报时按 Edge 返回的**词边界时间轴**驱动口型：每个音节一张一合、标点/句间闭口；切换模型时若模型缺少口型表情会给出提示。

## 🔒 安全提示

- API Key 仅保存在本机，不会上传到任何服务器
- 你在对话中贴出过 API Key，建议在 OpenRouter 后台**轮换/重置**一次该 Key
- Markdown 渲染做了 HTML 转义，模型输出不会执行脚本

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Enter` | 发送（`Shift+Enter` 换行） |
| `⌘N` | 新建对话 |
| `⌘,` | 打开设置 |
| `⌘.` | 停止生成 |

## 📦 打包与默认状态（v4.3.0）

打包产物自带以下默认配置（除 API Key 外均为开箱即用）：

| 项目 | 默认值 |
|---|---|
| API Key | **留空**（首次启动自行填写，打包不携带个人 Key） |
| 对话模型 | `deepseek-flash`（`https://api.deepseek.com/v1`） |
| **人物形象** | **火星姐（`Martian.vrm`）**，形象面板开启、自动播报开启 |
| **技能** | **内置 `skill_hcy`（hcy-fan-insider）首次启动自动安装**，默认启用并写入 1712 字 system prompt |
| 形象背景 | 火星姐专属，每次启动随机一张（`renderer/assets/bg/`） |
| 联网搜索 | 开启（多引擎），最多 3 轮 |
| 视图模式 | 侧边列表（⌘2 可切文件夹视图） |
| 全局 system prompt | 空（技能提示词会覆盖它） |

**内置技能的分发方式**：`skill_hcy/` 通过 electron-packager 的 `extraResource` 放到 `PerPer.app/Contents/Resources/skill_hcy/`（同时从 asar 中排除，避免重复）；应用首次启动时把它复制到 `~/Library/Application Support/PerPer/skills/`，并把 `default-prompt.txt` 写入该技能的 system prompt。用 `seededSkills` 记录已播种，用户手动删除后不会自动装回。

## ⚖️ 第三方资源与授权（协作/分发前必读）

| 资源 | 位置 | 授权情况 |
|---|---|---|
| 文件夹图标（17 个） | `icns/`、`renderer/assets/folder-icons/` | 作者 **呆小东**，标注**禁止商用**，仅供个人使用 |
| 人物模型（6 个 VRM） | `renderer/assets/avatars/` | 各模型作者保留权利，商用前需逐个确认授权 |
| 头像背景图（3 张） | `bg/`、`renderer/assets/bg/` | 项目所有者自有素材 |
| Edge TTS（Python 依赖） | `python-libs/`（未入库，`build.sh` 自动生成） | MIT / 各包各自许可 |

> 本仓库含上述第三方素材，**请保持私有**，不要公开分发或商用，除非已取得对应授权。

## 🤝 协作开发

```bash
git clone https://github.com/<你的用户名>/perperAI.git
cd perperAI
npm install                 # 安装依赖
bash build.sh               # 生成图标 → 打包 .app（首次会自动准备 python-libs）
open dist/PerPer-darwin-arm64/PerPer.app
```

- **不要提交**：`dist/`、`node_modules/`、`.venv/`、`python-libs/`、`models/`、`settings.json`（已全部加入 `.gitignore`）
- **API Key 绝不入库**：代码里默认留空，本地填在应用设置里；测试脚本从环境变量 `PERPER_KEY` 读取
- 版本号同时维护在 `package.json`、`tools/package.js`、`renderer/index.html` 三处
