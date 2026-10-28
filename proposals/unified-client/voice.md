# Yonder 语音基座设计：通话、常驻录音、自主唤醒、说话人与眼镜

状态：提案，待维护者批准。本文不改 `docs/`；涉及契约、规格的改动集中列在第 11.3 节。
输入：`research/V1-voice.md`、`design.md` §4、`contracts.md`、`docs/spec/07-runtime.md:101-123`、`plugins/media-tools`。

## 0 摘要

语音不是新子系统，而是挂在现有骨架上的四件事：

1. **能力走 services。** ASR、TTS 沿用 `api.services.resolve`（`docs/spec/07-runtime.md:118`），新增 `vad`、`kws`、`speaker`、`enhance`、`vision` 五个 capability。本地引擎统一用 sherpa-onnx（Node 包），云端走供应商端点。不碰 pi-ai provider。
2. **音频走网关。** 在 `contracts.md` §2 的 JSON 流之外新增一条二进制音频 WS（`/api/audio`）。任何采集端（浏览器、Tauri、手机、眼镜）把 16 kHz 单声道 Opus 帧送进完整节点，节点做前处理、识别、说话人、唤醒决策。
3. **决策与存储复用内核。** 语音进入系统的唯一方式是 emit `message.in` 事件加 audio 附件，复用路由、会话、身份、投递。所有产物（段、转录、唤醒记录）都是事件，检索建在事件库上，不另建数据库。声纹模板是唯一例外：单独加密存放，永不出本机。
4. **前端是一个组件。** `apps/app` 提供一个语音组件，负责麦克风权限、设备、电平和状态机；桌面和移动端的采集在原生侧，WebView 只做 UI 与播放。

分层：采集 → 前处理 → 识别与说话人 → 唤醒决策 → 对话 → 存储检索（第 1 节）。

两个关键取舍：

- **门控先于模型。** 唤醒词触发与自主唤醒都是"便宜规则先筛，贵的后上"：VAD → 声纹 → 启发式 → 文本模型。门控只决定是否唤醒 Bot，不决定是否录音：两种语音模式都全量录音（见 5.1）。
- **宁漏勿错。** 错误唤醒（尤其他人触发）是体验与隐私事故，漏唤醒只是体验损失。所有唤醒阈值向漏唤醒偏。

阶段（第 10 节）：V0 spike（真机回答 12 个未知）→ V1 macOS 语音通话 → V2 常驻与唤醒词与声纹 → V3 自主唤醒与 Android → V4 眼镜与视觉。iOS 常驻放在 V4 之后单独评估。

## 1 概念与分层

### 1.1 六层

```
L1 采集       任意设备节点 → 16 kHz mono 音频（识别路；归档路按需另采）
L2 前处理     AEC → 轻降噪 → VAD → 分段 + 环形缓冲
L3 识别与说话人  ASR + 声纹打分 + （离线）diarization
L4 唤醒决策   KWS → 启发式门控 → 文本模型三态
L5 对话       ASR → Yonder Agent → TTS（级联）；Omni 仅 spike
L6 存储检索   事件 + 附件 + 转录索引 + 声纹模板库
```

### 1.2 层间约定

| 层 | 输入 | 输出 | 不做什么 |
|---|---|---|---|
| L1 | 麦克风、眼镜 | `AudioFrame` 流 | 不判断内容；失败必须显式上报（权限撤销、设备被占、流中断），不得静默 |
| L2 | 帧流 | `Segment`（`startMs,endMs,pcm,rms,snr`） | 不识别内容 |
| L3 | `Segment` + 声纹模板 | `{text, lang, speaker:{score,verdict}}` | 无状态，本地与云端可互换，归档时可用更强模型重跑 |
| L4 | 段信息 + 上下文摘要 | `wake \| log_only \| ignore` + 理由 | 不执行动作，只产出事件 |
| L5 | `message.in` 事件 | 回复文本 → TTS 帧 | 不另开运行时；走既有会话、身份、工具链（`AGENTS.md` 第 5 条） |
| L6 | 事件 | 可检索记录 | 不并行建库；声纹模板除外 |

`Segment` 是通用货币：重放、调试、重识别、归档的单位都是段。

### 1.3 双路信号

识别路：低延迟、轻处理（AEC + 轻降噪或不降噪），进 VAD、KWS、声纹、ASR。归档路：段落盘后可离线重处理，允许 DeepFilterNet 等重降噪。原因：降噪会损伤声纹特征和唤醒词鲁棒性（调研 §6），所以两个目标不共用一路信号。

### 1.4 节点角色

沿用 `design.md` §1.1：

- **采集节点**：有麦克风的任何设备。只做采集、AEC（若平台自带）、编码、传输，以及可选的"边缘门控"（见 5.2，只有 VAD 级，不做决策）。
- **完整节点**：运行内核的节点，负责 L2 之后所有层。
- 本机浏览器、Tauri 桌面与内核同机时，采集节点与完整节点是同一台机器，走 loopback，无额外网络成本。

### 1.5 身份边界

声纹是"这是主人的声音"的证据，不是身份认证。`identity` 绑定与审批（`docs/spec/02-sessions.md`）不因声纹通过而放宽：声纹通过的语音只等价于"已知渠道里的主人消息"，不能批准凭据、不能触发 admin 级方法。

## 2 服务契约

### 2.1 service id 与 capability

| capability | 用途 | 本地实现 | 云端实现 |
|---|---|---|---|
| `asr` | 流式与离线识别 | sherpa-onnx 流式 zipformer / SenseVoice | DashScope Paraformer，SiliconFlow `/audio/transcriptions`（已有） |
| `tts` | 合成 | sherpa-onnx VITS 中文 | CosyVoice、豆包、Azure 等 |
| `vad` | 语音活动检测 | Silero VAD（ONNX） | 无云端形态 |
| `kws` | 唤醒词 | sherpa-onnx KWS | 无云端形态 |
| `speaker` | 声纹 embedding 与验证 | 3D-Speaker CAM++ | 无（声纹不上传，见 9.2） |
| `enhance` | 降噪（归档路） | RNNoise、DeepFilterNet | 无 |
| `vision` | 图像识别（眼镜） | 无（V4 再定） | 视觉模型端点 |

`vad`、`kws`、`speaker`、`enhance` 只允许本地协议。配置时若指向非 loopback 的远程端点，节点启动时报错而不是静默使用，这一条是隐私红线的技术落点。

### 2.2 配置形态

沿用 `services` 数组与 `resolve` 顺序语义。本地引擎用新增的 `protocol: local`，不需要 `baseUrl` 和 `credential`：

