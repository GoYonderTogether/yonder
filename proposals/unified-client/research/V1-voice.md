> 证据材料，结论已并入 [voice.md](../voice.md)

# Yonder 语音基座调研报告（只读调研，未改任何文件）

## 0. 结论速览

先给结论，后面逐项给依据、许可证与未验证项。

| 能力 | 第一阶段推荐 | 理由一句话 |
|---|---|---|
| ASR（流式） | sherpa-onnx 流式 zipformer/paraformer（本地）+ 云端 Paraformer/SenseVoice 兜底 | 有官方 npm 包 `sherpa-onnx-node@2.0.1`，Node 22 直接可用，无需 Python 侧车 |
| ASR（离线精修） | sherpa-onnx SenseVoice（本地）或 SiliconFlow `/audio/transcriptions`（已有工具） | 现有 `media-tools` 已接 ASR，先复用 |
| TTS | sherpa-onnx VITS/Kokoro（本地）；质量升级走 CosyVoice2（云或自托管 GPU） | Piper 新版转 GPL-3.0，与本仓 Apache-2.0 有冲突风险 |
| 实时对话 | 级联（ASR→Yonder Agent→TTS）为主；端到端 Omni 作并行 spike | 端到端模型拿不到 Yonder 的工具、记忆与身份 |
| 唤醒词 | sherpa-onnx KWS（中文自定义关键词免训练）+ 声纹门控 | openWakeWord 只出英文模型；Porcupine 中文需商业授权 |
| VAD | Silero VAD | MIT、ONNX、~2MB，最省心 |
| 环境理解 / 自主唤醒 | VAD+能量+时段启发式 → 便宜文本模型判定 | 上大模型判"该不该醒"成本不划算 |
| 降噪 / AEC | 系统或浏览器 APM 先行；离线增强用 DeepFilterNet | DeepFilterNet 双许可 MIT/Apache，可商用 |
| 只记主人 | VAD → 3D-Speaker CAM++ 声纹门控 → 可选 TSE | CAM++ 中文数据训练，Apache-2.0，sherpa-onnx 可直接跑 |
| 常驻录音 | macOS 先行；Android FGS mic；iOS 最后做 | iOS 审核风险最高，不该放第一阶段 |
| 眼镜 | Brilliant Labs Frame/Halo 原型 → Meta DAT → 雷鸟 X3 Pro | 只有开放音频流的平台才谈得上接入 |

五条关键判断：

1. **语音不要走 pi-ai 的 provider 抽象。** `node_modules/@earendil-works/pi-ai/dist/providers/model-schema.d.ts:9` 把输入模态冻结成 `["text","image"]`，扩它等于改第三方包契约。Yonder 已经有正确的落点：`services` + `api.services.resolve('asr'|'tts')`（`packages/sdk/src/types.ts:364-371,464`，实现 `packages/core/src/runtime/index.ts:1648`，规范 `docs/spec/07-runtime.md:101-123`），且 `ServiceEndpoint` 已经带 `voices?: string[]`。语音是"服务"，不是"模型"。
2. **"常驻录音 + 只记主人"不是一个模型问题，是四级流水线**：VAD 切片 → 声纹验证门控 → 拒识非主人 → 可选目标说话人提取（TSE）把主人从混叠里抠出来。单靠 ASR 或单靠 diarization 都做不到。
3. **自主唤醒的瓶颈是成本和误报，不是模型能力。** 用便宜模型 + 结构化上下文（时段、日历、是否在说话、说话人是谁、环境音类别）做决策，别把"该不该醒"交给 Omni 实时模型。
4. **端到端实时模型和 Yonder 的 Agent 形态是竞争关系**：它自带打断、AEC 和低延迟，但不带工具、记忆、身份、任务账本。可参考 `QwenLM/Qwen-Live-Harness`（2026-09 发布，官方）的分法——"Host 采集、daemon 协调、Omni 理解与发声"，与 Yonder 的 daemon/host 分层几乎同构。
5. **许可雷区有三个**：Piper（新仓 `OHF-Voice/piper1-gpl` = GPL-3.0）、TEN VAD（Apache-2.0 + 禁止与 Agora 竞争的附加条款）、pyannote 权重（代码 MIT，模型权重另受条款约束，sherpa-onnx 的 diarization ONNX 模型继承该约束）。

---

## 1. ASR：流式与离线，中英混合

### 候选与硬指标

| 方案 | 许可证 | 本地 | 平台 | 中文/中英混 | 延迟 | 资源 |
|---|---|---|---|---|---|---|
| sherpa-onnx（`k2-fsa/sherpa-onnx`，Apache-2.0，15.5k★，2026-10 仍活跃） | Apache-2.0 | ✅ | C++/Python/Node/Java/Swift/Android/iOS/WASM | 流式 zipformer 中英双语模型、paraformer 中文、SenseVoice 离线；中英混说表现好 | 流式 200–600ms（chunk 级） | int8 流式模型 20–80MB，单核 CPU 可跑，无 GPU |
| FunASR / Paraformer（`modelscope/FunASR`，MIT，20.8k★） | MIT | ✅ | Python 为主（PyTorch/ONNX 导出） | 中文工业级，标点/ITN 齐全，热词强 | 流式 300–800ms | 需 PyTorch 或 ONNX Runtime；CPU 可用但吃内存 |
| SenseVoice（`QwenAudio/SenseVoice`，MIT，9.6k★） | MIT | ✅ | ONNX/Python | 中英日韩粤，带情感/事件标签 | 离线，非流式；15s 音频约 70ms（GPU） | Small 版 ~230MB |
| whisper.cpp（MIT，54.7k★） | MIT | ✅ | 全平台，含 Node/WASM | 中英混说可用但中文标点弱、幻觉（静音段编造）明显 | 非流式；流式需自建 chunk 拼接，延迟 1–3s | tiny~75MB / small~500MB / medium~1.5G |
| faster-whisper（MIT，26.2k★） | MIT | ✅ | Python + CTranslate2 | 同上，速度快 4 倍 | 非流式为主 | GPU 友好，CPU int8 可跑 |
| 阿里 DashScope（Paraformer 实时 / SenseVoice 文件） | 商业 | ❌ | HTTP/WebSocket | 中文最强梯队，热词、ITN、标点齐全 | 流式 ~300–500ms | 无本地占用 |
| 讯飞（RTASR 实时转写 / IAT 听写） | 商业 | ❌ | WebSocket | 中文强，方言多 | ~300ms | 无 |
| 火山引擎（大模型流式 ASR） | 商业 | ❌ | WebSocket | 中文强，与豆包实时语音同栈 | ~300ms | 无 |
| OpenAI（gpt-4o-transcribe / realtime transcription） | 商业 | ❌ | HTTPS/WSS | 中文可用但非领先，中英混说尚可 | 文件 ~1s 起；流式 ~500ms | 无 |
| Deepgram（nova-3） | 商业 | ❌ | WSS | 英文最优，中文明显弱于国内厂商 | ~300ms，业内最低档 | 无 |

