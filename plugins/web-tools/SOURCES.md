# 固定参考与许可

实现时只读本机源码，不复制上游运行/凭据/配置系统；本包为 SDK 适配。以下 commit 固定到本次实际阅读版本，不随上游更新变更。

| 来源 | commit | 阅读模块 | 取用边界 / 许可 |
|---|---|---|---|
| AI-Being | 8aa49512e588717b988eb6b95b1318180f56d7be | src/tools/web.ts | 对照 Tavily 参数、Readability/linkedom/Turndown 与有界读；本机仓库未发现 LICENSE，不直接复制代码或旧 LocalCredentials |
| OpenClaw | cafa09e50556e08c2a04a670f16ac815482c5489 | src/agents/tools/web-fetch-utils.ts | 对照 HTML/Markdown 输出与边界；MIT，未移植其自有 HTML parser |
| Hermes | 66605471e9f0b0832abbefaf625ce08e948ca540 | tools/web_tools.py | 对照 Search/Extract 分离和供应商事实；MIT / Nous Research，未移植 registry/cache/rescue/config |
| OpenCode | 214fb7fdbab9ad13773629839f1178382400cf97 | packages/core/src/tool/plugin/webfetch.ts | 对照 GET、MIME、超时、有界正文；MIT，未移植 Effect runtime、权限系统或自动重试 |

生产依赖精确版本：@mozilla/readability 0.6.0（Apache-2.0）、linkedom 0.18.13（ISC）、turndown 7.2.4（MIT）；类型 @types/turndown 5.0.6（MIT）。依赖许可由发行组装统一收录 THIRD_PARTY_NOTICES；本文件不声称第三方包已安装或功能已验收。