```yaml
services:
  - id: local-voice
    protocol: local
    engine: sherpa-onnx          # 本地引擎名，由语音插件解释
    capabilities:
      asr:     { models: [zipformer-zh-en-streaming, sense-voice-small] }
      tts:     { models: [vits-zh-multi], voices: [default] }
      vad:     { models: [silero-v5] }
      kws:     { models: [wenetspeech-zipformer-3m] }
      speaker: { models: [cam++-zh] }
  - id: dashscope
    protocol: dashscope-ws
    baseUrl: wss://dashscope.aliyuncs.com/api-ws/v1/inference
    credential: dashscope
    capabilities:
      asr: { models: [paraformer-realtime-v2] }
      tts: { models: [cosyvoice-v2], voices: [longxiaochun] }
```

说明：

- 上例中的云端 baseUrl 与模型名是示意，**未核对官方文档**，正式接入前逐字核对（调研 §14）。
- 本地模型文件放 `<home>/.yonder/models/<capability>/<model>/`，首次使用时下载并校验 SHA256；下载本身是外网请求，需用户确认一次。
- `resolve(capability)` 返回第一个声明该能力的端点（`07-runtime.md:118`）。要在本地与云端之间选，调整 `services` 顺序。同一能力需要多端点（本地流式加云端离线精修）时，用 `models` 里的 id 区分，由语音插件按用途选，不改 `resolve` 语义。

### 2.3 SDK 类型

放在 `@yonder/sdk`（调用实现在插件，内核只存与解析）。`ServiceEndpoint` 增加两个可选字段：

```ts
interface ServiceEndpoint {
  id: string; protocol: string; baseUrl?: string; apiKey?: string;
  models: string[]; voices?: string[];
  engine?: string;                       // protocol:"local" 时必填
}

type PcmFormat = { sampleRate: 16000 | 24000 | 48000; channels: 1; codec: "pcm16" | "opus" };

interface AsrService {
  stream(opts: { model: string; lang?: "zh" | "en" | "auto"; hotwords?: string[]; signal: AbortSignal }): AsrStream;
  transcribe(seg: Segment, opts: { model: string; lang?: string }): Promise<AsrResult>;
}
interface AsrStream {
  push(frame: Uint8Array): void;
  events: AsyncIterable<{ kind: "partial" | "final"; text: string; startMs: number; endMs: number }>;
  end(): Promise<AsrResult>;
}
interface AsrResult { text: string; lang: string; segments: { text: string; startMs: number; endMs: number }[] }

interface TtsService {
  synthesize(text: string, opts: { model: string; voice?: string; signal: AbortSignal }): AsyncIterable<Uint8Array>; // PCM16 chunk，首包即播
}
interface VadService { create(opts?: { threshold?: number; minSpeechMs?: number; minSilenceMs?: number }): VadStream }
interface VadStream { push(frame: Float32Array): { speech: boolean; prob: number }; flush(): Segment[] }

interface KwsService { create(keywords: { text: string; boost?: number; threshold?: number }[]): KwsStream }
interface KwsStream { push(frame: Float32Array): { hit?: { keyword: string; score: number; atMs: number } } }

interface SpeakerService {
  embed(seg: Segment): Promise<Float32Array>;                 // CAM++，维度由模型决定
  score(emb: Float32Array, template: SpeakerTemplate): number; // 余弦相似度
}

interface Segment { id: string; startMs: number; endMs: number; pcm: Uint8Array; rms: number; snr?: number }
interface SpeakerTemplate { id: string; person: string; scene: "quiet" | "car" | "outdoor" | "other"; emb: Float32Array; createdAt: string }
```

### 2.4 现有代码需要的补缺

- `packages/core/src/runtime/attachments.ts:6-33` 的 `attachmentFromPath` 只识别图片，音频退化为 `application/octet-stream`。V1 第一项就是补 wav、mp3、m4a、opus、ogg、flac、webm 的探测，否则 ASR 工具、提示词、投递都拿不到"这是音频"的信号。
- `plugins/media-tools/src/index.ts:198-247` 的 `*_audio_transcribe` 硬编码 `protocol: siliconflow`。语音插件不改它，新工具另开；旧工具保持原样。
- 配置 schema（`packages/core/src/config/schema.ts:129-140`）的 capabilities 是否允许任意键，我只读到调研的转述，**未核实**；V1 开工先读，若是枚举则扩枚举。

### 2.5 插件落点

新建 `plugins/voice`（只依赖 `@yonder/sdk`，不 import pi 运行包）。media-tools 保持"图片与 SiliconFlow 转写"的现状，不扩张。

插件职责：

- 注册 services 的本地实现（上述 `AsrService` 等）。
- 注册语音 trigger（`api.triggers.register`，`packages/sdk/src/types.ts:340-344`）：收到完整段后 emit `message.in`。
- 注册工具：`voice_speak`（TTS，agent 主动说话）、`voice_transcribe_local`（离线转写）、`voice_enroll_start`（只引导，不自动注册）。
- 提供方法域 `voice`（见 3.6）。

## 3 流协议

### 3.1 为什么不放进 `/api/stream`

`contracts.md` §2 的流是单连接多路复用的 JSON 文本帧，慢消费者策略是"积压 1000 帧或 10 MB 则断开该 sub"（§2.4）。音频放进去有三个问题：base64 增加约 33% 带宽；音频帧速率（20 ms 一帧，50 帧/秒）会挤占会话更新；"断开重订"对实时音频没有意义。因此新增独立通道 `GET /api/audio`（WS，二进制），控制信令仍走 JSON RPC 与 `voice.watch`。

### 3.2 建立

1. 客户端调 `voice.session.open`（write），参数含用途 `mode: "call" | "ambient" | "dictation"`、采集端 `format`、绑定的 `session`（可空）。
2. 返回 `{ voiceId, audioPath: "/api/audio?voice=<id>", ticket, format, serverParams }`。`ticket` 一次性、60 秒内有效，由网关签发，沿用 `design.md` §4.2 的 Host、Origin 校验，WS 升级时校验 cookie 加 ticket。
3. 客户端连 `audioPath`。服务端回第一帧 `hello`，之后双向交换音频帧。

远程节点：同一路径经 relay 转发，沿用 `design.md` §4.3 的最低安全线；音频是对话正文级别敏感数据，经云中转时的告知文案须覆盖"音频"（见 9.3）。

### 3.3 帧格式

二进制帧，小端：

```
byte 0     type   0x01=AUDIO_UP  0x02=AUDIO_DOWN  0x03=CTRL(JSON)  0x04=MARK
byte 1     flags  bit0=keyframe  bit1=vad_speech  bit2=gap_before  bit3=eos
bytes 2-5  seq    u32，每方向每个 voiceId 内单调递增
bytes 6-9  tsMs   u32，采集端单调时钟（相对 voice 打开时刻）
bytes 10-  payload
```

