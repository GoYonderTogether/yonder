# Yonder Harness

[English](README.md) · **中文**

一个很小的常驻 agent 内核。任何消息都是事件，由 harness 分发给指定 agent 的指定会话，完成工作后把输出交回去。渠道、工具、上下文文件、记忆、执行环境、各种防护都是插件。

模型调用与 agent 运行时基于 [pi](https://github.com/earendil-works/pi)（`pi-ai`、`pi-durable`）。

> 状态：**0.1 之前，设计阶段。** [`docs/`](docs/index.md) 里的规范是目标，代码跟着规范走。

- [架构](docs/architecture.md)
- [规范](docs/index.md)
- [0.1 任务](docs/tasks/README.md)

许可证：[Apache-2.0](LICENSE)