### 结论

- **本地主力选 sherpa-onnx**：唯一同时满足"Node 22 原生绑定（`sherpa-onnx-node@2.0.1` 在 npm 上）+ Apache-2.0 + 流式与离线同一套 API + Android/iOS/WASM 全覆盖"的方案。Yonder 是 Node/TypeScript 单体，这一条几乎决定选型。
- **离线精修用 SenseVoice**（标点、情感、事件标签），或直接复用现有 `plugins/media-tools/src/index.ts:198-247` 的 `*_audio_transcribe`（SiliconFlow `/audio/transcriptions`，限 50MB / 1 小时，见 `:101,105`）。
- **whisper 系不进主链路**：静音幻觉和 1–3s 延迟对"随口记灵感"体验是硬伤，可作离线归档的二次校对。
- **云端先接阿里**：`docs/spec/07-runtime.md:107-113` 的示例配置就是 SiliconFlow/DashScope 形态（`asr: { models: [FunAudioLLM/SenseVoiceSmall] }`），零改动可跑；火山作备选，讯飞只在需要方言时考虑。
- **未验证**：各云厂商当前单价与免费额度（本次未核到官方价目页，正式设计前必须核对）；Deepgram nova-3 中文实测效果（无凭据未测）。

---

## 2. TTS

| 方案 | 许可证 | 本地 | 中文 | 流式/首包 | 音色克隆 | 资源 |
|---|---|---|---|---|---|---|
| sherpa-onnx TTS（VITS / Kokoro / Matcha） | Apache-2.0 | ✅ | VITS 中文多说话人模型成熟；Kokoro 多语含 zh | 支持 chunk 级流式，首包 100–300ms（CPU） | ❌（VITS 固定说话人） | VITS ~60–120MB，CPU 实时 |
| CosyVoice2（`QwenAudio/CosyVoice`，Apache-2.0，24.1k★） | Apache-2.0 | ✅（需 GPU 才实用） | 中文/中英混说最好的一档，情感与韵律自然 | 流式 ~150ms（GPU） | ✅ zero-shot 3s 参考音 | 0.5B，GPU 4–8GB |
| Kokoro（`hexgrad/kokoro`，Apache-2.0，9.7k★） | Apache-2.0 | ✅ | 82M 参数，英文极好，中文一般 | 快，CPU 可实时 | ❌ | ~330MB（含 vocoder） |
| F5-TTS（MIT，15.5k★） | MIT | ✅（GPU） | 中文可用，克隆质量高 | 非流式，首包 1s+ | ✅ | 336M，GPU 必需 |
| MeloTTS（MIT，7.7k★，2024-12 后停更） | MIT | ✅ | 中文可用，自然度中等 | CPU 实时 | ❌ | ~200MB |
| Piper | `rhasspy/piper` MIT 但已归档；继任 `OHF-Voice/piper1-gpl` **GPL-3.0** | ✅ | 中文模型少、机械感明显 | 极快（树莓派级） | ❌ | 20–60MB |
| 阿里 CosyVoice / 火山豆包 TTS / MiniMax / 讯飞超拟人 | 商业 | ❌ | 中文自然度最高梯队 | 首包 200–400ms | ✅ 需授权验证 | 无 |
| Azure Neural TTS | 商业 | ❌ | 中文好，SSML 完整 | 首包 ~300ms | ✅（custom neural voice 需审批） | 无 |
| ElevenLabs | 商业 | ❌ | 中文一般（多语 v2/v3） | 首包 ~300ms | ✅ 需 voice verification | 无 |
| OpenAI gpt-4o-mini-tts | 商业 | ❌ | 中文可用 | 首包 ~400ms | ❌ | 无 |

### 结论与许可要点

- 本地先跑 **sherpa-onnx VITS 中文多说话人**（与 ASR 同一运行时、同一 npm 包，零新增依赖）；质量不满意时把 `services.tts` 指向 CosyVoice2（云或自托管 GPU），代码不变。
- **Piper 慎用**：老仓 MIT 但已归档，新仓 `piper1-gpl` 是 GPL-3.0。Yonder 根 `package.json` 是 Apache-2.0，把 GPL 代码链进同进程分发会有传染风险；如果一定要用，只能作为**独立子进程/独立可执行文件**调用，并在 `THIRD_PARTY_NOTICES.md` 记录。
- **音色克隆的授权问题（必须写进设计）**：
  - 克隆他人音色需要**书面、可追溯、可撤回的授权**，且不得模仿特定自然人；国内依据《互联网信息服务深度合成管理规定》第 14 条（需单独同意）与《人工智能生成合成内容标识办法》（2025-09-01 施行，需显著标识）。
  - 供应商侧普遍要求"授权验证"（ElevenLabs voice verification、火山/MiniMax 复刻需授权材料），这是合规成本不是技术成本。
  - 建议：Yonder 只允许克隆**主人本人**音色（注册时录一段声明 + 本地存授权记录），第三方音色一律走供应商预置音色库。
