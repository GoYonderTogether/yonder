# 统一客户端提案索引

统一客户端、发布、默认 Agent、密钥、语音的设计提案。全部是提案，规范在 `docs/spec/`。

**规则：同类内容只在一处写，其他处引用。** 每个主题有一个所有者文档（见下表），其他文档只写一句摘要加相对链接。

## 文档

| 文档 | 决定什么 | 状态 | 待主人批准的事项 |
|---|---|---|---|
| [design.md](design.md) | 产品模型、仓库矩阵、命名与改名、网关与远程控制、前端合并与信息架构（§4.5）、桌面壳、默认配置与首次体验、迁移阶段 | 待批准 | 第 10 节所列 spec / decisions 变更；Apple 与 Windows 签名账号；组织内仓库改名权限 |
| [contracts.md](contracts.md) | 方法注册表、流帧协议、事件目录、`capabilities.get`、版本兼容 | 部分实施（A 线交付中） | 第 8 节未决项 |
| [agent-parity.md](agent-parity.md) | 默认 Agent 提示词、主规划者身份、选模型、上下文与压缩、界面信息显示、会话工具 | 待批准 | spec 04 `guidelines` 字段与新增事件（§12.4） |
| [notes.md](notes.md) | 会话、联系人、模型的实体笔记 | 待批准 | 修改 `docs/spec/15-memory.md` 与 D41；SDK `RenderContext.model` |
| [credentials.md](credentials.md) | `secrets` 插件：库、策略、审批、入站分流、导入 | 待批准 | 第 10 节 spec 变更（取代 spec 15 clipboard-vault） |
| [release-ci.md](release-ci.md) | 发布仓库、CI、多端分发、安装与更新、云部署链 | 部分实施（S1 起） | npm `@yonder` scope 是否可注册；Apple 账号；SignPath；GitHub App `yonder-release-bot` |
| [voice.md](voice.md) | 语音基座：通话、常驻录音、唤醒、声纹、眼镜 | 待批准 | 第 11.3 节 spec 变更；云中转音频策略 |

主题所有者：产品模型 / 仓库矩阵 / 命名 → design；线协议、方法、事件 → contracts；默认 Agent、提示词、选模型、上下文 → agent-parity；密钥 → credentials；CI、发布、安装 → release-ci；语音 → voice；实体笔记 → notes。

## 阅读顺序

1. [research/owner-requirements.md](research/owner-requirements.md)：主人要求与 10-28 前端信息架构。
2. [design.md](design.md)：先读第 0 节摘要和第 4.5 节。
3. [contracts.md](contracts.md)：前后端的接口约定。
4. [agent-parity.md](agent-parity.md)，再读 [notes.md](notes.md) 和 [credentials.md](credentials.md)。
5. [release-ci.md](release-ci.md)、[voice.md](voice.md)。

## research/

证据材料，每份开头标明结论并入哪份文档。冲突时以上表文档为准，不以 research 为准。