- `AUDIO_UP`：采集端到节点。payload 为一个 20 ms Opus 包（16 kHz mono，约 16 kbps，约 7.2 MB/小时），或在局域网和本机下的 PCM16（32 KB/s）。codec 在 `hello` 里协商，默认 Opus。
- `AUDIO_DOWN`：节点到客户端的 TTS 音频，24 kHz PCM16 或 Opus，同样分片；`eos` 标志一句播完。
- `CTRL`：JSON 载荷，用于 `hello`、`pause`、`resume`、`barge-in`、`stats`、`error`。
- `MARK`：客户端在播放端打点（"已播放到某个 seq"），供节点计算打断时的已播放文本。

### 3.4 背压与丢帧

两个方向、两类用途分开处理：

| 场景 | 策略 |
|---|---|
| 通话上行（`call`） | 实时优先。客户端发送队列 > 500 ms 则丢最老的帧并置 `gap_before`，节点用它标记识别间断 |
| 常驻上行（`ambient`） | 不能丢段内容。客户端本地先 VAD 分段，段缓存于本地环形文件，**以段为单位**经 `attachments.put`（HTTP）补传；WS 只传实时预览帧（用于 KWS 和唤醒） |
| 下行 TTS | 节点按客户端播放进度（`MARK`）发送，领先量不超过 1 秒，避免打断时已发出大量无用音频 |
| 节点处理过慢 | 节点积压 > 2 秒音频时发 `CTRL{ error:"overload" }`，通话降级为"只做 ASR 不做声纹"，常驻转为只存段 |

### 3.5 断线与恢复

- 心跳：沿用 25 秒 `ping`/60 秒无帧断开（`contracts.md` §2.4）。通话里另外在 `CTRL` 里每 5 秒交换一次 `stats`（RTT、丢帧数、队列），用于质量显示。
- 通话断线：客户端指数退避重连（0.5 s 起，上限 8 s），带 `voiceId` 和最后确认的下行 `seq`。节点保留 voice 状态 30 秒；超时则关闭并写 `voice.state{closed, reason:"timeout"}`。重连后服务端不补发已丢的 TTS，以当前句重新播或跳过。
- 常驻断线：本地继续分段入环形文件；恢复后按段补传（`attachments.put`，幂等键用段 id）。文件上限见 5.4。
- 切换网络（手机 Wi-Fi 到蜂窝）：WS 会断，按上述重连。WebRTC 能无缝切换，但调研结论是第一阶段不上（调研 §3）。弱网下 TCP 队头阻塞会让通话卡顿，列入风险（第 11 节）。

### 3.6 控制方法与事件

新域 `voice`（需要在 `contracts.md` §1.2 的新域列表里加一行，见 11.3）：

| 方法 | scope | params | result |
|---|---|---|---|
| `voice.session.open` | write | `{ mode; session?: string; format: PcmFormat; device?: DeviceInfo }` | `{ voiceId; audioPath; ticket; serverParams }` |
| `voice.session.close` | write | `{ voiceId }` | `Ok` |
| `voice.watch` | read（流） | `{ voiceId?: string }` | `{ snapshot: VoiceSnapshot }`；易失型 |
| `voice.config.get` / `voice.config.set` | read / admin | 开关、保留期、唤醒词、阈值 | 当前配置 |
| `voice.speaker.enroll.start` / `.add` / `.finish` | write | 见第 6 节 | 注册进度 |
| `voice.speaker.list` / `.delete` | read / write | 模板列表与删除 | 同左 |
| `voice.data.purge` | write | `{ scope: "audio" \| "transcripts" \| "speaker" \| "all"; before?: string }` | `{ removed: number }` |

`voice.watch` 的事件：`voice.level`（电平，客户端本地算也行）、`voice.partial`、`voice.final`、`voice.speaker`（`verdict`）、`voice.wake`（含三态决策与理由）、`voice.tts`（`started|ended|interrupted`）、`voice.permission`、`voice.state`。其中 `final`、`wake`、`state` 同时落事件库（第 7 节），`partial`、`level` 不落库。

## 4 前端麦克风组件

### 4.1 位置与形态

调研曾建议放 `plugins/ui-companion` 的 `/mic` 路由。`design.md` §4.8 已决定删除 ui-companion 的 `service.ts` 与 `web/`，因此本设计改放 `apps/app/src/features/voice/`，随同一份前端产物发布。形态：

- **React 组件与 hook**（`apps/app` 内部使用）：`<VoiceCapture>`、`useVoice()`。
- **可嵌入页面**：`/#/embed/voice`，供不在 apps/app 内的宿主用 iframe 或 WebView 嵌入，通过 `postMessage` 交互（`{type:"voice.state"|"voice.final", ...}`）。宿主必须同源或在网关允许的 Origin 列表中，不做任意嵌入。

### 4.2 API

```ts
interface VoiceCaptureProps {
  mode: "call" | "dictation" | "ambient";
  session?: string;                       // 绑定的会话；dictation 用于填输入框
  onFinal?(r: { text: string; speaker?: SpeakerVerdict; segmentId: string }): void;
  onState?(s: MicState): void;
  deviceId?: string;                      // 默认系统默认输入
  echoCancellation?: boolean;             // 默认 true；外放通话必须开
  indicator?: "full" | "compact" | "none"; // none 仅限宿主自带指示，ambient 禁止 none
}

function useVoice(): {
  state: MicState; level: number; devices: InputDevice[];
  request(): Promise<MicState>;          // 申请权限（必须由用户手势触发）
  start(): Promise<void>; stop(): Promise<void>; pause(): void;
  speakingTts: boolean; interrupt(): void;
};
```

`indicator` 对 `ambient` 不允许关闭：常驻录音期间 UI 必须有可见指示（合规要求，见第 9 节）。

### 4.3 权限状态机

```
unknown ──request()──▶ prompting ──允许──▶ ready ──start()──▶ capturing
   │                       │                   ▲                │  ▲
   │                       └─拒绝─▶ denied     │       pause()  │  │ resume()
   │                                   │       │                ▼  │
   └─无设备─▶ unavailable              └─用户在系统设置打开─▶ paused
capturing ──系统撤销权限──▶ revoked ──重新授权──▶ ready
capturing ──设备被占/拔出──▶ interrupted ──设备恢复──▶ capturing
```

| 状态 | UI 行为 |
|---|---|
| `denied` | 显示"麦克风被禁用"和该平台的可操作路径（见 4.4），提供"重新检查"按钮；不反复弹窗 |
| `revoked` | 立即停止并明确提示，不静默失败；ambient 模式下同时发系统通知 |
| `interrupted` | 通话中提示"设备被其他应用占用"，自动重试 3 次后转 `unavailable` |
| `unavailable` | 无输入设备，隐藏通话入口，保留文字 |