- **未验证**：CosyVoice2 在 M 系列 Mac 上的实时率（需真机测）；Kokoro 中文自然度主观评分。

---

## 3. 实时语音对话：端到端 vs 级联

### 端到端实时模型

| 方案 | 接入形态 | 打断 | AEC/回声 | 备注 |
|---|---|---|---|---|
| OpenAI Realtime（gpt-realtime 系） | WebRTC / WebSocket / SIP | 服务端 VAD + 可打断 | 服务端做回声抑制与降噪 | 生态最成熟，中文可用；价格按音频 token 计 |
| Gemini Live API | WebSocket（+ 移动端 SDK） | 原生支持 barge-in | 客户端需自备 AEC | 原生音频输出，多语；Android XR 官方示例即用它 |
| 豆包实时语音 3.0（Seeduplex，全双工） | `wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue`，model `1.2.6.1`，必填 `voice` | 原生全双工 | 服务端 | 中文对话体验当前第一梯队 |
| Qwen3.8-Omni-Flash-Realtime | `wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime`，默认 voice `Tina`；**必须用业务空间专属域名，不支持公共地址** | 原生 | 服务端 | 有官方 harness 参考实现 |

（端点与默认值来自开源实现 `muzi-long/sip2agent` 的 README，2026-10 仍活跃；正式接入前仍应逐字核对官方文档。）

### 级联（ASR→LLM→TTS）

- 打断：必须自己做——VAD 检出人声 → 立刻停 TTS 播放 → 取消在途 LLM/TTS 请求。Yonder 侧已有 `AbortSignal` 贯穿工具与执行（`packages/sdk/src/types.ts` 的 `ToolContext.signal`），可复用。
- 回声消除：必须自己做。扬声器外放时不做 AEC，VAD 会把 TTS 自己当成用户在说话（自激）。
- 延迟账：ASR 尾包 300ms + LLM 首 token 400–1200ms + TTS 首包 200ms ≈ **1.0–1.8s**，靠"边说边合成 + 句子级流水"能压到 800ms 左右。

### 传输层

| | WebRTC | WebSocket |
|---|---|---|
| NAT/移动网络 | 内建 ICE/STUN/TURN，切换网络不断 | 需自己重连 |
| 丢包 | FEC/NACK/jitter buffer 内建 | TCP 队头阻塞，弱网下音频卡顿明显 |
| 内建音频处理 | 有（AEC/NS/AGC，浏览器与 libwebrtc 均带） | 无，全靠自己 |
| 实现成本 | 高（信令、SDP、TURN） | 极低 |
| 适合 | 手机/跨网/长时间通话 | 本机、局域网、原型 |

- **LiveKit（`livekit/livekit` + `livekit/agents`，均 Apache-2.0，21.8k/15k★，2026-10 活跃）**：自托管 SFU + Agent 框架，把"WebRTC 传输 + 房间 + 服务端 agent 入会"打包好了。适合第二阶段；第一阶段用它属于过度设计。注意其降噪插件（Krisp/BVC）依赖 LiveKit Cloud，不是纯开源。

### 结论

- 第一阶段：**级联 + WebSocket + 本机/局域网**，先把"语音进、Yonder 干活、语音出"打通，延迟目标 ≤1.5s。
- 第二阶段并行：端到端 Omni 只当**对话前端**，工具调用仍转给 Yonder（`Qwen-Live-Harness` 就是这个模式：Omni 说话、daemon 协调、后台 harness 干活）。
- 跨网/手机端再引入 LiveKit，不要提前上。

---

## 4. 唤醒词

| 方案 | 许可证 | 中文自定义词 | 现状 |
|---|---|---|---|
| sherpa-onnx KWS | Apache-2.0 | ✅ **免训练**：改 `keywords.txt`（token 拼写），用中文 wenetspeech KWS 预训练模型（zipformer transducer，约 3.3M 参数） | 活跃；有 `keyword-spotter.cc` / `keyword-spotter-transducer-impl.h` 完整实现 |
| openWakeWord | Apache-2.0 | ❌ 预训练**只有英文**（README 明确："Currently, only English models are supported"）；中文需自训，且骨干是英文语料预训练的 Google speech embedding，中文迁移效果未知 | 活跃；训练管线是"100% 合成语音 + 冻结骨干"，Colab 1 小时内可训 |
| Porcupine | 仓库 Apache-2.0，**SDK 与模型受 Picovoice 条款约束** | 需商业授权（README："additional languages … for commercial customers on a case-by-case basis"），自定义词经 Console 生成 `.ppn`，需 AccessKey | 活跃，但中文与商用都要谈授权 |
| Snowboy | GitHub 无法识别 SPDX（NOASSERTION），2021-10 后无提交 | ❌ | **淘汰**：官方训练服务与模型下载已停 |

### 中文自定义唤醒词怎么训练

1. **首选免训练路线（覆盖 90% 需求）**：sherpa-onnx KWS 中文预训练模型 + 自定义 `keywords.txt`。把"嘿 Yonder"拆成 token 序列写进关键词表，阈值调 `keywords_score` / `keywords_threshold`。优点：换词零成本，可同时挂 5–10 个词。
2. **需要专属模型时**：用 icefall 的 KWS 配方自训 3M 级 zipformer（社区已有 fr/es 等语种的同尺寸模型，2026-08 仍在产出，说明这条流水线仍在维护）。数据靠中文 TTS 合成 + 真实录音混合。
3. **加一层声纹门控**：KWS 命中后再做一次 speaker embedding 比对，直接压掉"别人喊你名字"的误唤醒。openWakeWord 的 custom verifier models 是同一思路的英文版。
4. **误唤醒预算**：常驻场景目标 ≤1 次/24h。这个指标只能靠真机长跑得到，不能靠离线集。

---

## 5. VAD 与环境理解

