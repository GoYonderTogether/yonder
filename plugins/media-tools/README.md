# media-tools

原生 SDK 媒体工具，协议为 SiliconFlow。注册 `media-tools_image_generate`（network/write）、`media-tools_audio_transcribe`（read/network），由配置档显式选择。

参数：非空 `prompt`，可选 `model`（仅当前 image 端点声明值）、`image_size`。默认首个配置模型与 `1024x1024`；尺寸支持 Kolors 官方推荐的 `1024x1024`、`960x1280`、`768x1024`、`720x1440`、`720x1280`。

服务通过 `api.services.resolve('image')` 读取，`protocol: siliconflow`，`baseUrl: https://api.siliconflow.cn/v1`；密钥由已有 credential 引用解析，插件不另存凭据。当前验收只使用官方控制台已确认免费的 `Kwai-Kolors/Kolors`，免费额度及价格可能改变，由配置负责人确认；插件不自动切换模型或价格。

调用返回一张图片后立即下载到当前执行环境的 `artifacts/image-<UUID>.<ext>`，输出真实附件 URI、MIME、字节数。下载不携带 API 鉴权；目录经真实路径核实位于工作区内。不接受覆写路径，不修改默认水印，不自动重试。沿用本轮 ctx.signal 和运行预算，不加独立超时；API JSON 上限 1 MiB，下载上限 20 MiB。

ASR 参数为非空 `file` 和可选 `model`，通过 `services.resolve('asr')` 取声明模型，未指定取首项；当前免费验收型号为 `FunAudioLLM/SenseVoiceSmall`。文件必须是执行环境路径或 file URI；无 exec 时只允许 cwd 内真实路径或本轮来源明确附件，拒绝符号链接逃出工作区。经 ctx.env 有界读取，50 MB 平台上限，multipart file+model 调用 `/audio/transcriptions`，返回真实识别文本；一小时平台时长上限由服务执行，不引入音频解码依赖。

失败返回配置诊断、本地明确原因或阶段/HTTP 状态；不会输出供应商错误正文、签名下载 URL、凭据或请求对象。TTS收费（当前 CosyVoice2 ¥0.05/千 UTF-8 字符）且未获付费调用授权；TTS/视频不在工具范围；普通图片附件结果不等于渠道客户端已验收。

聚焦契约检查包含 SDK `checkPlugin`：仓库根运行 `node plugins/media-tools/check.mjs`；构建：`npx tsc -b plugins/media-tools`。真实生成由获准凭据单独验证，无凭据检查不冒充生成通过。

## 接入配置

在目标home已有配置中追加插件和服务，不替换其他项；该配置需要重启，沿正常安装/更新流程生效。凭据名siliconflow指向该home凭据存储中的api_key，真实密钥不写入此配置或仓库。

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
```

目标Agent/profile的plugins选择media-tools，tools.offer或search选实际注册名，并具备所需能力；安装插件本身不等于对所有Agent放行。未配置TTS/视频，工具不会切换到付费能力。
