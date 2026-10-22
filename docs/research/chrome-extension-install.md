# Chrome 扩展安装与 BrowserSkill 选型（D54）

采集于 2026-10-22 UTC。目标是主人现有登录 Chrome；隔离测试 profile 不代表生产 profile 验收。未改用户 Chrome profile、External Extensions 目录、策略、TCC 或生产 Yonder。

## 复用比较

| 候选 | stars / open issues | 最近发布 / pushed_at | 许可 | 本机实际运行 | 适配与取舍 |
|---|---|---|---|---|---|
| [Tencent/BrowserSkill](https://github.com/Tencent/BrowserSkill) | 9365 / 106 | cli-v0.3.3 2026-10-15；main 6214e3d；push 2026-10-21 | MIT | CLI/扩展构建、Rust 和扩展测试；CfT 原生链路 | 原样复用主体；书签和 management 缺口用最小 fork，Yonder 只适配 CLI |
| [fregante/chrome-webstore-upload](https://github.com/fregante/chrome-webstore-upload) | 409 / 0 | v6.0.1 2026-10-04；push 2026-10-04 | MIT | `npx --yes chrome-webstore-upload-cli --help` 成功 | 成熟 API 包装；无主人账号/凭据，停止上传/发布支线，不新建账号 |
| [GoogleChromeLabs/chrome-for-testing](https://github.com/GoogleChromeLabs/chrome-for-testing) | 1304 / 37 | 浏览器实测 155.0.8059.39；push 2026-10-22 | Apache-2.0（分发仓库；浏览器遵循其随附许可） | 已安装 CfT，headless 临时 profile 加载本 fork 成功 | 无人值守测试路线，非主人原有浏览器登录态 |
| Chrome 原生 management / External Extensions / CWS API | 平台 API，stars/发布不适用 | 官方在线文档，查阅 2026-10-22 | Chrome 平台条款；未复制源码 | management list/disable/enable 成功；uninstall 要求手势 | 复用平台能力，不另写扩展安装器或管理层 |

数据使用 `gh api repos/<owner>/<repo>`、`releases/latest` 取得；原始摘要保存在 B 轨执行记录。open issues 为 GitHub 字段（含 PR），不冒充独立 bug 数。106 项不等于零维护风险；近期 main/发布和现成 CI、文档、实际运行是选择依据。无需另找浏览器内核或新依赖。

## 七级路线：测试和限制

| 路线 | 实际尝试 / 官方依据 | 结论 | 交付 |
|---|---|---|---|
| R1 CWS unlisted API | uploader CLI help 成功；官方 v2 upload/publish 文档；未提供凭据，未发鉴权请求 | 已有条目更新可无人值守上传/送审；首次注册付费、listing/visibility 和审核仍依赖主人/Google | OWNER STEP；未发布，不保证审核时长 |
| R2 External Extensions JSON | 官方 macOS 指定 `~/Library/Application Support/Google/Chrome/External Extensions/<id>.json`，store update URL；该路径是用户级共享路径，不能仅靠 `--user-data-dir` 隔离，所以采用任务允许的官方文档路径，没有写入 | macOS 需要用户 enable 确认，需启动 Chrome；不能作为无感安装 fork 的路线 | 文档，不应用 |
| R3 商店 UI | 临时 CfT 155 headless 打开 BrowserSkill 商店页成功，真实 `Add to Chrome` 按钮 disabled；没有点原生确认。BrowserSkill 原有受限页面保护保留 | 本隔离环境无法安装；真实 Chrome 的 Add extension 原生确认交主人，未验证无人值守可完成 | OWNER STEP；不能宣称只需一次点击 |
| R4 Developer mode / Load unpacked | 临时 CfT 的 chrome://extensions 成功加载 extensions-manager；文件选择/授权按任务边界交主人，未自动点击 | 可人工加载 fork；自动完成未验证 | 精确加载目录和 popup 步骤 |
| R5 `--load-extension` | 隔离 CfT 临时目录实际载入 fork + 临时无权限测试扩展；CLI 连接和书签/管理动作测试 | 无人值守启动成功。官方 Chrome 137+ 品牌构建移除该 flag；不尝试改主人 Chrome | 测试脚本；专用 agent profile 指导，不能继承主人登录态 |
| R6 ExtensionInstallForcelist | 查阅 Chrome Enterprise 的 macOS 策略说明；按任务要求不应用 | 管理部署路线，需管理员及 managed preferences/策略；会显示组织管理，用户可能无法卸载 | 文档，不创建 plist、不运行 sudo |
| R7 chrome.management | 本 fork 可选 management 权限；临时扩展真实 list→disable→enable 成功；uninstall 返回 `chrome.management.uninstall requires a user gesture` | list/disable/enable 本机无人值守成功；卸载阻塞，未提供半工作的 uninstall 工具；普通/store 扩展提升权限后 enable 可能仍需手势 | fork CLI + Yonder `browser-skill_extensions` 默认关闭；卸载 OWNER STEP |

没有通过 CDP、调试 userGesture 标记、策略或修改真实 profile 绕过浏览器的安装/权限保护。CDP 仅用于测试拥有的浏览器 fixture、观察 UI 和制造一次性书签测试数据；产品工具仍使用原生扩展 API。

## OWNER STEP

1. **加载 fork 到真人 Chrome（未执行）**：选择目标 profile，打开 `chrome://extensions` → Developer mode → Load unpacked → 选择 `/Users/zoran/.local/share/browserskill-fork/chrome-extension`。若已加载该目录，点击那张扩展卡的 Reload，勿复制安装。官方商店 BrowserSkill 不含这些 fork 能力。
2. **连接与权限（未执行）**：打开此 fork 的 toolbar popup → Local connection，填写现有 daemon 实际 WS port；手动开启 Bookmark access（中文界面“书签访问”），Chrome 提示时 Allow；需要管理才开启 Extension management 并 Allow。未授予则工具拒绝。要使用新 CLI daemon，在无人使用共享 daemon 时由主人协调重启；本任务不重启生产进程。
3. **Yonder（待 PR 审查部署后）**：在获准 home 的 browser-skill config 选择 fork `bskPath`，按需设 `bookmarksEnabled:true` / `extensionsEnabled:true`，仅向授权 profile 选择对应工具，重启插件。不要为验收改生产 home。
4. **安装任意商店扩展**：真人 Chrome 打开 `https://chromewebstore.google.com/detail/<extension-id>` → Add to Chrome → 核对权限 → Add extension。未验证无人值守点击，不自动接受原生提示。
5. **卸载**：确认要永久移除的扩展 ID，主人打开 `chrome://extensions`，找到该 ID 对应扩展 → Remove → 确认 Remove；随后用 list 核验。不要卸载 BrowserSkill 自身来测试断线。
6. **若选择 unlisted 发布 fork**：主人自行注册 CWS developer、接受条款并支付一次性费用（官方未在本页标固定金额）；准备名称/说明/图标/截图/隐私披露；创建条目、选择 Unlisted 并完成首次可见性发布流程；在 Google Cloud 启用 CWS API，授权受限 OAuth（chromewebstore scope）或配置 service account 链接，凭据交既有 credential-use/agent-vault，不能贴到聊天。之后才可用 API upload/publish 后查询审核状态。Unlisted 仍需审核，非即时/无审核分发。

## 官方来源

- [CWS API v2 上传与送审、已有可见性限制](https://developer.chrome.com/docs/webstore/using-api)
- [开发者注册与一次性费用](https://developer.chrome.com/docs/webstore/register/)
- [CWS service account](https://developer.chrome.com/docs/webstore/service-accounts)
- [审核流程与时间](https://developer.chrome.com/docs/webstore/review-process/)
- [External Extensions：macOS 路径、store 限制及用户确认](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions)
- [management：权限、用户手势、卸载](https://developer.chrome.com/docs/extensions/reference/api/management)
- [Chrome 137 品牌构建移除 load-extension 的官方公告](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ)
- [macOS 企业扩展策略](https://support.google.com/chrome/a/answer/7517624)
- [managed by organization 的影响](https://support.google.com/chrome/answer/9281740)
