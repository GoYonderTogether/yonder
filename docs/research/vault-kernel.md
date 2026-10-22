# Vault kernel 调研（D53）

采样：2026-10-22，Darwin ARM64。使用 `agent-network run -- gh api repos/<owner>/<repo>` 与 `/releases/latest`，同时核对官方文档、LICENSE。stars/未关闭 issues 只表明维护规模，不等于安全审计。未关闭数含 PR；不虚构缺陷关闭率。不存在的 1Password/cli 返回 404，闭源 CLI 的 stars 不适用。

| 候选（仓库/文档） | stars | 最新 release / 日期 | 最近 push / 未关闭数 | 许可/本机运行与适配 | 结论 |
|---|---:|---|---|---|---|
| [apple-oss-distributions/Security](https://github.com/apple-oss-distributions/Security) | 146 | 无 GitHub release / — | 2026-06-18T03:58:15Z / 1 | 系统 Security.framework；无主密钥；本地 ARM64；每项 ACL；应用审计由插件补齐 | 选用，已实测 |
| [keepassxreboot/keepassxc](https://github.com/keepassxreboot/keepassxc) | 29357 | 2.8.0 / 2026-10-21T21:57:23Z | 2026-10-21T21:06:33Z / 934 | 离线 KDBX；CLI 密码经 stdin；需外置 app、Keychain 主密钥；按库权限 | 备用，2.7.12 已实测；不自动切换 |
| [1Password/cli](https://developer.1password.com/docs/cli/) | 不适用 | 无 GitHub release / — | — / — | 闭源 CLI；服务账号需托管账号/token，个人桌面认证需主人；op run/inject 模式优秀 | 借鉴引用/注入，不访问个人库 |
| [bitwarden/clients](https://github.com/bitwarden/clients) | 14034 | desktop-v2026.10.0 / 2026-10-15T18:56:38Z | 2026-10-22T04:42:26Z / 1381 | GPL-3.0/Bitwarden License；CLI session、账号解锁与同步；可自托管 | 不引入账号/主密码会话 |
| [bitwarden/sdk-sm](https://github.com/bitwarden/sdk-sm) | 488 | python-v2.1.0 / 2026-05-21T22:31:53Z | 2026-10-21T17:20:44Z / 83 | Bitwarden SDK License；机器身份+项目授权；服务端，非离线小内核 | 不选 |
| [zx2c4/password-store](https://github.com/zx2c4/password-store) | 758 | 无 GitHub release / — | 2025-06-18T09:55:20Z / 1 | GPL-2.0+；GPG key/agent；离线、Git 记录不是访问审计 | 不选，需另管 GPG |
| [gopasspw/gopass](https://github.com/gopasspw/gopass) | 7276 | v1.17.4 / 2026-10-10T09:01:05Z | 2026-10-21T15:33:37Z / 81 | MIT；GPG/age 等；离线与团队存储 | 不选，额外密钥生命周期 |
| [FiloSottile/age](https://github.com/FiloSottile/age) | 24006 | v1.3.2 / 2026-08-29T17:55:36Z | 2026-08-29T17:55:36Z / 24 | BSD-3-Clause；成熟加密器，不含引用 CRUD/ACL/审计 | 不自建 vault |
| [str4d/rage](https://github.com/str4d/rage) | 3692 | v0.12.1 / 2026-07-14T03:07:32Z | 2026-08-20T19:10:32Z / 72 | MIT/Apache-2.0；age 的 Rust 实现，同样缺 vault 语义 | 不自建 vault |
| [getsops/sops](https://github.com/getsops/sops) | 23477 | v3.13.3 / 2026-07-23T05:27:57Z | 2026-10-20T04:34:01Z / 462 | MPL-2.0；配置文件加密，需 age/KMS；不是逐项秘密仓库 | 不选 |
| [openbao/openbao](https://github.com/openbao/openbao) | 8632 | v2.7.1 / 2026-10-01T14:03:19Z | 2026-10-22T00:40:20Z / 345 | MPL-2.0；成熟 ACL/audit/KV；ARM64，但服务、unseal/token 运维重 | 不选，本轮未重跑服务；保留旧失败 |
| [hashicorp/vault](https://github.com/hashicorp/vault) | 36415 | v2.2.0 / 2026-10-15T16:17:18Z | 2026-10-21T23:02:10Z / 1474 | BUSL-1.1；服务、unseal/token；成熟 ACL/audit，非轻量内嵌 | 不选 |
| [Infisical/infisical](https://github.com/Infisical/infisical) | 29910 | v0.167.0 / 2026-10-21T19:42:12Z | 2026-10-22T04:38:35Z / 828 | MIT + ee 商业部分；CLI 注入、服务与身份依赖 | 不选 |
| [dani-garcia/vaultwarden](https://github.com/dani-garcia/vaultwarden) | 69434 | 1.37.4 / 2026-10-05T23:40:54Z | 2026-10-16T09:51:32Z / 105 | AGPL-3.0；Bitwarden 兼容服务器，仍需客户端会话/账号 | 沿用本机 automation 用途，不接入产品内核 |

## 可运行性与选择门槛

1. **Keychain：PASS**。独立 Swift Security.framework helper，以 `SecItemAdd/CopyMatching/Delete` 存取独立 `org.goyonder.clipboard.smoke` item。随机 256 字节 + NUL/CR/LF，put=0、get=0、byte-exact=true、delete=0。无需读取任何既有 item、账号、master secret、环境或 argv 中的秘密。无需网络、进程外 vault 或下载。首轮 helper 的旧 UI 常量产生 deprecation warning；产品使用 LAContext.interactionNotAllowed，禁止弹窗。未验证锁屏/重启/签名更新 ACL 行为，拒绝交互时 fail closed。
2. **KeePassXC：PASS**。复用旧分支已下载的官方 ARM64 2.7.12 **可执行文件**，仅执行读取，不修改该 worktree。独立 scratch KDBX，随机 master/value 全程匿名 stdin，db-create/add/show 各 exit=0、byte-exact=true，测试库已删除。最新 release 是 2.8.0；不把旧版本实测当作新版验证。产品不自动 fallback：不能在 Keychain 拒绝时绕过其权限。
3. `op --version`=2.39.0，仅运行版本；未登录/读取/创建真实条目。其账户、服务 token 与云连接依赖不是本轮离线内核的优势。其余候选未安装/未 smoke；架构不匹配者不为凑实验而部署服务/创建账号。

选 **macOS Keychain**（成熟系统内核原样调用），备用 **KeePassXC**（迁移/跨平台另行适配）。我们只实现 opaque handle、来源、TTL、profile grant、destination 与 ledger；不写加密、主密钥或 vault 格式。访问审计归应用事件，Keychain ACL 不隔离同一 OS 用户的不可信 shell；分发签名/ACL 需安装验收。

## 复用顺序与旧分支

- 原样：Security.framework 保存字节；Node crypto/fs/child_process/fetch 做内容寻址、文件与固定消费者。
- 包装：薄 Swift pipe adapter，借鉴旧 `yonder/secrets-plugin` 的匿名管道、不回显子进程 stdout/stderr、取消/错误码、Keychain 禁止 UI；不复制其安装器、flock/KDBX 主密码或 MV3 栈。保留来源 NOTICE。
- 组合：现有 SDK 工具、afterTool、events、sessions.transcript、messages.send；补唯一缺口 `Hook.beforeSend`（按选中 profile，流式消息在消息结束时统一过滤，防跨 chunk 泄漏）。
- 自建：只有 clip 元数据/权限/类型化目的地。D50 credentials 继续是 provider/channel auth.json；D51 sources 继续原样委派，不建立第三个凭据或转录库。

旧分支 `7fcd217` README/ACCEPTANCE 已读：实际 KeePassXC、CfT extension/native host 曾通过；正式 Hermes DOM adapter、生产消费者和独立模型未通过。旧 OpenBao KV 挂载 500（raft leader）及未知锁屏等缺口保留，不能当新内核负面定论。本轮不 cherry-pick 固定 consumer 的四提交，也不覆盖该分支。

## 官方证据

- [Apple Keychain ACL](https://developer.apple.com/documentation/security/access-control-lists)、[SecItemAdd](https://developer.apple.com/documentation/security/secitemadd(_:_:))、[TN3137](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains)：系统存储/每项访问控制；GitHub Security 是源码镜像，系统 framework 不作为第三方源码分发，镜像含 Apple 多项许可，不以未知 SPDX 冒充 MIT。
- [KeePassXC CLI](https://github.com/keepassxreboot/keepassxc/blob/develop/docs/man/keepassxc-cli.1.adoc)、[COPYING](https://github.com/keepassxreboot/keepassxc/blob/develop/COPYING)：GPL-2.0+及组件许可；2.7.12 测试资产不分发。
- [1Password 引用注入](https://developer.1password.com/docs/cli/secrets-scripts)：只借鉴使用方式，无 SDK 或代码复制。
- [Bitwarden CLI](https://bitwarden.com/help/cli/)、[Secrets Manager CLI](https://bitwarden.com/help/secrets-manager-cli/)、[pass](https://www.passwordstore.org/)、[OpenBao](https://openbao.org/docs/)、[Vault](https://developer.hashicorp.com/vault/docs)、[Infisical CLI](https://infisical.com/docs/cli/overview)。其余仓库链接直接包含文档、release 与许可证，NOASSERTION 依实际 LICENSE 判断（见表）。

## 本轮阻塞的子目标

浏览器 sealed capture/fill 需要稳定、不将 value 放 argv/模型工具参数/调试日志的 BrowserSkill/原生适配接口；现有 plugin 只有模型可见的 `text`/evaluate。不能以 DOM 回读代替秘密通道，也不依赖 Track B 未提交契约。Feishu 私密录入必须发生在入站账本/模型之前，当前 SDK 的事件观察无法撤回已写消息；不提供“发我 secret”伪安全入口。这两项 fail closed，PR 明示 BLOCKED，后续由独立适配补全。