所有状态变化同时 emit `voice.permission` 事件，写入 `voice.state`，便于"为什么没录到"的事后排查。

### 4.4 各端差异

| | Web（浏览器 / PWA） | Tauri 桌面 | 移动端 |
|---|---|---|---|
| 采集 | `getUserMedia` + `AudioWorklet`（不用 `setInterval`）；约束开 `echoCancellation`、`noiseSuppression`、`autoGainControl` | **Rust 侧 `cpal` 采集**，WebView 只做 UI 与播放；采集帧经 Tauri 事件或本机 loopback WS 送节点 | V3 起：Android 前台服务原生采集；iOS 待评估。PWA 仅限前台"按住说话" |
| 权限 | 浏览器弹窗；仅安全上下文（HTTPS 或 `127.0.0.1`）可用 | macOS：`NSMicrophoneUsageDescription` + TCC；可复用 `packages/macos-helper` 的权限引导；Windows：隐私设置里两处开关 | Android：`RECORD_AUDIO` + `FOREGROUND_SERVICE_MICROPHONE`；iOS：`NSMicrophoneUsageDescription` |
| 后台 | **不做常驻**。后台标签定时器被节流，内存节省会丢弃标签（调研 §8）；监听 `visibilitychange`、`track.onended` 做恢复提示 | 可常驻（见第 5 节） | 取决于平台，见第 5 节 |
| 回声 | 浏览器 APM | 需要 AEC：先试系统级语音处理（macOS 的 voice-processing I/O）；不行再接 `webrtc-audio-processing` 绑定 | 系统通信模式的 AEC |
| 降级 | 无 Worklet 时退到 `MediaRecorder` 分块，只支持 dictation | — | — |

关键点：Tauri 下麦克风**不交给 WebView**。这样既绕开 WKWebView 与 WebView2 的权限差异，也避开后台节流（调研 §8）。V1 需要做一次 Tauri 采集 spike；如果桌面壳尚未上线（`design.md` 阶段 6），V1 先用浏览器采集，Tauri 采集随壳到位后替换，组件 API 不变。

## 5 常驻录音与唤醒

### 5.1 模式

只有两种语音模式，**都全量录音**，共用同一条采集与存储管道，区别只在是否默认唤醒：

- **录音机模式**（常驻，V2 起）：持续记录现场所有人声。说话人分离与声纹只用于标注"是谁"，不筛掉任何人的录音。需要 Bot 时说唤醒词，像 Siri 一样即时响应，响应结束回到录音。
- **AI 语音通话**（V1）：用户点击后建立 `call` voice session，建立即唤醒所选 Bot，全程录音，前台有界面，延迟目标 ≤ 1.5 s。

录音期间界面常驻录音标识，不可关闭。首次开启录音机模式时提示告知义务：录到他人声音时须告知在场人员（见 6.5、9.2）。

### 5.2 常驻流水线

```
麦克风 → AEC/APM → [边缘：Silero VAD + 30 s 环形缓冲] → 仅说话段上行
        → 节点：KWS（对上行预览帧）→ 声纹门控 → 启发式 → 文本模型 → wake/log_only/ignore
```

边缘门控只做 VAD 与环形缓冲，不做声纹、KWS 之外的任何判断。依据：决定 4 要求完整节点负责识别与决策；VAD 级门控只是为了不把静音和噪声上传，节点上仍可复核。当采集端与完整节点同机（macOS V2），边缘门控就是节点本身，没有网络。

没有说话时不向节点发音频。唤醒词在节点侧对上行预览帧运行；要降低手机耗电，Android 可把 KWS 放在设备侧（同一 sherpa-onnx 的 Android 库），命中后才上行。这是 V3 的优化，不在 V2 范围。

### 5.3 平台做法（按定序 macOS → Android → iOS → 眼镜）

| 平台 | 做法 | 状态 |
|---|---|---|
| macOS | 常驻进程用 `AVAudioEngine` 采集，TCC 授权；撤销权限可检测并提示。沿用 `packages/macos-helper` 的权限流程；Tauri 壳上线后改为壳内 Rust 采集 | V2 |
| Windows | 共享模式 WASAPI，避免独占；检测系统禁用并提示 | V2 之后，随桌面壳 |
| Android | 前台服务（`foregroundServiceType=microphone`）+ 常驻通知；被杀后自动恢复的守护逻辑；国产 ROM 引导白名单 | V3 |
| iOS | 后台音频模式审核风险最高。不做"无声常驻"，只做用户显式开启的记录模式（会议、骑行）加常驻 UI 指示 | V4 之后评估，先拿 TestFlight 反馈（spike S7） |
| 浏览器 | 不做常驻 | — |

Android 14+ 前台服务限制（须在应用可见时启动）和 Android 15 的收紧是实现约束；具体厂商保活行为只能真机测（S6）。

### 5.4 本地缓冲与保留

- 边缘环形缓冲：30 秒内存，不落盘；命中门控后才写段文件。
- 本地段文件：Opus，设备端上限默认 500 MB 或 24 小时（先到者），超限丢最老且记录一条 `voice.state{dropped}`。
- 原始音频默认永久保留，保留期下限可配置为 7 天；转录文本的保留期单独配置（见 7.3）。
- 可清理内容（原始音频、无引用片段）超过阈值（默认 20 GB，或磁盘可用空间 < 10%）时，每天最多一次向管家注入一条提示。管家可以提醒主人清理，也可以按引用、标注和摘要自行判定不重要的片段并清理（L1，可审计，7 天内可撤销）。

### 5.5 唤醒词

- 引擎：sherpa-onnx KWS，中文预训练模型加 `keywords.txt`，换词免训练（调研 §4）。默认词待主人选定，**不预设品牌词**。
- 唤醒词按 Bot 配置：每个 Bot 有自己的唤醒词（`agents/<id>.yaml` 的 `voice.wakeWords`），KWS 同时加载所有启用 Bot 的词，命中哪个就唤醒哪个 Bot。
- 命中后经声纹门控：只有已登记声纹的人能用唤醒词触发 Bot。KWS 命中后对前后约 2 秒语音做一次 embedding，低于门限则不唤醒（录音照常），压制"别人喊你名字"的误唤醒。未登记任何声纹时跳过该门控。
- 命中反馈：必须有可感知的确认（提示音或指示灯），既是产品需要，也是录音告知的一部分。

### 5.6 电量与误唤醒指标

