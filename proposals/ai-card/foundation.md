# 底座选型

要求：React、响应式、基本聊天功能齐全、成熟、能快速起项目；后端也尽量借用，不自己写消息系统。

资料取自 GitHub 页面与接口，查询日期 2026-10-21。

## 结论

**服务端倾向 Tinode；前端不 fork Tinode 的网页端（风格不合要求），改为自己用现代 React 栈写，通过 `tinode-sdk` 连 Tinode。** 这是倾向，不是定案：下面"先验证"里的几项通过之前不要开始大量开发。

## 前端栈

参照项目的前端（查询日期 2026-10-21，来自各仓库 `package.json`）：

| 项目 | 前端 |
|---|---|
| opencode | SolidJS + Vite + Tailwind CSS 4 + Kobalte，带 PWA |
| OpenClaw | Solid 2.0 预发布 + Vite，无 CSS 框架 |
| Hermes Agent | 顶层有 `apps/`（含 desktop、shared），网页栈未确认 |
| DeepSeek Harness | 本地 Web UI，具体框架未确认 |

再补查的 React 项目（同日期，GitHub 接口与 `package.json`）：

| 项目 | 前端 | 许可 | 判断 |
|---|---|---|---|
| **Hermes Agent 桌面端** `apps/desktop` | React 19 + Vite 8 + Tailwind 4 + radix-ui + **assistant-ui** + streamdown + nanostores + TanStack Query + react-router 8；带 `DESIGN.md` 设计规则 | 仓库 MIT（该包自身未声明） | **照抄对象**：栈最新，最贴合 AI 时代观感，设计规则成文 |
| LibreChat `client` | React 18 + Vite + Tailwind 4 + radix + react-markdown | MIT | 多用户聊天的结构参考，栈比 Hermes 旧 |
| LobeHub、Dify | React / Next | GitHub 未识别为单一许可 | 许可不清，不抄 |
| Cherry Studio | React / Electron | AGPL-3.0 | 许可太强，不抄 |
| DeepSeek Harness `apps/web` | Vite 项目，包文件读取失败，框架未确认 | — | 无法参考 |

**结论：抄 Hermes 桌面端的前端栈和 `DESIGN.md` 规则，聊天部分直接用它选的 assistant-ui + streamdown，多用户聊天结构（会话列表、群）参考 LibreChat。** 注意：

- Hermes 桌面端是 Electron 单用户客户端，我们只取网页部分；它依赖的 `@nous-research/ui` 是 Nous 自己的组件包，许可未确认，不直接依赖，用 radix + 自己的少量组件替换。
- 抄代码前先确认 `apps/desktop` 的许可文件和品牌素材范围（仓库 MIT，但品牌标识不能带走）。
- assistant-ui（MIT）面向“一人对一个 AI”的会话，群聊、多发送者要自己扩展，这是最大的适配成本，需要在原型里先验证。

下面是之前按“自己选”列的组合，仅作对照，以抄 Hermes 为准：

| 层 | 选择 | 理由 |
|---|---|---|
| 构建 | Vite + TypeScript | 与参照项目一致，轻 |
| 样式与组件 | Tailwind CSS 4 + shadcn/ui（Radix 或 Base UI） | 代码复制进自己仓库，自己拥有，风格可控，是当前 AI 产品的主流观感 |
| 聊天界面 | shadcn 的会话组件（MessageScroller、Message、Bubble、Attachment、Marker，2026-08 发布）；可参考 Vercel AI Elements、assistant-ui、prompt-kit | 都是 React + Tailwind，按需拷贝，不绑后端 |
| 数据 | `tinode-sdk` + TanStack Query | 消息、同步、在线状态走 Tinode |
| 路由、PWA | React Router、vite-plugin-pwa | 名片页等新页面，和可安装 |

注意：

- shadcn 会话组件是第一阶段发布，有一个已报告的 MessageScroller 锚点问题（来自 InfoQ 报道），Vercel AI Elements 绑定 AI SDK 的 `useChat`，我们的数据来自 Tinode，所以只拿它们的外观和结构当参考，不当依赖。
- 没找到现成的前端设计 skill（在你的 claude.ai skills 里搜过）。设计质量靠选定一套设计 token（字体、色板、圆角）后统一落在 shadcn 主题里。
- 前端从零写，工作量比 fork 大，但页面少（见 [pages.md](pages.md)），可以由 Agent 快速生成。

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
