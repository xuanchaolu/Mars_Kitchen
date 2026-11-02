# 中文语音指令与连续对话

本版本使用跨平台录音和云端语音识别 API，复用项目现有的 AI 对话、人设、口味参数与回答朗读。每位用户填写自己的语音 API Key，不共用开发者密钥。

## 免费识别的默认配置

在 [硅基流动控制台](https://cloud.siliconflow.cn/)注册并创建自己的 API Key，在应用「设置 → 中文语音识别」中填写并保存：

| 设置 | 内容 |
| --- | --- |
| 语音 API Key | 用户自己的硅基流动 Key |
| 接口地址 | `https://api.siliconflow.cn/v1/audio/transcriptions` |
| 模型 | `FunAudioLLM/SenseVoiceSmall` |

截至 2026-11-02，SenseVoiceSmall 在[官方价格页](https://www.siliconflow.cn/pricing)标为免费；账号资格、额度和限流以服务商控制台为准，不承诺永久免费或无限调用。[官方转写接口文档](https://docs.siliconflow.cn/docs/api/audio-transcriptions-post)。语音识别免费不代表 AI 回答免费：上方对话 API 仍按原服务计费，不能把 DeepSeek 的 Key 当作硅基流动 Key。

可以改用其他兼容接口：发送 `multipart/form-data` 的 `file` 和 `model` 两项，以 Bearer Key 鉴权，接收 JSON `text` 字段。接口须用 HTTPS；仅本机调试允许 localhost HTTP。

## 使用

1. 在设置中保存可用的对话 API 配置，以及独立的语音 API Key。
2. 点击输入框右侧的麦克风，允许操作系统的麦克风权限。
3. 说「番茄炒蛋怎么做？少放盐，不放辣椒」。停顿约 1.8 秒后自动结束本句，发送录音到设置中的服务，识别文字后发送给 AI；也可再次点击麦克风手动结束本句。
4. 点击「连续语音对话」后，会在回答朗读完成约 0.65 秒后继续聆听。朗读时关闭麦克风，避免把自己的声音当作新指令。
5. 说「下一步怎么做」「换成不辣的做法」会带着聊天上下文交给 AI。说「再说一遍」「重复一遍」「重播上一条」重播上一条回答；说「结束对话」「停止对话」「退出语音」「停止语音对话」结束连续模式。

按 Esc 可取消识别和后续自动聆听。识别上传阶段再次点击麦克风也会取消。切换聊天、新建聊天、打开设置、手动输入或切换文件夹视图会结束语音会话，避免旧结果发到其他聊天。输入框已有文字或附件时会提示先处理草稿。

这是一句一句轮流交流的模式；不包含唤醒词、边听边用声音打断、控制真实厨具或自动修改全局口味设置。「少放盐」等要求作为本轮聊天内容交给 AI。

## 隐私、权限与失败处理

- 点击麦克风即开始本句录音；录音结束后发送到用户配置的语音服务，默认为 `api.siliconflow.cn`。设置页和录音状态会显示录音用途及去向。
- 应用不保存原始录音文件。音频在内存中编码为 16kHz 单声道 WAV；识别后发送的文字与 AI 回答沿用原有聊天记录存储规则。服务商侧的音频处理遵循其政策。
- Key 沿用项目现有的本机设置保存机制，不内置个人 Key，也不写进源码、测试日志或分发包。不要把本机设置文件上传仓库。
- 每句最长约 45 秒；约 12 秒未检测到声音则结束，不发起识别请求。识别/对话错误、限流或播报失败会暂停连续模式，不自动反复请求。
- 录音结束基于音量与静音时间的简单检测；嘈杂厨房、远距离或很轻的声音可能影响分句。可点击麦克风手动结束本句。
- Mac：在「系统设置 → 隐私与安全性 → 麦克风」允许火星小厨房后重启。无需 macOS「语音识别」权限或 Swift 编译工具。
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

仓库新增 `.github/workflows/build-desktop.yml`：上传源码后，在 GitHub Actions 手动运行 **Build desktop apps**，会分别在 Windows、Mac、Linux runner 上执行单元测试和打包，下载各自的构建产物即可。该流程在本次交付中尚未在 GitHub 实际运行，也没有向仓库推送代码。

Mac 原有 `npm run build` 仍可生成并本地签名应用。交付的 Mac 应用仅为 Apple Silicon 版本，采用本地 ad-hoc 签名，未做开发者公证。

## 修改位置与验证边界

- `renderer/js/audio-recorder.js`：跨平台收音、静音检测、重采样、WAV 编码和麦克风释放。
- `renderer/js/cloud-voice.js`：录音与接口适配，隔离取消后的结果。
- `lib/speech-service.js`：主进程读取用户语音设置、构造鉴权和 multipart 请求、处理超时及限流。
- `renderer/js/voice-input.js` 与 `app.js`：连续对话、语音口令、状态显示、聊天发送和朗读衔接。
- `speech.js`：修复语音回退时提前结束、异步取消后继续播报等会影响连续对话的问题。

验证已通过：新增 34 项语音自动测试、原有 40 项单元测试、JS 语法检查、本机模拟 HTTP 转写的实际 multipart 往返。测试只使用合成音频与测试 Key，没有上传真实录音。

尚未验证：真实硅基流动账号请求、真实麦克风识别率、实际扬声器播放、Windows/Linux 实机、GitHub Actions 构建。当前执行环境启动 Electron 会中止（退出码 134），界面控制工具连接失败，因此桌面端到端和视觉验收未完成。代码与打包成功不等于所有系统都已实测可用。