| 指标 | 目标 | 测法 |
|---|---|---|
| 误唤醒 | ≤ 1 次 / 24 h（常驻验收）；spike 阶段 ≤ 1 次 / 4 h | 真机长跑，安静与嘈杂各一轮 |
| 唤醒漏报 | 10 次里漏 ≤ 1 次 | 主人自测 |
| 常驻 CPU | VAD < 1%，KWS < 3%，合计 < 5% 单核（macOS） | 活动监视器采样 |
| 手机 8 h 耗电 | < 15%（Android） | 真机，关屏 |
| 内存 | 节点语音插件常驻 < 300 MB | 进程采样 |
| 24 h 中断 | ≤ 1 次且自动恢复（Android） | 国产 ROM 真机 |

以上数值来自调研 §13 的判定标准，属于**目标**而不是已测事实；V0 spike 的任务就是把它们变成实测值，未达标时回头改本节。

### 5.7 自主唤醒（两级）

**第一级：规则门控**，全部在本地、零成本，按顺序短路：

1. VAD 判有人说话，连续语音 ≥ 3 秒（可配置）。
2. 声纹判是已登记的人（未注册声纹时本级不开放，见下）。
3. 环境音类别（可选，YAMNet 类模型，V3 才接）：安静 / 街道 / 会议 / 车内。
4. 时段与日程：免打扰时段直接降为 `log_only`。
5. 当前状态：正在通话、正在跑任务、用户在前台输入时，不打断。

任一步不满足则丢弃，不调用模型，也不保留音频。

**第二级：文本模型三态判断。** 输入是结构化摘要，不含原始音频：

```ts
interface WakeContext {
  time: { local: string; daypart: "morning"|"work"|"evening"|"night"; dnd: boolean };
  audio: { speechSec: number; speaker: "owner"|"unknown"|"mixed"; envClass?: string };
  transcript: string;                 // 最近 30 秒本地 ASR 文本
  lastInteractionAgoSec: number;
  activity: { inCall: boolean; runningTasks: number; foregroundApp?: string };
}
type WakeDecision = { action: "wake" | "log_only" | "ignore"; reason: string };
```

- `wake`：把这段话作为 `message.in` 交给 Agent，并按用户设置决定是否语音回应。
- `log_only`：只写转录事件，不打断（骑车断续短句、路演现场记录）。
- `ignore`：丢弃，不留任何记录。
- 判断模型：配置里最便宜的文本模型，单次输入约 300 到 600 token（调研 §5 的数量级，未核价）。调用节拍由门控触发，不轮询。
- 模型不可用或超时：降级为 `log_only`，不降为 `wake`。宁可记录不打断。
- 判断记录（含理由）落 `voice.wake` 事件，便于事后在设置里查看"为什么叫醒我"并反馈。反馈（"不该叫醒"）作为后续阈值调整依据，V3 先只记录，不做自动学习。

**默认强度。** 自主唤醒默认只记录（`log_only`），不主动说话；用户在设置里主动升级。

**有声纹与无声纹的差别。** 未注册声纹时无法区分主人与旁人，此时系统只允许"KWS 唤醒"和录音，**不开放自主唤醒**。已登记声纹是自主唤醒的前置条件。

## 6 说话人与唤醒资格

### 6.1 四级流水线

1. VAD 切片（Silero）。
2. 声纹标注与唤醒门控：每段计算 CAM++ embedding，与已登记模板取最大余弦相似度。结果用于标注"是谁"，并决定该段能否触发唤醒词；不决定是否录音。
3. 拒识：落在"像但不确定"区间的段，用更长窗口和更严阈值复核；仍不确定则不给唤醒资格，标为未识别。
4. TSE（目标说话人提取）：不进 V1 到 V3，列为 V4 后评估（需要 GPU 与中文微调数据，调研 §7）。重叠语音在此之前一律按"不确定"处理：不给唤醒资格，录音保留，不尝试分离。

diarization（多说话人区分）只用于**离线归档重处理**，不进实时路径。使用 sherpa-onnx 的 pyannote 分割模型前须先核对权重许可（见 9.5）；许可不明确则 V4 前不启用 diarization，仅用"已登记 / 未识别"二分标注。

### 6.2 注册流程

1. 设置页进入"声音注册"，先显示告知与单独同意（声纹是敏感个人信息，见 9.2），勾选后才进入下一步。
2. 分场景录入：安静室内（必选）、车内、户外（可选）。每场景录 3 到 5 句、每句 3 到 5 秒，界面显示信噪比，过低则要求重录。
3. 每条样本计算 embedding，检查样本间一致性（互相余弦均值低于 0.5 视为异常，提示重录）。
4. 保存模板到本机加密文件 `<home>/.yonder/speaker/templates.enc`，密钥放系统钥匙串（macOS Keychain）。模板不进事件库、不进日志、不随备份上传。
5. 注册后做一次自检：让用户再读一句，显示通过与否。
6. 可补录：在门控表现不佳的场景（比如车内总被拒）追加该场景模板。

TTS 音色克隆：只允许克隆**主人本人**音色，须单独同意并保存授权记录（调研 §2）。第三方音色一律走供应商预置音色。该功能不属于 V1 到 V3 范围。

### 6.3 门控阈值与滞回

| 参数 | 初始值 | 说明 |
|---|---|---|
| `accept` | 0.60 | 余弦相似度高于它直接通过，进入下游 |
| `reject` | 0.40 | 低于它直接丢弃 |
| 中间区 | 0.40 到 0.60 | 复核：取该段前后相邻同一人段的得分，用滞回——上一段通过则本段按 `reject` 判，否则按 `accept` 判 |
| 最短有效段 | 1.0 秒 | 太短的段 embedding 不稳，一律按"不确定"丢弃 |
| 复核窗口 | 3 秒 | 复核用更长窗口重算 |

这些是**起始值，不是结论**：CAM++ 的余弦分数分布取决于具体模型与录音条件，必须在 S4 用主人真实录音与他人录音标定。验收标准按结果表述：主人通过率 ≥ 95%，他人误通过 ≤ 5%（跨室内、车内、户外各自统计），数值不达标则调阈值或补录模板，而不是放宽标准。

### 6.4 失败处理

| 情形 | 处理 |
|---|---|
| 未注册声纹 | 不开放声纹唤醒门控与自主唤醒；录音照常，片段标为未识别 |
| 嗓音变化（感冒、疲劳） | 连续 N 次（默认 5）被拒识且 KWS 命中，提示"是否补录一条"，不自动更新模板 |
| 场景模板缺失（车内） | 该场景通过率低时提示补录；不自动降阈值 |
| 重叠语音 | 不给唤醒资格，录音保留，记 `voice.state{overlap}` 计数 |
| 声纹服务出错或超时 | 唤醒门控 fail-closed（不唤醒），录音照常，片段标为未识别 |
| 模板损坏或密钥丢失 | 声纹功能停用并提示重新注册，原有已存转录不受影响 |
| 他人使用主人录音冒充 | 声纹**不防回放攻击**；声纹通过不放宽审批（1.5），这是已知限制，写进用户说明 |

