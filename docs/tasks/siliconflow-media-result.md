# SiliconFlow 媒体插件准备与结果

2026-10-19。产品实现已完成，功能冻结 c7edabf，免费 ASR 追加冻结 0d21649。本执行者未读凭据、未调用生成接口、未修改正式 home。真实API证据由主路可信子进程负责。

## 协议与费用证据

- 图片：[官方请求](https://api-docs.siliconflow.cn/docs/api/images-generations-post)，`POST /v1/images/generations`，JSON `model: Kwai-Kolors/Kolors`、`prompt`、`image_size`，响应 `images[].url`。不是 OpenAI 的 `data[]`/`size`，不能仅换 baseUrl 即认为兼容。
- ASR：[官方请求](https://docs.siliconflow.cn/docs/api/audio-transcriptions-post)，`POST /v1/audio/transcriptions`，multipart `file`+`model`；`FunAudioLLM/SenseVoiceSmall` 或 `TeleAI/TeleSpeechASR`，响应 `text`。
- TTS：[官方请求](https://docs.siliconflow.cn/docs/api/audio-speech-post)，`POST /v1/audio/speech`，JSON `input`+`model`+`voice`，返回音频二进制。内置音色需要模型前缀，如 `FunAudioLLM/CosyVoice2-0.5B:alex`；格式 mp3/opus/wav/pcm。不应将 spec 的裸 alex 示例直接发送。
- [官方更新公告](https://docs.siliconflow.cn/docs/release-notes/overview)明确图片/视频 URL 自 2025-01-20 起有效期 1 小时，产物必须及时下载到工作区。
- 同一公告明确 LTX-Video 自 2025-01-06 起收费 ¥0.14/视频；旧免费文章不是当前免费 API 证据。本次未找到可确认免费的托管视频 API，不实施/测试视频生成。
- 主路官方控制台已确认 Kolors 与 SenseVoiceSmall 免费；CosyVoice2 为 ¥0.05/千 UTF-8 字符，不配置、不调用。第三方声称免费不能替代当前官方价格。

## 成熟实现核对

固定本机源码：Hermes `66605471e9f0b0832abbefaf625ce08e948ca540`、OpenClaw `cafa09e50556e08c2a04a670f16ac815482c5489`。

- Hermes `tools/transcription_cloud.py::_transcribe_openai` 和 `tools/tts_tool_openai.py::_generate_openai_tts` 使用标准 OpenAI 音频端点及本地产物保存，可沿用协议/产物语义；其多供应商凭据链、分块/重试/本地后端不属于当前缺口。
- Hermes `tools/image_generation_tool.py` 主路径为 FAL，不是硅基请求；不复制 FAL 队列与 managed auth。
- OpenClaw `extensions/deepinfra/image-generation-provider.ts` 调用统一 OpenAI-compatible provider，但请求是 `n/size/response_format`，不能原样套用硅基 `image_size/images[]`。OpenAI provider还包含 Codex OAuth、Azure及大量型号分支，不适合整块迁移。
- 因此最小实现直接使用 Node 原生 fetch/FormData，适配既有 SDK services/ctx.env/attachments；不造 provider 框架、不迁移上游运行时、不新增 SDK。

## 待实施与验收

首版：已证实免费的 Kolors 图片闭环，工具名 `media-tools_image_generate`，另追加 SenseVoiceSmall `media-tools_audio_transcribe`。模型只可选择 endpoint.models 声明值；协议显式 SiliconFlow；保存文件经 ctx.env，返回附件。保留取消、网络/write权限、白名单错误和下载大小边界。主路负责 workspace 注册、规范、凭据、安全注入及真实调用验收。

实际构建/契约结果见下文；免费真实调用及渠道产物投递仍分别记录。

## 首段实施结果（冻结 c7edabf）

已完成 `plugins/media-tools/`：manifest、SDK 图片工具、README、SOURCES 和可复跑 `check.mjs`。注册 `media-tools_image_generate`，参数仅 prompt/model?/image_size?；按 SiliconFlow 协议解析 services image 端点，模型只从其声明选择。保留平台默认水印，单次生成无重试；返回 URL 立即无鉴权下载，按真实 PNG/JPEG/WebP 文件头识别 MIME，经 ctx.env 保存当前工作区 artifacts/下 UUID 文件，返回本地附件。API JSON 1 MiB、图像20 MiB，沿用 ctx.signal 运行预算，贯穿取消；错误公开本地明确原因及阶段/HTTP，不打印响应正文或请求对象。真实路径核实拒绝 artifacts 指向工作区外；不接受调用方输出路径。

主路已在 Chrome 官方模型详情核实：2026-10-19 Kwai-Kolors/Kolors ¥0.000000/图片，L0 2 IPM/400 IPD。此价格证据由主路取得；本执行者未读取凭据或触发生成。

实际检查：

- `npx tsc -b plugins/media-tools`：通过。
- `node plugins/media-tools/check.mjs`：实际调用 SDK `checkPlugin` 返回空问题列表，9项图片/ASR参数、未配置、取消契约通过，不含模拟模型或生成请求。
- `npx biome check --write plugins/media-tools`：通过，4个代码/JSON文件格式化。
- 真实 NodeExecutionEnv 隔离临时目录实测：相同结构 Context 的 createDir、canonicalPath、二进制 writeFile/readBinaryFile 和已取消 writeFile 全通过；临时目录已清除。没有假执行环境替代该检查。

未测：真实API生成及免费扣费结果由主路可信凭据进程验证，插件进入真实模型会话、附件渠道客户端显示亦未在本执行者范围内验收。未运行全仓测试、未安装/发布、未修改 core/SDK/CLI 或共享接线、未提交 Git。ASR追加实施见下文；TTS与视频未实现。

## ASR 追加实施与审查修正（0d21649）

新增 `media-tools_audio_transcribe({file,model?})`，通过现有 services.resolve('asr') 和 SiliconFlow multipart file+model 协议调用。声明 read/network；模型只取端点声明，无 exec 时仅允许 cwd 内 canonical 实际路径或 ctx.events/ctx.event 明确附件；符号链接不能借工作区路径逃逸。通过 env.openBinaryReader/info/read 有界读取，50 MB上限，返回真实 text。一小时平台时长上限由服务执行，没有新增解码依赖。

按主路审查删除独立180秒超时，仅沿用ctx.signal；本地明确错误使用私有 MediaError 类型，在保证供应商异常正文不可见的同时保留 INVALID_IMAGE、ARTIFACT_OUTSIDE_WORKSPACE、AUDIO_OUTSIDE_WORKSPACE 等原因。README、SOURCES、manifest、check 一并更新。

最后检查：TypeScript build通过；SDK checkPlugin空问题；9项聚焦契约通过；biome通过。主路已回报真实图片API成功：PNG 763687字节、隔离cwd/artifacts真实保存，SHA256前缀a297ded8；此为主路证据，未在本执行者重复调用。

待主路：真实免费ASR、原生env实际文件边界/当前附件授权及真实模型工具选择。如无原始证据保留未测，不将手工契约检查当作真实ASR。

## 主路真实验证与共享接线

- 自动化库按硅基名称查找现有条目，通过agent-vault将API key仅注入受信任子进程；未从浏览器提取密钥，未复制OAuth，未在正式home写入服务或凭据。GET /v1/models实际HTTP200，列出Kolors、SenseVoiceSmall和CosyVoice2。模型存在不代表免费，价格另核对。
- Chrome真实模型详情：Kolors ¥0.000000/图片，L0 2IPM/400IPD；SenseVoiceSmall ¥0；CosyVoice2 ¥0.05/千UTF8字符。原始详情`/tmp/yonder-siliconflow-kolors-price.txt`、`/tmp/yonder-siliconflow-asr-price.txt`、`/tmp/yonder-siliconflow-tts-price.txt`。未查账单扣费，不把定价证据写成账单实证。测试Agent Window已停止，没有借用户页。
- 真实图片：插件execute→硅基生成→无鉴权下载→真实Native env落盘，PNG763687字节。提示词为橙色纸飞机/蓝天插画，实际已查看图片，平台默认AI生成水印保留。SHA256 a297ded8f9c8730ac400f18e93619eb12d8d7176e30a2bcda7b0f47e0cdfa7c3；产物位于`/private/var/folders/hg/8kf929p12wz498k8q4r74kg00000gn/T/yonder-siliconflow-live-VcR9Fn/artifacts/image-0495c03e-b4c2-43c3-86fb-5395d9d46d3d.png`。
- 真实ASR：用macOS say在临时目录生成测试音频并转WAV（未调用付费TTS），插件读取工作区输入→实际硅基ASR→返回`This is a yonder speech recognition check.`。无exec下工作区外文件及指向外部文件的symlink均返回AUDIO_OUTSIDE_WORKSPACE，未上传。实际当前附件授权路径未测，源码检查不抵扣。
- 原始JSON证据：`/tmp/yonder-siliconflow-image-live-result.json`、`/tmp/yonder-siliconflow-asr-live-result.json`；可信子进程脚本只在临时目录，未进入产品或skill。证据层为源码插件+真实免费API，不是安装版模型/飞书渠道端到端通过。
- workspace、根tsconfig、package-lock必要接线已完成，没有新外部依赖。根build/typecheck通过，日志`/tmp/yonder-media-build.log`、`/tmp/yonder-media-typecheck.log`。SDK checkPlugin+9项聚焦检查通过；4个本轮代码/配置文件biome通过，git diff --check通过。没有运行全仓矩阵或新Luna场景。
- 正式版保持1905、配置不变；新插件尚未发行/安装。未执行付费TTS、任何视频生成或第三方平台注册。免费视频只核实了硅基现行收费与HF官方赠送credit模式，不能声称穷尽所有服务，也不能将额度抵扣称为免费模型。
