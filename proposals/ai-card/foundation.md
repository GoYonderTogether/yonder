# 底座选型

要求：React、响应式、基本聊天功能齐全、成熟、能快速起项目；后端也尽量借用，不自己写消息系统。

资料取自 GitHub 页面与接口，查询日期 2026-10-21。

## 结论

**倾向 Tinode：服务端用 Tinode，网页端 fork Tinode 的 React 应用，再加几个自己的页面和一个很小的名片服务。** 这是倾向，不是定案：下面"先验证"里的几项通过之前不要开始大量开发。

## 候选

| 候选 | 构成 | 许可 | 维护 | 判断 |
|---|---|---|---|---|
| **Tinode** | Go 服务端 + React 网页端 + JS SDK | 服务端 GPL-3.0；网页端 Apache-2.0；SDK 与 gRPC 绑定 Apache-2.0 | 2026-10-19 仍有提交；最近发布 v0.25.3（2026-07-04）；13.5k star；自称 beta 质量 | 功能最贴合，体量小 |
| Matrix（Synapse 等 + Element Web / Cinny） | 联邦协议 + 多种客户端 | Element Web 为 AGPL-3.0、GPL-3.0 或商业许可；Cinny 为 AGPL-3.0 | Cinny 的 README 称正在替换 matrix-js-sdk，暂不接受 PR；Element 网页端的移动浏览器仅"社区支持" | 协议成熟但概念重（联邦、加密、房间），客户端定制成本高 |
| Mattermost | Go 服务端 + React 网页端 | GitHub 未识别为单一许可 | 2026-10-21 仍有提交；39k star | 面向企业团队协作，偏重；未逐项评估 |
| chatscope chat-ui-kit-react + 自建后端 | 只有界面组件 | MIT | 最近提交 2025-05-15 | 消息、同步、群组都要自己写，与"快速起项目"相反 |
| 商业聊天 SDK 或 SaaS | 托管 | 商业 | — | 未评估；数据在第三方，与"用户掌握数据"的定位冲突 |

## 为什么倾向 Tinode

| 我们要的 | Tinode 现状 | 依据 |
|---|---|---|
| 匿名访客 | 有 `anonymous` 方案，可创建账号；不能用它再次登录，令牌丢了账号就拿不回来 | [API 文档](https://github.com/tinode/chat/blob/master/docs/API.md) |
| 邮箱登录、不验证 | `basic` 方案只需登录名和密码；凭据验证（邮箱、手机）是可选配置 | 同上 |
| 私聊、群聊 | 私聊 topic 和群 topic | 同上 |
| 离线补收、在线状态 | 每个会话有递增的 `seq`，可按 `since`、`before`、`limit` 拉取；有在线状态通知 | 同上 |
| 富文本、按钮、@ | Drafty 格式：图片、文件、音视频、表单与按钮（`pub`、`url` 两种动作）、@提及 | [Drafty 文档](https://github.com/tinode/chat/blob/master/docs/drafty.md) |
| React 网页端 | React 19，webpack，react-intl（含简体和繁体中文），响应式；已有二维码、转发、群管理、邀请、置顶、按 ID 新建会话、联系人搜索等组件 | [tinode/webapp](https://github.com/tinode/webapp) |
| 插件接入 | `tinode-sdk`（JS，Apache-2.0）可以写成普通客户端，不用我们自造协议 | [tinode/chat](https://github.com/tinode/chat) |
| 存储 | MySQL、PostgreSQL、MongoDB | 同上 |

## 先验证

下面这些都**未验证**，建议用一个短的 spike 先过一遍：

1. **匿名账号能否直接和 Agent 开私聊。** API 文档说匿名用户在群里的默认权限是 `N`（需要管理员批准）；私聊的默认权限和服务端配置能否放开，需实测。
2. **微信内置浏览器和 iOS Safari。** 分享主要发生在微信社群，而网页端 README 只说测过最新的 Chrome 和 Firefox。
3. **登录名用邮箱字符串、不配验证器的注册流程。**
4. **`tinode-sdk` 在 Node 里能否做 Yonder 渠道**：收发、@ 提及、离线补收。
5. **引用回复的呈现。** Drafty 文档没覆盖引用，需看实际行为。
6. **许可。** 服务端是 GPL-3.0；计划不改服务端，只做网页端分支、名片服务和插件。若以后要改服务端，需先评估义务（本文不构成法律意见）。
7. **推送。** 网页端的推送用 Firebase，国内不可用；第一版不做推送。