### 6.5 多人场景的产品边界

录音机模式记录现场所有人声，包括他人。因此：界面常驻录音标识；首次开启时提示告知义务，由主人在场合告知在场人员；他人的片段在说话人分离后标为"说话人 A/B"（已登记声纹的人显示其名字），不尝试把未登记者的声音与任何身份关联，也不为未登记者保存声纹。

## 7 存储、事件与检索

### 7.1 事件

写入口只有事件系统。沿用事件只追加原则（`contracts.md` §0.3）：

| 事件 type | 数据 | 说明 |
|---|---|---|
| `message.in` | `text` + `attachments:[{kind:"audio",...}]` | 唤醒后与对话类输入；这是进入 Agent 的唯一方式 |
| `voice.segment` | `{segmentId, startMs, endMs, speaker:{verdict,score}, lang, text, audio?: Attachment}` | `log_only` 与归档的记录单位 |
| `voice.wake` | `WakeDecision` + 摘要上下文 | 为什么叫醒或没叫醒（`ignore` 不写） |
| `voice.state` | `{voiceId, state, reason}` | 权限变化、中断、丢帧、过载 |

事件里**不写**声纹 embedding、原始 PCM 或第三方说话人的任何生物特征。分数只写 `score` 一个数。

### 7.2 附件

音频以 `Attachment{kind:"audio"}`（`packages/sdk/src/types.ts:32-38`）存放，上传走 `attachments.put`（`contracts.md` §1.3），返回的 `uri` 放入事件。常驻补传的幂等键用段 id。V1 先修 MIME 探测（2.4）。

### 7.3 保留期

| 数据 | 默认 | 可配置 | 删除路径 |
|---|---|---|---|
| 原始音频段 | 永久保留 | 下限 7 天；超阈值由管家提示或清理（5.4） | `voice.data.purge{scope:"audio"}`，同时清理附件文件 |
| 转录文本事件 | 随普通事件 | 可单独设更短 | `scope:"transcripts"`（事件只追加，因此删除是对转录类事件的显式清理，须在 `docs/spec` 里明确"允许按保留策略删除的事件类型"，见 11.3） |
| 声纹模板 | 直到用户删除 | — | `scope:"speaker"` 或设置页删除，立即生效，同时删除钥匙串条目 |
| `voice.wake` 理由 | 30 天 | 可配置 | `scope:"all"` 覆盖 |

删除操作要有二次确认，并写一条不含内容的审计事件。

### 7.4 检索

- 转录在事件库中，可用 `events.query` 的时间范围、类型过滤，以及后续的全文检索。
- 语音检索只提供：按时间、按说话人 verdict、按关键词，不做向量库（不在本设计范围）。
- 需要语义检索时，由 `plugins/memory` 的现有机制消费转录事件，语音插件不自己做 embedding。

### 7.5 与记忆插件、笔记的关系

- **记忆插件**：语音不直接写记忆。`wake` 产生的对话进入会话，由记忆插件按它自己的规则处理；`log_only` 的转录对记忆插件可见但默认不纳入，除非用户设置"把语音记录纳入记忆候选"。这样避开 Hermes 式的"无用记忆堆积"（见 [agent-parity.md](agent-parity.md) §9 与 research/G2-memory.md 对记忆堆积的分析）。
- **笔记**：随口灵感（骑车、路演场景）的归宿是笔记，但"写进哪本笔记"是 Agent 的任务，不是语音层的职责。流程：`wake` 或 `log_only` 事件到达 → Agent 判断是否需要记笔记 → 用既有的笔记工具写入。语音层不直接写 Obsidian。
- 与 `wechat-archive` 等归档类插件无直接关系，不复用其存储。

## 8 眼镜与视觉

### 8.1 原则

眼镜是又一类采集节点，不单独设协议。能力矩阵不同，所以接入顺序按"开放程度"而不是品牌：

| 平台 | 角色 | 路径 |
|---|---|---|
| 雷鸟 X3 Pro 等独立 Android 眼镜 | 隐藏最优解：就是一台 Android 节点 | 复用 V3 的 Android 采集与前台服务，S11 验证 |
| Brilliant Labs Frame/Halo | 原型 | BLE 音频 + 相机，经手机或电脑中继到网关；BLE 带宽有限，只做短时对话与拍照（S9） |
| Meta Ray-Ban（DAT） | 产品期首选 | 手机 App 经 Meta DAT 取音频与视频，再接入网关；preview 状态、组织审核、遥测条款是门槛（S10） |
| Rokid | 视真机而定 | 眼镜端 AI 可能独占麦克风，需实测 |
| Xreal | 不适用 | 无开放麦克风与摄像头 |

不预先抽象多品牌 SDK 统一层（xg-glass-sdk 的接口表多数为空，调研 §9），每个平台只写一个"适配器"，输出同一种 `AudioFrame` 和 `ImageFrame`。适配器放在手机或电脑上的 Yonder 采集 App 里，不进内核。

### 8.2 视觉能力

新增 `vision` capability：

```ts
interface VisionService {
  describe(img: ImageInput, opts: { model: string; prompt?: string; signal: AbortSignal }): Promise<{ text: string }>;
}
interface ImageInput { mime: "image/jpeg"; bytes: Uint8Array; capturedAt: string; source: "glasses" | "phone" | "desktop" }
```

走视觉模型端点，使用已有模型能力（pi-ai 已支持 `image` 输入，调研 §10.1）；这是对话类调用，直接作为带图片附件的消息交给 Agent 即可，**不需要**单独的识别服务。`vision` capability 只在需要"不经 Agent 的快速识别"（如拍照后立即给一句描述）时才使用，V4 才评估是否必要。

### 8.3 拍照与视频

- **拍照**：由语音指令或眼镜按键触发，单帧 JPEG，经 `attachments.put` 上传，作为 `message.in` 的 image 附件。成本低，V4 首先做。
- **视频流与实时识别**：成本和隐私风险都最高（持续拍摄他人）。V4 只做"按需抽帧"——Agent 或用户触发时取一帧，不做持续视频上传。连续视频识别列为开放问题，不在本版范围。
- 拍摄指示：适配器要求设备有可见拍摄指示灯，没有指示灯的设备不允许接入连续视频。
- 图像默认只在本机处理和保存，保留期同音频；发给云端视觉模型前须在设置里有明确开关（与云端 ASR 同样处理，见 9.2）。