| 方案 | 许可证 | 说明 |
|---|---|---|
| Silero VAD | MIT | ONNX ~2MB，30ms 帧，CPU <1%，多语通用，社区默认 |
| TEN VAD | **Apache-2.0 + 附加条款：不得用于与 Agora 竞争的产品**（`TEN-framework/ten-vad` LICENSE 原文） | 16kHz/10ms hop，比 Silero 更小更快；但许可附加条件对通用产品是实质风险，**建议不用** |
| YAMNet | Apache-2.0（TF Hub/TF Lite） | AudioSet 521 类音频事件，~4MB，只能给粗类别（说话/音乐/车流/狗叫） |
| PANNs（`qiuqiangkong/audioset_tagging_cnn`，MIT） | MIT | CNN14 ~80M，标签更准，CPU 实时勉强 |
| BEATs（`microsoft/unilm`，MIT） | MIT | 自监督音频表征，事件分类 SOTA 档，模型较大 |

### "该不该醒"怎么做

分两级，不要一步上大模型：

- **门控级（本地、零成本）**：Silero VAD 判"有人在说话" → 说话时长 ≥3s → 声纹判"是不是主人" → 环境音类别（YAMNet：是否在嘈杂街道/会议室/车里）→ 时段（是否在日程里）。任一不满足直接丢弃，只留 30s 环形缓冲。
- **决策级（便宜文本模型）**：把结构化摘要（时段、位置类别、最近 30s 转录片段、上一轮对话距今多久、当前任务账本状态）交给最便宜的模型，输出 `wake / log_only / ignore` 三态 + 一句理由。

成本估算（数量级，需按实际价目核对）：

- 决策 prompt ≈ 300–600 tokens，输出 ≈ 50 tokens；按 mini 级模型约 **¥0.001–0.01/次**。
- 每 10 分钟一次决策 = 144 次/天 ≈ **¥0.15–1.5/天**；只在门控通过后才决策，实际调用量会低一个数量级。
- 本地音频事件分类常驻 ≈ **<2% 单核**。

这个设计对应需求里的两个场景：路演（环境音嘈杂 + 主人在讲话 → 高优先唤醒并开始记录）、骑车（风声 + 断续短句 → 只记录不打断）。

---

## 6. 降噪与回声消除

| 方案 | 许可证 | 定位 | 备注 |
|---|---|---|---|
| WebRTC APM（AEC3/NS/AGC） | BSD-3（WebRTC 整体） | 实时 AEC + 降噪 + 增益，全双工必需 | 浏览器内建；原生侧可用 `webrtc-audio-processing` 绑定 |
| 浏览器 `noiseSuppression` / `echoCancellation` / `autoGainControl` | 平台内建 | `getUserMedia` 的 constraint，零成本 | 质量不如 APM 可调，但"能开就开" |
| RNNoise（`xiph/rnnoise`，BSD-3-Clause，5.9k★） | BSD-3-Clause | 轻量 RNN 降噪，48kHz/10ms，单核 <1% | 2025-02 后更新放缓；对音乐/键盘声有效 |
| DeepFilterNet（`Rikorose/DeepFilterNet`，**MIT OR Apache-2.0** 双许可） | MIT/Apache-2.0 | 强降噪，48kHz 全带，可实时（CPU 单核 ~5–10%） | 建议作为"离线增强 + 高噪环境实时"选项 |

结论：

- **AEC 必须用现成的**（WebRTC APM 或系统/浏览器），自己写不现实。级联方案里"外放 + 麦克风"同时工作是常态，没有 AEC 就会自激。
- **降噪不要默认全开**：降噪会损伤声纹特征和唤醒词鲁棒性。建议顺序是 AEC → 轻降噪（RNNoise）→ VAD/声纹；DeepFilterNet 只用于"记录归档"这一路，识别路保持原始信号。
- **双路信号**是重要的架构决定：**识别路**（低延迟、轻处理）与**归档路**（高质量、可离线重处理）分开，别用一路信号满足两个目标。

---

## 7. 说话人：注册、验证、分离、只记主人

| 能力 | 推荐 | 许可证 | 中文 | 资源 |
|---|---|---|---|---|
| 声纹 embedding / 验证 | **3D-Speaker CAM++**（`modelscope/3D-Speaker`，Apache-2.0，3.2k★），经 sherpa-onnx 的 speaker embedding 接口跑 | Apache-2.0 | ✅ 中文数据训练，CN-Celeb EER ~0.7% 档 | ~28MB ONNX，单次打分 <20ms |
| 备选声纹 | WeSpeaker（`wenet-e2e/WeSpeaker`，Apache-2.0）ResNet34/ECAPA | Apache-2.0 | ✅ | 模型较大，GPU 更合适 |
| 说话人分离（diarization） | sherpa-onnx 离线 diarization（pyannote segmentation + 聚类） | 代码 Apache-2.0，**但 pyannote segmentation 权重受 pyannote 条款约束** | ✅ | 实时性一般，适合离线 |
| 备选 diarization | pyannote.audio（代码 MIT，HF 权重 gated，商用另议） | 见左 | ✅ | Python + GPU 更佳 |
| 目标说话人提取（TSE） | WeSep（`wenet-e2e/WeSep`，Apache-2.0）或 ClearerVoice-Studio（Apache-2.0） | Apache-2.0 | 中文需自训/微调 | GPU |
| personal VAD 思路 | 无成熟开源可直接用；用"VAD 段 + 声纹打分 + 阈值 + 滞回"自建 | — | — | 极低 |

### "只记录主人本人的声音"怎么实现（四级，逐级加成本）

1. **VAD 切片**：Silero VAD 出语音段（去掉静音与噪声段），这是最大的一笔省算力。
2. **声纹门控**：每段算 CAM++ embedding，与主人注册模板（3–5 条、多场景）算余弦相似度；阈值 + 双阈值滞回（进入高阈值、退出低阈值）避免抖动。这是**性价比最高的一级**，能挡掉绝大多数旁人语音。
3. **拒识（open-set）**：对"像但不确定"的段做二次判定（更长的窗、更严的阈值），宁可漏记不要错记——错记他人语音是隐私事故，漏记只是体验损失。
4. **TSE（可选）**：主人与旁人同时说话（路演问答、餐桌）时，用注册声纹做 target speaker extraction 把主人抠出来。这是唯一能处理"重叠语音"的手段，但需要 GPU 和中文微调数据，**不进第一阶段**。

