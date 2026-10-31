# media-tools

原生 SDK 媒体工具，协议为 SiliconFlow（图片、ASR）与阿里百炼（TTS）。注册 `media-tools_image_generate`（network/write）、`media-tools_audio_transcribe`（read/network）、`media-tools_audio_speak`（network/write），由配置档显式选择。

参数：非空 `prompt`，可选 `model`（仅当前 image 端点声明值）、`image_size`。默认首个配置模型与 `1024x1024`；尺寸支持 Kolors 官方推荐的 `1024x1024`、`960x1280`、`768x1024`、`720x1440`、`720x1280`。

服务通过 `api.services.resolve('image')` 读取，`protocol: siliconflow`，`baseUrl: https://api.siliconflow.cn/v1`；密钥由已有 credential 引用解析，插件不另存凭据。当前验收只使用官方控制台已确认免费的 `Kwai-Kolors/Kolors`，免费额度及价格可能改变，由配置负责人确认；插件不自动切换模型或价格。

调用返回一张图片后立即下载到当前执行环境的 `artifacts/image-<UUID>.<ext>`，输出真实附件 URI、MIME、字节数。下载不携带 API 鉴权；目录经真实路径核实位于工作区内。不接受覆写路径，不修改默认水印，不自动重试。沿用 ctx.signal 和运行预算，不加独立超时；API JSON 上限 1 MiB，下载上限 20 MiB。

ASR 参数为非空 `file` 和可选 `model`，通过 `services.resolve('asr')` 取声明模型，未指定取首项；当前免费验收型号为 `FunAudioLLM/SenseVoiceSmall`。文件必须是执行环境路径或 file URI；无 exec 时只允许 cwd 内真实路径或本轮来源明确附件，拒绝符号链接逃出工作区。经 ctx.env 有界读取，50 MB 平台上限，multipart file+model 调用 `/audio/transcriptions`，返回真实识别文本；一小时平台时长上限由服务执行，不引入音频解码依赖。

TTS 参数为非空 `text`（上限 2000 字符）、可选 `model`、`voice`、`speed`（0.5–2），通过 `services.resolve('tts')` 取声明模型与音色，未指定各取首项。该端点必须是 `protocol: dashscope`（阿里百炼）；其他协议在建立连接前就返回 `MEDIA_UNSUPPORTED_PROTOCOL`，不会退回 HTTP，避免同一条路径出现两种延迟与计费。请求走百炼 WebSocket 双工协议：连接 `wss://…/api-ws/v1/inference`，`run-task` 开任务，收到 `task-started` 后 `continue-task` 送文本、`finish-task` 收尾，音频以二进制帧到达。每帧响应里的 `task_id` 必须与本任务一致才接收；`task-failed`、120 秒超时、任务未启动都报明确错误，不当成空结果。收齐后按真实文件头（ID3/MPEG 帧同步、RIFF/WAVE、OggS）判定容器，存为 `artifacts/speech-<UUID>.<ext>`，返回 `kind: audio` 附件。**这是付费调用**：`cosyvoice-v3-flash` 按 1 元/万字符计费，费用由提供方结算，工具说明如实告知；不重试、不缓存，保存阶段失败可能发生在已计费合成之后，不得盲目重放。

失败返回配置诊断、本地明确原因或阶段/HTTP 状态；不会输出供应商错误正文、签名下载 URL、凭据或请求对象。视频不在工具范围；普通附件结果不等于渠道客户端已验收。

聚焦契约检查包含 SDK `checkPlugin`：仓库根运行 `node plugins/media-tools/check.mjs`；构建：`npx tsc -b plugins/media-tools`。真实生成/转写/合成由获准凭据单独验证，无凭据检查不冒充调用通过。

## 接入配置

在目标home已有配置中追加插件和服务，不替换其他项；该配置需要重启，沿正常安装/更新流程生效。凭据名指向该home凭据存储中的 api_key，真实密钥不写入此配置或仓库。

```yaml
plugins:
  - use: "@yonder/plugin-media-tools"
services:
  - id: siliconflow
    protocol: siliconflow
    baseUrl: https://api.siliconflow.cn/v1
    credential: siliconflow
    capabilities:
      image: { models: [Kwai-Kolors/Kolors] }
      asr: { models: [FunAudioLLM/SenseVoiceSmall] }
  - id: dashscope
    protocol: dashscope
    baseUrl: https://dashscope.aliyuncs.com/api-ws/v1/inference
    credential: dashscope
    capabilities:
      tts:
        models: [cosyvoice-v3-flash]
        voices: [longanhuan_v3, longjielidou_v3, longling_v3]
```

目标Agent/profile的plugins选择media-tools，tools.offer或search选实际注册名，并具备所需能力；安装插件本身不等于对所有Agent放行。未配置 `tts` 能力时 `media-tools_audio_speak` 返回 `MEDIA_TTS_SERVICE_NOT_CONFIGURED`，不会切换到其他服务。视频未接入。
