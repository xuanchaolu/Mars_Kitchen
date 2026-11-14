# 中文语音指令与连续对话

应用使用跨平台录音，识别有两种引擎：**Mac 系统识别**（macOS 默认，本机完成、无需任何账户和 Key）与**云端接口**（可选，用户填写自己的语音 API Key）。识别后复用项目的 AI 对话、人设、口味参数与回答朗读。

## Mac 系统识别（macOS 默认）

应用随包附带系统识别组件（`Resources/macos-speech`），调用 macOS 自带的 SFSpeechRecognizer，优先在本机离线完成，不上传录音。用户无需注册任何服务。

前提条件（一次性）：

1. 系统设置 → 键盘 → **听写**：开启（听写语言需包含中文普通话）。未开启时应用会提示「Siri and Dictation are disabled」。
2. 首次点击麦克风时，系统会请求**麦克风**与**语音识别**两项权限，均点允许。若误点拒绝，在系统设置 → 隐私与安全性中手动允许后重启应用。

在「设置 → 中文语音识别 → 识别引擎」中可在系统识别与云端接口之间切换。非 macOS 平台只显示云端接口选项。

## 云端接口（可选）

在 [硅基流动控制台](https://cloud.siliconflow.cn/)注册并创建自己的 API Key，在应用「设置 → 中文语音识别」中选择云端接口并填写保存：

| 设置 | 内容 |
| --- | --- |
| 语音 API Key | 用户自己的硅基流动 Key |
| 接口地址 | `https://api.siliconflow.cn/v1/audio/transcriptions` |
| 模型 | `FunAudioLLM/SenseVoiceSmall` |

截至 2026-11-02，SenseVoiceSmall 在[官方价格页](https://www.siliconflow.cn/pricing)标为免费；账号资格、额度和限流以服务商控制台为准，不承诺永久免费或无限调用。[官方转写接口文档](https://docs.siliconflow.cn/docs/api/audio-transcriptions-post)。语音识别免费不代表 AI 回答免费：上方对话 API 仍按原服务计费，不能把 DeepSeek 的 Key 当作硅基流动 Key。

可以改用其他兼容接口：发送 `multipart/form-data` 的 `file` 和 `model` 两项，以 Bearer Key 鉴权，接收 JSON `text` 字段。接口须用 HTTPS；仅本机调试允许 localhost HTTP。

## 使用

1. 在设置中保存可用的对话 API 配置；使用云端识别引擎时还需填写独立的语音 API Key（系统识别引擎无需 Key）。
2. 点击输入框右侧的麦克风，允许操作系统的麦克风权限。
3. 说「番茄炒蛋怎么做？少放盐，不放辣椒」。停顿约 1.8 秒后自动结束本句，发送录音到设置中的服务，识别文字后发送给 AI；也可再次点击麦克风手动结束本句。
4. 点击「连续语音对话」后，会在回答朗读完成约 0.65 秒后继续聆听。朗读时关闭麦克风，避免把自己的声音当作新指令。
5. 说「下一步怎么做」「换成不辣的做法」会带着聊天上下文交给 AI。说「再说一遍」「重复一遍」「重播上一条」重播上一条回答；说「结束对话」「停止对话」「退出语音」「停止语音对话」结束连续模式。

按 Esc 可取消识别和后续自动聆听。识别上传阶段再次点击麦克风也会取消。切换聊天、新建聊天、打开设置、手动输入或切换文件夹视图会结束语音会话，避免旧结果发到其他聊天。输入框已有文字或附件时会提示先处理草稿。

这是一句一句轮流交流的模式；不包含唤醒词、边听边用声音打断、控制真实厨具或自动修改全局口味设置。「少放盐」等要求作为本轮聊天内容交给 AI。

## 隐私、权限与失败处理

- 点击麦克风即开始本句录音。系统识别引擎在本机完成转写，不上传录音；云端引擎将录音发送到用户配置的服务（默认 `api.siliconflow.cn`）。设置页和录音状态会显示录音用途及去向。
- 应用不保存原始录音文件。音频在内存中编码为 16kHz 单声道 WAV；识别后发送的文字与 AI 回答沿用原有聊天记录存储规则。服务商侧的音频处理遵循其政策。
- Key 沿用项目现有的本机设置保存机制，不内置个人 Key，也不写进源码、测试日志或分发包。不要把本机设置文件上传仓库。
- 每句最长约 45 秒；约 12 秒未检测到声音则结束，不发起识别请求。识别/对话错误、限流或播报失败会暂停连续模式，不自动反复请求。
- 录音结束基于音量与静音时间的简单检测；嘈杂厨房、远距离或很轻的声音可能影响分句。可点击麦克风手动结束本句。
- Mac：系统识别引擎需要「系统设置 → 隐私与安全性 → 麦克风」与「语音识别」两项权限均允许火星小厨房；点击麦克风时应用会先完成这两项授权再开始录音。若误点拒绝，手动允许后重启应用。云端引擎只需麦克风权限。
- Windows：在系统隐私设置中允许桌面应用访问麦克风。Linux：检查音频输入设备及桌面权限。
- 朗读复用原有 Edge / 系统语音。Edge 不可用时回退系统语音；目标系统需要可用的中文语音和声音输出设备。Windows/Linux 若未安装 Edge 所需的 Python 环境，可在设置里选择「系统语音」。

## 开发与各平台分发

需要 Node.js 22 和项目支持的桌面操作系统。

```sh
npm ci
npm start
npm test
npm run test:voice
```

在各自系统上生成便携应用目录：

```sh
npm run package
```

也可显式指定目标：

```sh
npm run package -- darwin arm64
npm run package -- darwin x64
npm run package -- win32 x64
npm run package -- linux x64
```

建议在目标系统上打包。Windows 元数据处理在其他系统交叉打包时可能需要 Wine；macOS 签名及公证需在 Mac 上配置。Windows 和 Linux 的便携包不是已签名安装器。

`npm run build` 在 Mac 上生成并本地签名应用。Release 中的 Mac 应用为 Apple Silicon 版本，采用本地 ad-hoc 签名，未做开发者公证；首次打开需在「系统设置 → 隐私与安全性」中允许。

## 代码位置与验证状态

- `renderer/js/audio-recorder.js`：跨平台收音、静音检测、重采样、WAV 编码和麦克风释放。
- `renderer/js/cloud-voice.js`：录音与接口适配，隔离取消后的结果。
- `lib/speech-service.js`：主进程识别引擎分发——系统引擎先预授权（`--prepare`）再写入临时 WAV 调用随包组件，云端引擎构造鉴权和 multipart 请求；处理超时、限流与取消。
- `native/macos-speech.m`：macOS 系统识别组件源码（SFSpeechRecognizer，优先离线），编译产物随包分发到 `Contents/Resources/macos-speech`；重新编译：`clang -fobjc-arc -O2 -mmacosx-version-min=12.0 -framework Speech -framework Foundation -Wl,-sectcreate,__TEXT,__info_plist,native/Info.plist native/macos-speech.m -o native/macos-speech`。
- `renderer/js/voice-input.js` 与 `app.js`：连续对话、语音口令、状态显示、聊天发送、朗读衔接与识别引擎切换。
- `renderer/js/speech.js`：播报与引擎回退控制，保证回退、取消时正确结束播报，配合连续对话的轮流节奏。

自动测试：40 项单元测试（`npm test`）+ 37 项语音测试（`npm run test:voice`）+ 45 项端到端（`npm run test:e2e`），含本机模拟 HTTP 转写的实际 multipart 往返。测试只使用合成音频与测试 Key，不上传真实录音。

已在 macOS 实机验证：系统识别组件离线转写中文、点击麦克风预授权、Edge 神经语音播报、打包应用双击启动。尚未验证：真实硅基流动账号请求、Windows/Linux 实机。
