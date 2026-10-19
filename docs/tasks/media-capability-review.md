# 媒体能力只读核实与最小插件建议

日期：2026-10-19。状态：方案待审核；未实现、未调用生成服务、未改正式配置。

## 结论

缺口是原生媒体工具插件和真实服务配置，不是一般编程/GitHub 指导 skill，也不是缺少另一套模型 provider 系统。建议一个 `media-tools` 插件（候选名 `media-generation`），由模型直接选用图片生成、ASR、TTS、视频生成工具。服务选择、凭据读取、工具授权、文件和附件投递均已有基础；首版使用每种能力的第一个已配置端点，不需要改内核或 SDK。

## 已核实事实

- `docs/spec/07-runtime.md` §6.1：`models.providers` 是 pi 对话模型配置；`packages/core/src/runtime/models.ts` 的协议实现表接入对话流。SDK `Models` 只是从 pi-ai 导出的类型，不是图片/音频/视频生成接口。视觉输入能力不能推出图像生成能力，更不能推出 ASR、TTS、视频能力。
- §6.3 与 `packages/core/src/runtime/index.ts` `resolveService`：`api.services.resolve(capability)` 按配置顺序返回首个端点，包含 `id/protocol/baseUrl/models/voices/apiKey`。`capabilities` 的键是字符串，因此 `image`、`asr`、`tts`、`video` 不需要新增配置结构。`packages/core/src/config/schema.ts` 已支持此结构。
- 服务密钥只取 `credential` 指向的 `api_key`；OAuth 凭据不会变成 `apiKey`。ChatGPT 订阅 OAuth 的对话登录不能据此宣称拥有生成 API 权限。`api.credentials.get` 不是订阅转 API 方案，也不应复制其他程序 OAuth 凭据。
- 现有 `plugins/` 八个插件没有媒体生成工具；Web/浏览器/编码工具不是该缺口的原生接口。
- 正式 home `/Users/zoran/.local/share/yonder-harness/home/yonder.yaml` 经结构化白名单读取：自定义 `models.providers` 为零，`services` 为零。此结论不代表没有内置对话模型或其他凭据；未读取/打印密钥。没有真实媒体服务端点可验证。
- `packages/sdk/src/types.ts` 已有 `ToolResult.attachments/images` 和 `Attachment` 的 image/audio/video/file 类型；runtime `toResult` 保留工具附件，运行结算收集当前工具任务产物，已有投递链路可复用。
- 飞书 `plugins/channel-feishu/src/channel.ts` 已支持图片、Ogg/Opus 音频、MP4 视频上传。普通 MP3/WAV 不能伪标成可播放音频；可作为普通文件交付，若要求直接语音播放则需真实编码转换能力并验证。视频实际播放仍不可从源码推出。

## 推荐范围

一个插件，直接 HTTP 调用，复用 SDK；不经 shell/外部 CLI，不增加通用 provider 注册系统，不添加指导型 skill。

| 工具候选名 | 能力配置 | 最小行为 |
|---|---|---|
| `image_generate` | `services.resolve('image')` | 提示词、可选该端点声明的 model；保存图片，返回附件与简短结果 |
| `audio_transcribe` | `services.resolve('asr')` | 读取已授权输入文件，返回识别文本；不自动改对话或记忆 |
| `audio_speak` | `services.resolve('tts')` | 文本、声明过的 model/voice；保存音频，返回附件 |
| `video_generate` | `services.resolve('video')` | 创建真实视频作业，返回作业 id/状态；不阻塞模型运行等待长视频 |
| `video_get` | 同一 video 端点 | 模型显式查询作业，完成时下载并返回视频附件 |

以上是建议工具基名；最终注册名沿用既有插件命名规则。不存在能力配置时直接返回“未配置该服务”；不能把聊天模型目录当服务目录自动尝试。model/voice 只能选当前端点声明值；具体尺寸、格式、时长等参数按首个真实 API 的契约确定，不承诺所有服务或模型支持相同参数。

配置来源：端点/模型/voice 只来自 `yonder.yaml.services`，密钥继续经现有 credential 引用解析；插件配置只容纳确有必要且现有服务结构表达不了的选项。产物通过 `ctx.env` 读写到当前工作区，返回真实 URI、MIME、名称；沿用工具附件回传来源渠道，需要主动投递时才由模型选择既有 `message_send`。不直接绕过会话发送，不把远端临时下载 URL 当永久产物。读取、生成文件、联网分别声明 read/write/network 能力；沿用同一安全级别检查与 `ctx.signal`。

最小首版按协议实现实际所需请求；先支持一套有真实端点的协议，不按厂商做注册框架。`openai-compatible` 只是一条配置字符串，不能保证兼容端点实现图片/音频/视频全部接口；必须逐能力验证。长视频作业状态可保留插件本地数据，使用现有插件 `api.paths.data`；不引入内核后台工作流。

## 是否需要新接口批准

当前“每种能力使用一个默认服务”的目标：**无 SDK/内核缺口**，`services.resolve` 已够。需要批准的是插件行为、工具参数和真实服务配置/凭据授权，以及相应实施任务路径。

只有明确要求“模型同时列出/选取同一能力的多个服务”时，现有接口才有真实缺口：没有 `list`，也不能按 service id resolve。届时评审一个最小可选 id 查询或列表接口；本轮不提前加。若真实协议需要额外 HTTP headers、区域/项目标识、OAuth 刷新或特殊授权，也须依据实际端点另审最小契约；现有 `ServiceEndpoint` 不提供这些能力。不能为了想象中的供应商差异提前修改冻结规范。

## 主源与验证界限

已核对官方 API 文档，确认媒体是独立调用契约：[图片生成](https://developers.openai.com/api/reference/resources/images/methods/generate)、[ASR](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)、[TTS](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)、[视频创建](https://developers.openai.com/api/reference/resources/videos/methods/create)。这些是协议实现参考，不是选定 OpenAI 或当前账号获权的证据。

未测：真实图片/ASR/TTS/视频生成、费用、模型可用性、任何服务凭据、生成产物跨渠道播放。本轮仅源码和配置元数据核实，没有收费调用、联网授权、安装或正式配置变更。

待决定：是否采用 `media-tools` 名称；批准最小工具范围；由用户选定或授权接入首个真实端点后，才能把协议和参数收敛为实现任务并做真实验收。
