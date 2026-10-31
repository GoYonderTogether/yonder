# 来源与复用

本包为原生 SDK 适配，无上游代码复制、无额外媒体 SDK。标准 HTTP 使用 Node fetch；现有 typebox 做参数契约校验。

- SiliconFlow 官方：https://api-docs.siliconflow.cn/docs/api/images-generations-post 。使用 `image_size` 和 `images[].url`，推荐尺寸、默认水印和一小时临时 URL；不是 OpenAI `size`/`data[]` 协议。
- Hermes，本机 commit `66605471e9f0b0832abbefaf625ce08e948ca540`，MIT；阅读 `tools/image_generation_tool.py`（FAL）、`tools/transcription_cloud.py`、`tools/tts_tool_openai.py`；对照产物/标准音频端点语义，不迁移 FAL、凭据链、队列或 Python 运行时。
- OpenClaw，本机 commit `cafa09e50556e08c2a04a670f16ac815482c5489`，MIT；阅读 `extensions/deepinfra/image-generation-provider.ts`、`extensions/openai/image-generation-provider.ts`；其 OpenAI 统一请求字段与硅基不一致，不复制 provider 框架或 OAuth 路径。

价格来自 2026-10-19 对官方模型详情页的核对：`Kwai-Kolors/Kolors` ¥0.000000/图片，L0 2 IPM/400 IPD。价格观察不代表插件内部维护价格表，也不代表真实生成已通过。

- SiliconFlow ASR 官方：https://docs.siliconflow.cn/docs/api/audio-transcriptions-post 。multipart file+model，响应 text；50 MB/一小时时长平台限制。官方控制台已确认 FunAudioLLM/SenseVoiceSmall ¥0，GET /v1/models也实际列出该型号。
- 阿里百炼 TTS 官方（WebSocket 双工）：https://help.aliyun.com/zh/model-studio/cosyvoice-websocket 。协议为 `wss://dashscope.aliyuncs.com/api-ws/v1/inference`：`run-task`(task_group=audio,task=tts,function=SpeechSynthesizer) → 收到 `task-started` 后 `continue-task` 送文本 → `finish-task`；音频以二进制帧返回，JSON 事件按 `header.task_id` 对账。2026-10-31 实测 `cosyvoice-v3-flash`/`longanhuan_v3` 首包 501 ms（12 字，5 次中位数），限速参数名为 `rate`（`speed` 无效）。计费 1 元/万字符，主人 2026-10-30 授权付费调用。
