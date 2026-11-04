# Yonder 连接器：会话驱动适配层（spec 23 §4：会话方法集中在单个适配文件）。

本目录只经 Hermes 的官方对外接口驱动会话：

- `api_server` REST（`/api/sessions*`、`/v1/runs*`，`API_SERVER_KEY` 鉴权，loopback）
  —— 会话的列表 / 创建 / 转录 / 单轮流式输入与中止全部落在这一个文件；
- 其余文件只讲 docs/spec/23 的设备协议子集，不 import 任何 Hermes 内部模块。

方法签名变化时只改本文件（按 harness 版本矩阵测试），不改连接协议。