工程补充：

- 声纹模板要**分场景注册**（安静室内 / 车内 / 户外风噪），单模板在跨场景下 EER 会翻倍。
- 声纹 embedding 属于生物识别信息，按《个人信息保护法》属敏感个人信息：**本地存储、单独同意、可删除**，不能进日志、不能上传到 ASR/TTS 供应商。
- 微信输入法"排除非本人声音"的具体实现未公开，本报告只对齐其**效果目标**（近场 + 声纹 + VAD 组合），不假设其内部机制。

---

## 8. 常驻后台录音：各平台限制与做法

| 平台 | 关键限制 | 做法 |
|---|---|---|
| **iOS** | 需 `UIBackgroundModes: audio` 且音频会话活跃；系统会在锁屏显示录音指示；App Review 对"无明确用户价值的长时录音"敏感（Guideline 2.5.4 / 4.3 常被引用） | 必须有明确的用户可见用途 + 可暂停开关 + 隐私政策；建议**不做"无声常驻"**，改为"用户显式开启的记录模式"（如会议、骑行），并在 UI 常驻指示。**审核风险：高，放最后** |
| **Android** | Android 14+ 前台服务必须声明 `FOREGROUND_SERVICE_MICROPHONE` + `RECORD_AUDIO`，且 FGS 必须在应用可见时启动；Android 15 进一步收紧 FGS 启动时机 | 标准做法：`startForeground` + `microphone` 类型 + 常驻通知；厂商保活差异极大（小米/华为/OPPO 需引导用户加白名单/自启动），必须做"被杀后自动恢复"的守护逻辑与用户可见说明 |
| **macOS** | TCC 麦克风授权（`NSMicrophoneUsageDescription`），系统设置里可随时撤销；本仓已有 `packages/macos/Companion.swift`、`packages/macos-helper/` 的权限流程可复用 | 用 `AVAudioEngine` 常驻 + 权限状态机；撤销权限要能被检测并提示，不能静默失败 |
| **Windows** | 隐私设置里"麦克风访问"与"允许桌面应用访问麦克风"两个开关；WASAPI 独占模式会抢设备 | 走共享模式；检测被系统禁用并提示 |
| **浏览器** | 后台标签页定时器被节流（最低 1 次/分钟）；内存节省模式会丢弃标签页，`getUserMedia` 流随之断开；页面隐藏时 `requestAnimationFrame` 停摆 | **不做常驻**。浏览器只做"用户按下才录"的组件；用 AudioWorklet 而非 `setInterval` 维持音频线程；监听 `visibilitychange` 与 `track.onended` 做恢复 |
| **Tauri 2** | 桌面端 WebView 调 `getUserMedia` 需要 `NSMicrophoneUsageDescription`（macOS）与 WebView 权限；移动端（iOS/Android）需要原生权限声明 + 运行时请求，插件生态里麦克风类插件质量参差 | 关键点：**麦克风采集不要交给 WebView**，用 Rust 侧（`cpal`）或原生侧采集，WebView 只做 UI 与播放。这样既绕开 WebView 权限差异，也避免后台标签页节流 |

电量与带宽（数量级）：

- 16kHz 单声道 PCM16 = **32 KB/s ≈ 115 MB/h**；Opus 16kbps ≈ **7.2 MB/h**。常驻必须编码后再落盘。
- 常驻 CPU：VAD <1%、KWS <3%、音频事件分类 <2%；声纹打分按语音段（每次 <20ms）不构成常驻负载。
- 手机常驻录音的实测功耗取决于是否持续 DSP 唤醒（可用硬件 VAD/低功耗协处理器则显著下降）——**这一项必须真机测**。

### 中国合规（必须写进设计）

- 《个人信息保护法》：录音属个人信息，声纹属**敏感个人信息**（第 28 条），需**单独同意**（第 14 条）、告知处理目的与方式（第 17 条）；公共场所采集他人图像/身份特征用于非公共安全目的受第 26 条约束。
- 《互联网信息服务深度合成管理规定》：合成语音需**单独同意**、需**显著标识**（第 14、17 条）。
- 《人工智能生成合成内容标识办法》（2025-09-01 施行）：生成内容需显式/隐式标识。
- 实务结论：**默认只录主人**（这既是产品需求也是合规降险）；涉及他人语音时必须"告知 + 明示录音中"（指示灯/提示音）；提供一键删除与导出；不得把原始音频发给第三方 ASR 而不告知。
- **未验证**：各地对"随身录音设备"的具体执法口径；如需上线国内应用商店，需另做一轮合规审查。

---

## 9. 智能眼镜

