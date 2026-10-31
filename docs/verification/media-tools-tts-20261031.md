# media-tools TTS 接入与验收

日期：2026-10-31。范围：在 media-tools 里补齐语音合成工具，让 Yonder 的 Agent 能通过已配置的服务把文本变成可播放音频，并用真实付费调用验收。

## 决策与边界

此前 `docs/spec/11-official-plugins.md` §9 以「CosyVoice2 收费、未获付费调用授权」为由不接入 TTS。主人随后要求补齐并实测，授权该付费调用。

首版按硅基流动的 HTTP `POST /audio/speech` 实现并实测，首包约 1.3 秒。继续测同一台机器上的阿里百炼后发现：WebSocket 双工协议首包约 0.5 秒，且单价低五倍（1 元/万字符 vs 5 元/万字符）。故工具只接受 `protocol: dashscope`，其他协议在建立连接前即返回 `MEDIA_UNSUPPORTED_PROTOCOL`，不保留 HTTP 兜底——同一条工具路径若有两种延迟和两种计费，使用者无法预期。

边界不变：模型与音色只能取自该端点声明的清单，未指定取首项；不自动切换供应商或收费模型；不重试、不缓存、不建产物数据库；视频仍不接入。TTS 是付费调用，工具说明如实告知计费方式。

## 实现

`plugins/media-tools/src/index.ts` 新增 `media-tools_audio_speak`：

| 项 | 值 |
|---|---|
| 参数 | `text`（必填，非空，≤2000 字符）、`model`、`voice`、`speed`（0.5–2） |
| 能力 | `network`、`write` |
| 服务解析 | `api.services.resolve('tts')`，要求 `protocol: dashscope` |
| 协议 | `wss://…/api-ws/v1/inference`，`run-task` → `task-started` → `continue-task` + `finish-task` |
| 音频 | 二进制帧，按 `header.task_id` 对账后累加 |
| 产物 | `artifacts/speech-<UUID>.<ext>`，`kind: "audio"` |
| 上限 | 响应体 20 MiB；整次请求 120 秒 |
| 失败 | `MEDIA_<REASON>: stage=<configuration\|synthesis\|save>`，不输出供应商正文或凭据 |

容器按真实文件头判定（ID3/MPEG 帧同步 → mp3、RIFF/WAVE → wav、OggS → ogg），不信任协议声明。`task-failed`、超时、任务未启动分别报错，不当作空结果。

## 源码契约检查

- `npx tsc -b plugins/media-tools`：通过。
- `node plugins/media-tools/check.mjs`：`checkPlugin` 返回空数组；15 项参数/配置/取消契约通过（新增 6 项：空文本、额外字段、speed 越界、speed 非数字、未配置服务、已取消信号；另加 1 项「非 dashscope 协议被拒绝且未建连」）。此步不发任何合成请求。
- `npx vitest run plugins/media-tools`：1 文件 1 测试通过。

## 真实付费调用验收

home：`/Users/zoran/Documents/yonder/.yonder/home`（仓库内开发 home，`.gitignore` 忽略）。凭据 `dashscope` 取自百炼 CLI 控制台登录后创建的 Key；服务声明：

```yaml
services:
  - id: dashscope
    protocol: dashscope
    baseUrl: https://dashscope.aliyuncs.com/api-ws/v1/inference
    credential: dashscope
    capabilities:
      tts:
        models: [ cosyvoice-v3-flash ]
        voices: [longanhuan_v3, longjielidou_v3, longling_v3, longxiaochun_v3, longanyang]
```

`yonder doctor` 通过。用只 offer `media-tools_audio_speak` 的临时 task 预设，经真实内核与 `openai/gpt-6-luna` 调用：

| 输入 | 模型/音色 | 产物 | 字节 | 实测 |
|---|---|---|---:|---|
| 你好，我是你的语音助手。 | cosyvoice-v3-flash / longanhuan_v3 | `speech-1ec57b9b-….mp3` | 50,491 | 24 kHz 单声道 2.52 s，peak 0.507 |

`afinfo` 确认为 MPEG ADTS layer III / 24 kHz / 单声道；用 SenseVoiceSmall 反向转写核对为「你好，我是你的语音助手。😊」，与原文逐字一致。从内核事件日志反算的工具耗时（上一轮 toolUse 结束 → 下一轮生成开始）为 **1169 ms**。

## 延迟实测

接口层直测，每项 5 次取中位数，已预热：

| 文本 | 字符 | 首包 | 总耗时 |
|---|---:|---:|---:|
| 好的。 | 3 | 531 ms | 563 ms |
| 你好，我是你的语音助手。 | 12 | 501 ms | 1014 ms |
| 今天的日程安排已经发到你的邮箱，请查收。 | 20 | 494 ms | 1430 ms |

9 次采样（12 字）：440、520、544、546、570、641、858 ms —— min 440 / median 525 / max 858，单峰无长尾。

音色首包差异（12 字附近）：`longling_v3` 342 ms、`longjielidou_v3` 346 ms、`longxiaochun_v3` 385 ms、`longanhuan_v3` 571 ms、`longanyang` 1511 ms。

云协议限制：限速参数名是 `rate`，`speed` 被静默忽略（实测两者分别返回 34,171 / 50,491 字节）。

### 与硅基流动的对比

| | 首包 | 协议 | 单价 |
|---|---:|---|---:|
| 硅基 CosyVoice2 | ~1300 ms | HTTP 单向，整段返回 | 5 元/万字符 |
| 阿里 cosyvoice-v3-flash | **~500 ms** | WebSocket 双工，真流式 | **1 元/万字符** |

### 与模型链路的对比

同一份内核日志里 `openai/gpt-6-luna` 的首个文本增量（n=34）中位数 **4887 ms**，p10 2302 ms，p90 14155 ms。TTS 的 0.5 秒只占整轮延迟的一小部分，主要瓶颈仍在模型。

## 未测

- 没有做人工试听；只做了文件可解码性与反向转写核对。
- 没有在飞书/微信等渠道客户端上验证音频气泡的实际播放（飞书可播放音频要求 Ogg/Opus，本工具输出 mp3，属文件附件）。
- 没有测量并发、限流与长文本（接近 2000 字符）的稳定性。
- `cosyvoice-v3.5-flash`、`qwen-audio-3.1-tts-flash` 在百炼新 Key 下能通过鉴权，但引擎返回 418/411，未接入；`qwen3-tts-flash-realtime` 已实测可用（首包 525–635 ms），本轮未接入。
- 网络路径已另行核对：`api.siliconflow.cn` 与 `dashscope.aliyuncs.com` 均命中 Clash 分流规则的 `DIRECT`，TLS 握手 74–104 ms，非海外节点。