### 8.4 眼镜上的语音

眼镜通常距离嘴近、环境噪声大、扬声器小。因此眼镜模式：默认开声纹门控；TTS 回复短句化（提示词层处理，不在语音层改文本）；通话 AEC 由设备自身提供时关闭节点侧重复处理。

## 9 隐私、合规与许可

### 9.1 默认值

- 录音默认只在本地处理：VAD、KWS、声纹、本地 ASR 都不出机。
- 使用云端 ASR 或 TTS 时，首次需用户明确确认"音频将发送给 <供应商>"，并在 `voice.config` 里显示当前使用的云端端点；`--dry-run` 能列出本次对话会调用哪些外部端点（调研 §12 第 8 项）。
- 声纹 embedding 永不上传，`speaker`、`vad`、`kws` 只允许本地协议（2.1）。
- 常驻录音默认关闭，需在设置里显式开启；开启时展示一次完整告知。
- 日志与事件中不得出现原始音频、声纹和凭据；`voice.state` 只记状态。

### 9.2 中国法律的落点

下表是对调研 §8 的产品化，**不是法律意见**；上架国内应用商店或面向第三方用户分发前，须另做合规审查。

| 要求 | 设计落点 |
|---|---|
| 个人信息保护法第 17 条：告知处理目的与方式 | 开启常驻前的告知页：录什么、在哪处理、保留多久、如何删除 |
| 第 14 条与第 28 条：声纹为敏感个人信息，需单独同意 | 声纹注册前单独的同意步骤，与常驻录音的同意分开；同意记录写审计事件 |
| 第 26 条：公共场所采集他人图像与身份特征 | 录音机模式录到他人声音，须界面常驻录音标识并告知在场人员（6.5）；不为未登记者保存声纹；眼镜连续视频不开放 |
| 深度合成规定、AI 生成内容标识办法 | TTS 输出标识为 AI 合成（界面标注，音频附件元数据标识）；克隆音色仅限主人本人且单独同意 |
| 一键删除与导出 | `voice.data.purge` 与设置页入口；导出事件走既有导出能力 |
| 录音指示 | 常驻期间 UI 常驻指示，不可关闭；命中唤醒有提示音；眼镜要求指示灯 |

### 9.3 经云中转的告知

沿用 `design.md` §4.3 的"首次选择经云中转时弹一次确认"。语音需要把文案扩到"音频与转录"：中转运营方在技术上能读取传输内容（spec 18 §1 不宣称端到端加密）。在端到端加密就绪之前，**常驻上行默认不经云中转**，只允许直连或自建 relay；通话可经云但须有告知。

### 9.4 删除与数据主权

四类数据各有独立删除路径（7.3），声纹立即物理删除。备份不包含声纹模板和原始音频。

### 9.5 许可

| 组件 | 许可 | 结论 |
|---|---|---|
| sherpa-onnx、CAM++、WeSpeaker、RNNoise、DeepFilterNet | Apache-2.0 / MIT / BSD | 可用 |
| Silero VAD | MIT | 可用 |
| Piper（新仓 `piper1-gpl`） | GPL-3.0 | **不采用**，Yonder 根包是 Apache-2.0 |
| TEN VAD | Apache-2.0 + 禁止与 Agora 竞争条款 | **不采用** |
| pyannote 权重（含 sherpa-onnx 的 segmentation 导出） | 权重另受条款约束 | **不采用**，直至核实商用条款 |
| Porcupine | SDK 与模型受 Picovoice 条款约束 | 不采用 |
| 模型文件（zipformer、VITS 等） | 各模型自带许可 | 随下载记录许可到 `THIRD_PARTY_NOTICES.md`，不随仓库分发模型 |

## 10 阶段计划

通用验收原则：用真实模型和真实设备，不用 mock。需要云端的验收若缺凭据，标"未测"并写明，不用伪造响应通过。涉及文本模型的测试默认用 `openai/gpt-6-luna`（`AGENTS.md` 第 4 条）。"建议执行模型"按档位给出，由派工时选具体型号。

### V0 spike：真机回答未知

**改动范围**：不改主干代码。在 `proposals/` 或独立 spike 目录写脚本，结果写入报告。
**内容**：调研 §13 的 S1 到 S6、S8、S12 优先（macOS 与一台 Android）；S7、S9 到 S11 并行但不阻塞 V1。重点：
- S1 sherpa-onnx-node 流式 ASR 在 macOS arm64 的 RTF、内存、首包；
- S2 KWS 自定义词误唤醒；
- S3 外放 AEC 与打断；
- S4 CAM++ 跨场景标定，产出 6.3 的真实阈值；
- S8 Omni 接入，仅回答"值不值得做并行前端"。

**验收**：每个 spike 有实测数据和是否达标的结论，未达标项写明替代方案。本文第 5.6、6.3 的目标值据此修订。
**建议执行模型**：中档编码模型跑脚本与数据收集，强推理模型做结论汇总；需要真人录音和真机，由主人配合。

### V1：macOS 点按语音通话

**改动范围**：
- `packages/core/src/runtime/attachments.ts`：音频 MIME 探测（及其单测）。
- `plugins/voice`：本地 `asr`、`tts`、`vad` 的 service 实现，voice trigger，`voice_speak` 工具。
- `packages/gateway`：`/api/audio` WS、`voice.session.*`、`voice.watch`。
- `apps/app/src/features/voice/`：`<VoiceCapture>`，权限状态机，浏览器采集，AEC。
- `configs`：`protocol: local` 的 services 配置。
**不含**：唤醒词、常驻、声纹、眼镜、Tauri 采集。

**验收（真实运行）**：
1. `sessions submit --attachment x.m4a` 灌入音频，事件里 `kind==="audio"` 且 `mime` 正确；
2. 本机浏览器点按通话，说一句中英混说的话，会话里出现带 audio 附件的 `message.in`，Agent 回复引用转录内容；
3. 回复由本地 TTS 播出，说完到听到首包 ≤ 1.5 s（目标），外放连续 30 分钟无自激；
4. 说话时点打断，TTS 在 300 ms 内停；
5. 断网 10 秒再恢复，通话自动重连，且事件库中转录不重复不丢；
6. 拒绝权限后给出可操作提示，不反复弹窗；
7. 日志中没有原始音频；`--dry-run` 能列出外部端点。

**建议执行模型**：强推理模型负责网关协议与状态机，中档编码模型负责组件与插件实现。契约变更项（第 11.3）须先获批再编码。

### V2：macOS 常驻、唤醒词与声纹