| 平台 | 官方 SDK | 音频流 | 视频/拍照 | 结论 |
|---|---|---|---|---|
| **Meta（Ray-Ban / Oakley / Ray-Ban Display）** | ✅ `facebook/meta-wearables-dat-ios` / `-android`（Swift Package / Maven，v1.0.1，2026-10 活跃） | ✅ README 明示 "video and audio streaming and photo capture" | ✅ 拍照 + 视频流；Display 版还有镜片 Web App | **最成熟**，但 developer preview + 需注册组织与 release channel，受 Meta Wearables Developer Terms 与 AUP 约束，Meta 会收集设备互联的遥测（可 `MWDAT.Analytics.OptOut` 关闭） |
| **Rokid（Rokid Glasses）** | ✅ Glasses SDK + Phone SDK（CXR-M/CXR-L），x-docs.rokid.com | 部分（眼镜端 AI 常独占麦克风） | 拍照/录像经手机侧 SDK | 可用，但音频通道受限，需实测 |
| **雷鸟 RayNeo（X3 Pro / iO）** | ✅ OpenXR Unity ARDK + Android；X3 Pro 是**独立 Android 设备** | ✅（就是 Android 麦克风） | ✅ | **对 Yonder 最有价值**：能直接跑一个 Android 节点，等于把 `packages/device` 的设备节点搬上眼镜 |
| **Xreal（Air / One）** | ✅ XREAL SDK / NRSDK | ❌ | ❌ | **不适合**：显示为主，无摄像头/麦克风开放 |
| **Brilliant Labs（Frame / Halo）** | ✅ `brilliantlabsAR/brilliant_sdk`，**BSD-3-Clause**，2026-10 活跃 | ✅（BLE 上音频流） | ✅ 拍照/相机 | **最开放**，Lua 5.4 设备端 VM + Python/Flutter/WebBluetooth 主机端；有官方模拟器（`halo-emulator`）可无硬件开发。缺点：BLE 带宽有限，不适合长时高码率音频 |
| 参考：统一封装层 | `hkust-spark/xg-glass-sdk`（Apache-2.0，2026-10 活跃） | 接口统一，实际能力矩阵多为空 | RayNeo/INMO 有 JPEG 流 | 思路可借鉴（"四个接口：视频进、音频进、显示出、音频出"），但**别依赖**：它自己标注多数机型"Video stream: No" |
| 参考：生态地图 | `extentos/smart-glasses-ecosystem`（CC BY 4.0，数据核验 2026-08-24） | — | — | 36 平台/142 机型的第三方可行性矩阵，做选型时用它交叉核对 |

### 结论

- **原型期用 Brilliant Labs**（BSD-3、真开放、有模拟器、能拿音频+相机），把"眼镜 = 一个音频/图像源"跑通。
- **产品期首选 Meta DAT**（唯一"音频 + 视频 + 拍照 + 成熟分发"的官方路径），但要接受 preview 状态、组织审核与遥测条款。
- **雷鸟 X3 Pro 是隐藏最优解**：独立 Android 意味着可以复用 Yonder 现有设备执行契约（见下节），不需要为眼镜单独写一套流协议。
- **未验证**：Rokid 眼镜端麦克风是否对第三方开放（文档未明确，需真机试）；Meta DAT 的音频流采样率/编码与延迟（需真机测）；Even Realities G1（无摄像头，仅 HUD + 麦克风）的实际音频开放度。

---

## 10. Yonder 集成点（代码定点核查）

### 10.1 provider 抽象：不要扩 pi-ai，扩 services

- `node_modules/@earendil-works/pi-ai/dist/providers/model-schema.d.ts:9`：`MODEL_INPUT_MODALITIES = ["text","image"]`，`ModelInputModality` 无 audio。扩它要改第三方包，违反 `AGENTS.md` 第 5 条（pi 运行包只能在 `packages/core/src/runtime/` 里 import）。
- 正确落点已在规范里：`docs/spec/07-runtime.md:101-123`「非对话服务」明确"ASR、TTS、embedding、rerank 等不经过 pi-ai"，配置形态已给出（`asr`/`tts`/`embedding` + `voices`）。
- 实现已存在：`packages/core/src/runtime/index.ts:1648` `resolveService(capability)` 按 `services` 顺序取第一个声明该能力的端点，`apiKey` 从 `credential` 指向的 api_key 凭据实时取（不缓存）；SDK 侧 `packages/sdk/src/types.ts:364-371` 的 `ServiceEndpoint` 已含 `voices?: string[]`。
- 配置 schema 已支持：`packages/core/src/config/schema.ts:129-140`（`capabilities: Record<text, {models, voices?}>`）。
- **结论**：语音不需要新抽象。缺的是**插件里的调用实现**和**流式约定**（当前 `ServiceEndpoint` 只描述端点，不描述流式协议与音频格式）。

### 10.2 `plugins/media-tools` 现状

- 已注册两个工具：`*_image_generate`（SiliconFlow `/images/generations`，结果写 workspace `artifacts/` 并以 `kind:"image"` 附件返回）与 `*_audio_transcribe`（`plugins/media-tools/src/index.ts:198-247`）。
- ASR 工具的关键约束：`protocol` 必须是 `siliconflow`（`:213` 一带），走 `/audio/transcriptions`（`:223`），限 **50MB / 1 小时**（`:101,105`），文件必须在 workspace 内或来自当前事件附件（`:80-95`）。
- **缺口**：没有 TTS 工具、没有流式、没有 VAD/说话人、`protocol` 硬编码单供应商。第一阶段要加的是 `*_tts_speak`（本地 sherpa-onnx + 云端两条路）与 `*_audio_vad_segments`。

### 10.3 附件与事件怎么承载音频

- `packages/sdk/src/types.ts:32-38`：`Attachment.kind` 已经是 `"image" | "audio" | "video" | "file"`，`mime`/`uri`/`bytes` 齐全 → 音频在数据模型上**已经是一等公民**。
- 但实际落地有 bug 级缺口：`packages/core/src/runtime/attachments.ts:6-33` 的 `attachmentFromPath` 只探测 PNG/JPEG/GIF/WEBP，音频一律退化成 `kind:"file"` + `mime:"application/octet-stream"`。这会让 ASR 工具、模型提示词、渠道投递都拿不到"这是音频"的信号。**第一阶段必须先补音频 MIME 探测**（wav/mp3/m4a/opus/ogg/flac/webm）。
- 提示词侧已经做了正确的防御：`packages/core/src/prompt/content.ts:266` 明确告诉模型"音频文件名不等于转录文本"，避免模型假装听过。
- 事件承载路径：`Trigger` 接口 `packages/sdk/src/types.ts:340-344` 的 `start(io: { emit(e: EventInput): Promise<YEvent> })` 是**语音进事件系统的现成入口**——一个 voice 触发器/渠道把"唤醒 → 录音段 → 转录 → 附件"作为 `message.in` 事件 emit 即可，之后的路由、绑定、会话、投递全部复用现有内核，零新增机制。
- 出站方向：`MessageOutData.attachments`（`packages/sdk/src/types.ts:56-62`）已支持附件，语音回复可作为 `kind:"audio"` 附件投递；`docs/spec/06-delivery.md:69` 的 `message_send({attachments})` 契约已定义。
- 观测入口：`docs/spec/13-observation-and-management.md:31` 的 `sessions submit --attachment <路径>` 可作第一阶段的**手工灌音频**测试通道（不用等录音链路）。