**改动范围**：`plugins/voice` 增 `kws`、`speaker` 实现；macOS 常驻采集（独立进程，沿用 macos-helper 权限流程）；`voice.speaker.*`；声纹加密存储；保留期清理任务；设置页的告知、开关、注册。
**验收**：
1. 常驻 24 小时，误唤醒 ≤ 1 次，唤醒漏报 10 次里 ≤ 1 次（真机、含安静与嘈杂）；
2. 声纹在室内、车内（或模拟车内）、户外三场景：主人通过率 ≥ 95%，他人误通过 ≤ 5%；
3. 撤销麦克风权限后，界面和通知明确提示，不静默；
4. 常驻 CPU < 5% 单核，内存 < 300 MB；
5. 调用 `voice.data.purge` 后，对应音频文件、钥匙串条目确实不存在（直接查文件系统）；
6. 声纹未注册时，声纹唤醒门控和自主唤醒不可用，录音照常，界面有说明。

**建议执行模型**：强推理模型做隐私与存储实现与审查（涉及敏感数据），中档模型做 UI 与采集。

### V3：自主唤醒与 Android

**改动范围**：规则门控与文本模型三态判断（`voice.wake`）；环境音分类（可选）；Android 前台服务采集 App；设备端 KWS 选项；`ambient` 补传。
**验收**：
1. 人工标注 200 个场景，三态判断准确率 ≥ 85%，单次成本 < ¥0.01（需核实当期价目）；
2. 路演类场景（嘈杂加主人讲话）判 `wake` 或 `log_only` 的召回按标注集统计；骑车类（风声加断续短句）判 `log_only`；
3. Android 8 小时耗电 < 15%，24 小时中断 ≤ 1 次且自动恢复（至少两个厂商 ROM）；
4. 模型不可用时降级为 `log_only` 并有日志可查。

**建议执行模型**：强推理模型设计门控与评测集，便宜模型作为被评测对象；Android 原生部分由熟悉 Android 的编码模型执行，真机验收由主人配合。

### V4：眼镜与视觉

**改动范围**：适配器（Brilliant Labs 原型，视真机结果加 Meta DAT 或雷鸟）；拍照与按需抽帧；`vision` 的使用方式确定；眼镜隐私指示规则。
**验收**：
1. 眼镜音频连续 30 秒以上不丢包，延迟 < 500 ms，送入 ASR 得到正确转录；
2. 语音指令触发拍照，图片以 image 附件进入会话，Agent 能描述内容；
3. 不具备指示灯的设备被拒绝连续视频；
4. 图像与音频同样遵守保留期与云端开关。

**建议执行模型**：中档编码模型做适配器；各平台条款与审核由人确认。

### V4 之后单独评估

iOS 常驻（取决于 S7 审核反馈）、TSE、diarization、WebRTC 与 LiveKit（跨网通话质量不满足时再上）、Omni 并行前端（取决于 S8）。

## 11 风险与开放问题

### 11.1 技术风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 外放 AEC 在 Tauri 与 Node 路径下效果不足 | 通话自激 | S3 先测；退路是通话默认建议耳机，外放时降低 VAD 灵敏度 |
| 弱网下 WS 队头阻塞使通话卡顿 | 手机跨网体验差 | 先局域网和本机；不达标再评估 WebRTC（调研 §3） |
| 声纹跨场景漂移 | 主人被拒识，体验差 | 分场景模板，fail-closed 但提示补录；S4 标定 |
| 常驻功耗与厂商保活 | 手机不可用 | S5、S6 真机；设备端 VAD、KWS 减少上行 |
| sherpa-onnx-node 在目标平台的稳定性 | 本地引擎不可用 | S1 先测；云端兜底保证降级可用 |
| 云端价目与单价未核 | 成本估算不可靠 | 正式设计前核对官方价目 |
| 模型下载体积与首次启动体验 | 首次使用慢 | 按用途分包、显示进度、可断点续传 |

### 11.2 合规与外部依赖风险

- iOS 后台音频的审核（S7）与国内应用商店对"随身录音"的审查口径，本文**未核实**。
- Meta DAT 处于 preview，条款和遥测可能变化。
- 声纹不防回放；1.5 节已限定其权限，仍须在用户说明里写清。
- 经云中转当前不是端到端加密，故常驻上行默认禁止经云（9.3）。

### 11.3 需要维护者批准的设计变更

按 `AGENTS.md` 第 7 条，以下改动属于设计变更，批准前不动代码：

1. `docs/spec/07-runtime.md` §6.3：`ServiceEndpoint` 增加 `protocol: local`、`engine`，`baseUrl` 可选；新增 capability `vad`、`kws`、`speaker`、`enhance`、`vision` 及"仅本地协议"约束。
2. `contracts.md`：新增方法域 `voice`（§1.2 的新域列表）；新增二进制音频 WS `/api/audio`，与 §2 的 JSON 流并列。
3. 事件库允许按保留策略删除 `voice.*` 与音频附件（现有口径为"事件只追加"），需在 spec 明确可删除的类型与审计要求。
4. `docs/decisions.md`：记录"语音走 services，不扩 pi-ai provider"和"级联为主、Omni 为 spike"。
5. `docs/architecture.md` 第 5 节不变量与"声纹模板单独存储"的关系需核对；本文判断它不违反不变量，但**我没有重读该节全文**，批准前请维护者确认。

### 11.4 开放问题（仅产品偏好）

**经云中转时，通话音频是否允许？** 主人未答，按 9.3 默认。影响：手机在外网使用的体验。允许则运营方技术上可读音频；不允许则手机外网只能走自建 relay 或直连。当前默认：通话允许，但每次首次连接弹告知；常驻上行不允许；端到端加密就绪后再放开常驻。

（默认唤醒词、原始音频保留期、自主唤醒强度、是否记录他人声音，已由主人在 10-28 决定，见 5.1、5.4、5.5、5.7。）

## 12 决定记录

- 10-28：唤醒词按 Bot 配置（`agents/<id>.yaml` 的 `voice.wakeWords`），KWS 同时加载所有启用 Bot 的词，命中哪个唤醒哪个。原「单一唤醒词」作废。
- 10-28：原始录音默认永久保留（下限可配 7 天），取代 72 小时默认；超阈值（20 GB 或磁盘可用 <10%）每天最多一次提示管家，管家可提醒或按引用、标注、摘要自行清理（L1，可审计，7 天可撤销）。
- 10-28：自主唤醒默认只记录，不主动说话。
- 10-28：只有两种语音模式（录音机、AI 语音通话），都全量录音，共用采集与存储管道；声纹仅用于标注与唤醒资格，不再「只记主人」；会议录他人声音须界面常驻录音标识并在首次开启时提示告知义务。
- 10-28：云中转通话音频未答，按 9.3 默认。