### 10.4 设备节点能否当"麦克风节点"

- 设备执行契约 `docs/spec/18-device-execution.md` 是**请求/响应 RPC**：`commands.submit` / `commands.status` / `commands.cancel` + `CommandReceipt` 状态机（`accepted|running|succeeded|failed|cancelled|unknown`），并且明确"`unknown` receipt 是事实，不自动转换为可重试错误"。
- 能力词表只有 `read|write|exec|network|message`（`docs/spec/18-device-execution.md` §3），**没有音频流/实时通道**。
- 执行端 action 是注册表模式：`packages/device/src/backend-provider.ts:14,26`（`actions: Readonly<Record<string, BackendAction>>`），实例见 `packages/device/src/backends/linux.ts:13-14,121`（`["open","click","type","scroll","back"]`）。
- **结论**：现有契约**不适合**承载"持续音频流"。两条可行路：
  - **A（不改契约）**：设备侧本地常驻录音 + 分段落盘，通过 `commands.submit` 上报"新录音段"（`message` 能力），或设备侧自己把段上传到 Yonder 的事件入口。适合"眼镜/手机作为采集端"。
  - **B（改契约）**：新增一条流式通道（`device.streams.*` 或复用 WSS 单独命名空间）。这是**设计变更**，按 `AGENTS.md` 第 7 条须维护者批准，不能自行补。
- 推荐先走 A；雷鸟 X3 Pro 这类独立 Android 设备天然适合 A。

### 10.5 通用前端子组件放哪

- `plugins/interaction` 已经是"本地 HTTP + 严格校验 + 可嵌入页面"的宿主：`plugins/interaction/src/service.ts:150` `createServer`，`:154-160` 校验 `Host`、`Origin`、secret path，`:145-149` 注入 `window.yonderSettings`，前端源码在 `plugins/interaction/web`（`build.mjs` 构建到 `dist/index.html`）。
- 关键事实：服务绑 `127.0.0.1`，浏览器把 `127.0.0.1` 视为**安全上下文**，因此 `getUserMedia` 在该页面可用。
- **结论**：麦克风申请与采集组件应作为 interaction 的一个新路由/新页面（`/mic`），供任何客户端以 iframe/WebView 嵌入；权限申请、设备选择、电平指示、录音状态机都在组件内，宿主只收 PCM/Opus 分片。这样"任何客户端、任何模块都能嵌入"不需要每个端各写一遍。
- 注意与 §8 一致：**浏览器组件不做常驻**；常驻由原生侧（macOS helper / Android FGS / Tauri Rust 侧）负责。

### 10.6 触发与自主唤醒的落点

- 语音触发器 = `api.triggers.register({ id, start, stop })`（`packages/sdk/src/types.ts:340-344`）。
- "定时/条件唤醒"可复用现有后台能力（`docs/spec/14-execution-capabilities.md` 的后台任务与 cron）——自主唤醒的决策节拍可以由 cron 或后台任务驱动，不必新造调度器。
- 身份：`packages/sdk/src/types.ts` 的 `identity` API 与 `docs/spec/02-sessions.md` 的身份映射可承载"这个声音是哪个 person"，但**声纹不是身份认证**，不能替代既有绑定——设计里必须写清这条边界。

---

## 11. 分层架构建议（六层）

```
L1 采集      mic/glasses/device → PCM 16k mono（双路：识别路 + 归档路）
L2 前处理    AEC(APM) → 轻降噪(RNNoise) → VAD(Silero) → 分段/环形缓冲
L3 识别与说话人  ASR(sherpa-onnx/云) + 声纹(CAM++) + 可选 diarization/TSE
L4 唤醒决策  KWS(sherpa-onnx) 门控 → 启发式 → 便宜模型三态判定
L5 对话      级联(ASR→Yonder Agent→TTS) 或 Omni 前端（工具转 Yonder）
L6 存储与检索 事件/附件落盘 + 转录索引 + 声纹模板库（本地、可删）
```

各层的边界规则（建议写进设计）：

- **L1 只产原始音频，不做任何判断**；采集失败必须显式上报（权限撤销、设备被占用、流中断），不能静默。
- **L2 的输出是"段"**（`{startMs, endMs, pcm, rms, snr}`），不是流。段是后续所有层的通用货币，也是重放/调试的单位。
- **L3 无状态**：给定段 + 声纹模板 → `{text, speakerScore, lang}`。这样本地/云端可以随时互换，也可以在归档时用更强的模型重跑。
- **L4 只做三态决策**（`wake / log_only / ignore`）+ 理由，**不执行动作**。它输出的是一条事件，不是一次工具调用。
- **L5 是唯一有"人设"和"记忆"的层**，且必须走既有会话/身份/工具链路，不能另开一套运行时（`AGENTS.md` 第 5 条）。
- **L6 的写入口只有事件系统**：所有音频、转录、声纹模板都通过事件与附件进入，检索建在事件库之上，不另建并行数据库。
- **隐私线**：声纹模板、原始音频、转录三者**分级存储**，各自独立的删除路径；声纹永不出本机。

---

## 12. 第一阶段最小可用切片（带验收标准）

目标：**macOS 上，说一句话 → Yonder 收到转录 → 用语音回一句**。不含唤醒、不含常驻、不含眼镜。

| # | 切片 | 验收标准 |
|---|---|---|
| 1 | 音频附件 MIME 修复：`packages/core/src/runtime/attachments.ts` 补 wav/mp3/m4a/opus/flac 探测 | 用 `sessions submit --attachment x.m4a` 灌入，事件里 `kind==="audio"` 且 `mime` 正确；现有单测全绿 |
| 2 | 本地 ASR 工具：`media-tools` 新增 `*_audio_transcribe_local`（sherpa-onnx-node，SenseVoice 或流式 zipformer） | 一段 10s 中英混说音频，输出文本包含两种语言的关键词；无网络可用；单次调用 <2s（M 系列） |
| 3 | 本地 TTS 工具：新增 `*_tts_speak`（sherpa-onnx VITS 中文） | 给定中文文本，产出 wav 附件并在 macOS 上播放；首包 <500ms；`services.tts` 配成云端时同一工具走云端分支 |
| 4 | 采集组件：interaction 新增 `/mic` 页面（`getUserMedia` + 权限状态机 + 电平 + 录音按钮） | 首次进入触发系统授权弹窗；拒绝后给出可操作提示；录音 10s 生成可播放音频并投递到当前会话 |
| 5 | voice 触发器：`api.triggers.register` 把"录音段 + 转录"作为 `message.in` emit | 说一句话后，会话里出现一条带 `attachments:[audio]` 的输入事件，Agent 的回复能引用转录文本 |
| 6 | 语音回复闭环：Agent 回复经 `message_send({attachments})` 投递音频 | 端到端（说完 → 听到回复）≤3s；音频附件在事件库可回放 |
| 7 | 声纹注册与门控（离线版）：注册 3 条主人音频，对段打分 | 主人语音通过率 ≥95%，他人语音误通过 ≤5%（自录 20 段小集）；模板本地存储且可删除 |
| 8 | 成本与隐私记录：一次完整对话的云端调用清单 | 日志里不出现原始音频与声纹；有 `--dry-run` 能列出会调用哪些外部端点 |

明确**不在**第一阶段：唤醒词、常驻后台、自主唤醒、diarization、TSE、iOS/Android、眼镜、WebRTC。

---

## 13. 需要真机测试的 spike 清单

| # | Spike | 要回答的问题 | 判定标准 |
|---|---|---|---|
| S1 | sherpa-onnx-node 在 macOS arm64 上的流式 ASR | 实时率、内存、首包延迟、中英混说准确率 | RTF <0.3、常驻内存 <300MB、首包 <600ms |
| S2 | sherpa-onnx KWS 中文自定义唤醒词 | "嘿 Yonder"能否免训练生效；误唤醒率 | 安静/嘈杂各 4h 长跑，误唤醒 ≤1 次/4h，10 次唤醒漏 1 次以内 |
| S3 | 外放 + 麦克风的 AEC 效果 | 级联方案会不会自激；打断是否可靠 | 连续 30 分钟对话无自激；打断响应 <300ms |
| S4 | CAM++ 声纹门控跨场景 | 室内/车内/户外风噪下的 EER 漂移 | 跨场景 EER <5%；主人通过率 ≥95% |
| S5 | 常驻录音功耗（macOS + 一台 Android） | 8h 常驻的电量与发热 | 手机 8h 耗电 <15%；无过热降频 |
| S6 | Android FGS microphone 保活 | 小米/华为/OPPO 上被杀的频率与恢复 | 24h 内中断 ≤1 次且能自动恢复 |
| S7 | iOS 后台音频审核可行性 | 长时录音是否会被拒 | 提交 TestFlight 后拿到审核反馈（**高风险，需提前排期**） |
| S8 | Omni 实时模型接入（Qwen3.8-Omni-Flash-Realtime / 豆包 Seeduplex） | 端到端延迟、打断、中文自然度、工具调用可行性 | 首响 <800ms；能通过 function call 触发一次 Yonder 工具 |
| S9 | Brilliant Labs Frame/Halo 音频流 | BLE 上能拿到什么码率、延迟多少 | 连续 16kHz 音频 ≥30s 不丢包；延迟 <500ms |
| S10 | Meta DAT 音频 + 视频流 | 采样率、编码、延迟、preview 限制 | 能拿到 PCM/Opus 流并送进 ASR；记录 preview 的硬限制 |
| S11 | 雷鸟 X3 Pro 跑 Yonder 设备节点 | 能否作为 Android 采集节点接入既有契约 | 通过 `commands.submit` 上报一段录音并被 Yonder 接收 |
| S12 | 「该不该醒」判定成本与误判 | 便宜模型三态判定的准确率与单次成本 | 人工标注 200 个场景，准确率 ≥85%，单次 <¥0.01 |

---

## 14. 待核实与风险清单

**必须在上正式设计前核实（本次未验证）：**

1. 各云厂商 ASR/TTS 当前单价与免费额度（阿里/讯飞/火山/OpenAI/Deepgram）——本报告只给了量级，未核到官方价目页。
2. Deepgram nova-3 中文实测效果（无凭据未测）。
3. Rokid 眼镜端麦克风对第三方的开放度；Even Realities G1 音频开放度。
4. Meta DAT 音频流的编码/采样率/延迟；preview 状态下的组织审核门槛。
5. CosyVoice2 在 M 系列 Mac 上的实时率。
6. Porcupine AccessKey 是否强制联网校验（影响离线可用性）。
7. 各地对随身常驻录音设备的执法口径；国内应用商店上架合规审查。

**已确认的许可雷区（设计时必须处理）：**

- `OHF-Voice/piper1-gpl` = **GPL-3.0**（老仓 `rhasspy/piper` MIT 但已归档）。与本仓 Apache-2.0 同进程链接有传染风险。
- `TEN-framework/ten-vad` = Apache-2.0 **+ 禁止与 Agora 竞争的附加条款**（LICENSE 原文）。
- pyannote 模型权重（含 sherpa-onnx 的 pyannote segmentation ONNX 导出）**不受 MIT 覆盖**，商用需另议。
- Porcupine：仓库 Apache-2.0，SDK/模型受 Picovoice 条款约束，中文与商用需授权。
- Snowboy：SPDX 无法识别、2021 年后停更、官方模型服务已停 → 淘汰。

**设计变更提示：** 若要为设备节点新增音频流通道（§10.4 方案 B），按 `AGENTS.md` 第 7 条属于设计变更，须先改 `docs/spec/` 并在 `docs/decisions.md` 记一条，由维护者批准，不能由实现侧自行补设计。
