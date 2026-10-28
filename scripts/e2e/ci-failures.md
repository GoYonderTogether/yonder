# #108 三平台 CI 失败清单

来源：[运行 40651312212](https://github.com/GoYonderTogether/yonder/actions/runs/40651312212)，`gh run view 40651312212 --log-failed`；这是首次运行结果，不是修复或复测结果。旧 workflow `d7a0ec^:.github/workflows/ci-platforms.yml` 写有 `Linux/Windows not yet green`。

| 平台 | 测试通过 | 失败 | 取消 | 跳过 | 测试文件通过 / 失败 / 跳过 |
|---|---:|---:|---:|---:|---|
| macOS | 1087 | 0 | 未报告 | 57 | 179 / 0 / 27 |
| Linux | 1051 | 30 | 未报告 | 63 | 168 / 8 / 30 |
| Windows | 815 | 254 | 未报告 | 75 | 96 / 80 / 30 |

取消数是 Vitest 未提供的计数，不能推断为 0；三个 job 均已结束，无取消 job。Linux/Windows 测试步骤失败，后续 lint 未运行。macOS 通过。下列按日志错误及可能共同原因聚合；标“待确认原因”的项仅是症状，不能当成已验证根因。修复文件为日志栈与测试入口定位的候选，需负责人确认后精确定卡；不以跳过或降低断言修绿。

## GitHub 更新仅支持 macOS 的前置拒绝（Linux、Windows）

测试文件：`plugins/channel-github/test/repair.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected [Function] to throw error including 'runner copy failed' but got 'Service-external updates require macO…'`
- `AssertionError: expected [Function] to throw error including 'uncertain' but got 'Service-external updates require macO…'`
- `AssertionError: expected false to be true // Object.is equality`
- `Error: ENOENT: no such file or directory, scandir '/tmp/yonder-github-check-VaDvzg/github-project.updates'`

建议修复文件：`plugins/channel-github/test/repair.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## Windows SQLite 清理锁（Windows）

测试文件：`plugins/interaction/test/activity.test.ts`、`plugins/tasks/test/activity.test.ts`、`plugins/tasks/test/panel.test.ts`、`plugins/tasks/test/tasks.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `Error: EBUSY: resource busy or locked, unlink 'C:\Users\RUNNER~1\AppData\Local\Temp\yonder-activity-tasks-Z5swl2\tasks.sqlite'`

建议修复文件：`plugins/interaction/test/activity.test.ts`、`plugins/tasks/test/activity.test.ts`、`plugins/tasks/test/panel.test.ts`、`plugins/tasks/test/tasks.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## Windows file URL 路径传给 Node（Windows）

测试文件：`packages/device/test/cli.test.ts`、`tests/device-cli-plugin.test.ts`。

归属：CORE、待主 Agent 确认（tests 跨模块）。

错误原文（同类不同临时路径保留首个代表）：

- `Error: Command failed: C:\hostedtoolcache\windows\node\22.23.4\x64\node.exe /D:/a/yonder-harness/yonder-harness/packages/device/dist/cli.js init --home C:\Users\RUNNER~1\AppData\Local\Temp\yonder-device-product-C5xC3u\device`

建议修复文件：`packages/device/test/cli.test.ts`、`tests/device-cli-plugin.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## Windows 凭据存储权限（Windows）

测试文件：`packages/core/src/runtime/credential-slot-loopback.test.ts`、`packages/core/src/runtime/credential-slot-recovery.test.ts`、`packages/core/src/runtime/credential-slots-integration.test.ts`、`packages/core/src/runtime/credential-slots.test.ts`、`packages/core/src/runtime/named-credentials.test.ts`、`packages/core/src/runtime/slot-auth.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `Error: Unsafe credential storage path or permissions`

建议修复文件：`packages/core/src/runtime/auth.ts`、`packages/core/src/runtime/credential-slots.ts`、`packages/core/src/runtime/credentials.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## Windows 硬编码 /tmp 临时目录（Windows）

测试文件：`packages/cli/src/bundles.test.ts`、`packages/cli/src/completion.test.ts`、`packages/cli/src/index.test.ts`、`packages/cli/src/init.test.ts`、`packages/core/src/config/default-model.test.ts`、`packages/core/src/control/control.test.ts`、`packages/core/src/kernel/agents-plugin.test.ts`、`packages/core/src/kernel/console.test.ts`、`packages/core/src/kernel/kernel.test.ts`、`packages/core/src/kernel/management.test.ts`、`packages/core/src/kernel/peer.test.ts`、`packages/core/src/kernel/plugin-input.test.ts`、`packages/core/src/kernel/slash-routing.test.ts`、`packages/core/src/plugins/index.test.ts`、`packages/core/src/plugins/mcp.test.ts`、`packages/core/src/plugins/permissions.test.ts`、`packages/core/src/prompt/official-prompts.test.ts`、`packages/core/src/release/platform-service.test.ts`、`packages/core/src/release/release.test.ts`、`packages/core/src/release/service-host.test.ts`、`packages/core/src/runtime/activity.test.ts`、`packages/core/src/runtime/boundary.test.ts`、`packages/core/src/runtime/env.test.ts`、`packages/core/src/runtime/peer-boundary.test.ts`、`packages/core/src/runtime/permission-context.test.ts`、`packages/core/src/runtime/permissions-integration.test.ts`、`packages/core/src/runtime/process.test.ts`、`packages/core/src/sessions/commands.test.ts`、`packages/gateway/test/bots.test.ts`、`packages/gateway/test/hardening.test.ts`、`packages/gateway/test/server.test.ts`、`plugins/channel-feishu/test/contract.test.ts`、`plugins/tasks/test/board.test.ts`、`plugins/tasks/test/moments.test.ts`、`tests/wechat-ilink-diagnostics.test.ts`、`tests/wechat.test.ts`。

归属：API、CORE、DIST、待主 Agent 确认（tests 跨模块）。

错误原文（同类不同临时路径保留首个代表）：

- `Error: ENOENT: no such file or directory, mkdtemp '/tmp/ychat-XXXXXX'`

建议修复文件：`packages/cli/src/bundles.test.ts`、`packages/cli/src/completion.test.ts`、`packages/cli/src/index.test.ts`、`packages/cli/src/init.test.ts`、`packages/core/src/config/default-model.test.ts`、`packages/core/src/control/control.test.ts`、`packages/core/src/kernel/agents-plugin.test.ts`、`packages/core/src/kernel/console.test.ts`、`packages/core/src/kernel/kernel.test.ts`、`packages/core/src/kernel/management.test.ts`、`packages/core/src/kernel/peer.test.ts`、`packages/core/src/kernel/plugin-input.test.ts`、`packages/core/src/kernel/slash-routing.test.ts`、`packages/core/src/plugins/index.test.ts`、`packages/core/src/plugins/mcp.test.ts`、`packages/core/src/plugins/permissions.test.ts`、`packages/core/src/prompt/official-prompts.test.ts`、`packages/core/src/release/platform-service.test.ts`、`packages/core/src/release/release.test.ts`、`packages/core/src/release/service-host.test.ts`、`packages/core/src/runtime/activity.test.ts`、`packages/core/src/runtime/boundary.test.ts`、`packages/core/src/runtime/env.test.ts`、`packages/core/src/runtime/peer-boundary.test.ts`、`packages/core/src/runtime/permission-context.test.ts`、`packages/core/src/runtime/permissions-integration.test.ts`、`packages/core/src/runtime/process.test.ts`、`packages/core/src/sessions/commands.test.ts`、`packages/gateway/test/bots.test.ts`、`packages/gateway/test/hardening.test.ts`、`packages/gateway/test/server.test.ts`、`plugins/channel-feishu/test/contract.test.ts`、`plugins/tasks/test/board.test.ts`、`plugins/tasks/test/moments.test.ts`、`tests/wechat-ilink-diagnostics.test.ts`、`tests/wechat.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## Windows 设备持久化 fsync（Windows）

测试文件：`packages/device/test/executor.test.ts`、`packages/device/test/regressions.test.ts`、`plugins/devices/test/controller.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `Error: EPERM: operation not permitted, fsync`

建议修复文件：`packages/device/src/executor.ts`、`packages/device/src/store.ts`、`plugins/devices/src/controller.ts`、`plugins/devices/src/store.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## Windows 迁移测试及回滚，多个错误待拆因（Windows）

测试文件：`packages/cli/src/migrate.test.ts`。

归属：REPO。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected '备份 C:\Users\RUNNER~1\AppData\Local\Te…' to contain 'sudo sed -i \'\' \'s/dev\.yonder\.har…'`
- `AssertionError: expected '无需迁移 · Nothing to migrate\n' to contain 'dry-run'`
- `AssertionError: expected 438 to be 384 // Object.is equality`
- `AssertionError: expected [Function] to throw error including '--force' but got '拒绝回滚：旧路径 C:\Users\RUNNER~1\AppData\Lo…'`
- `AssertionError: promise resolved "{ status: 'ready', …(12) }" instead of rejecting`
- `Error: Test timed out in 20000ms.`
- `Error: 拒绝回滚：旧路径 C:\Users\RUNNER~1\AppData\Local\Temp\ymigrate-hUmrJU\yonder-harness\home 不是指向 C:\Users\RUNNER~1\AppData\Local\Temp\ymigrate-hUmrJU\yonder\home 的符号链接，状态已被改动，请人工处理`
- `Error: 无法迁移：`

建议修复文件：`packages/cli/src/migrate-rollback.ts`、`packages/cli/src/migrate.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## packages/cli/src/completion.test.ts：待确认原因（Linux）

测试文件：`packages/cli/src/completion.test.ts`。

归属：DIST。

错误原文（同类不同临时路径保留首个代表）：

- `Error: spawnSync zsh ENOENT`

建议修复文件：`packages/cli/src/completion.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## packages/core/src/release/platform-service.test.ts：待确认原因（Windows）

测试文件：`packages/core/src/release/platform-service.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `Error: spawn systemctl ENOENT`

建议修复文件：`packages/core/src/release/platform-service.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## packages/core/src/release/release.test.ts：待确认原因（Windows）

测试文件：`packages/core/src/release/release.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected '# YonderService={"home":"/tmp/agent h…' to contain 'ExecStart="/opt/yonder app/bin/yonder…'`
- `AssertionError: expected [ 'architecture.md', …(81) ] to include 'spec/09-cli-release.md'`

建议修复文件：`packages/core/src/release/release.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## packages/core/src/release/service-host.test.ts：待确认原因（Linux）

测试文件：`packages/core/src/release/service-host.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected 'Yonder service host requires macOS\n' to contain 'Usage: yonder-service-host --home <ho…'`

建议修复文件：`packages/core/src/release/service-host.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## packages/core/src/runtime/background.test.ts：待确认原因（Windows）

测试文件：`packages/core/src/runtime/background.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `SyntaxError: Unexpected token 's', "spawn /bin"... is not valid JSON`

建议修复文件：`packages/core/src/runtime/background.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## packages/core/src/runtime/credential-slots.test.ts：待确认原因（Windows）

测试文件：`packages/core/src/runtime/credential-slots.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected [Function] to throw error including 'Unknown credential slot' but got 'Unsafe credential storage path or per…'`

建议修复文件：`packages/core/src/runtime/credential-slots.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## packages/core/src/runtime/named-credentials.test.ts：待确认原因（Windows）

测试文件：`packages/core/src/runtime/named-credentials.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected [Function] to throw error including 'cannot parse JSON' but got 'Unsafe credential storage path or per…'`

建议修复文件：`packages/core/src/runtime/named-credentials.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## packages/core/src/runtime/quota-source.test.ts：待确认原因（Windows）

测试文件：`packages/core/src/runtime/quota-source.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected 438 to be 384 // Object.is equality`

建议修复文件：`packages/core/src/runtime/quota-source.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## packages/core/src/runtime/runtime.test.ts：待确认原因（Windows）

测试文件：`packages/core/src/runtime/runtime.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected 'D:\tmp\home\.yonder\auth.json' to be '/tmp/home/.yonder/auth.json' // Object.is equality`

建议修复文件：`packages/core/src/runtime/runtime.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## packages/device/test/backends/linux.test.ts：待确认原因（Windows）

测试文件：`packages/device/test/backends/linux.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected [] to deeply equal [ { id: 'editor.desktop', …(1) } ]`

建议修复文件：`packages/device/test/backends/linux.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## packages/device/test/executor.test.ts：待确认原因（Linux）

测试文件：`packages/device/test/executor.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `Error: UNAUTHORIZED`

建议修复文件：`packages/device/src/executor.ts`、`packages/protocol/src/index.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## packages/device/test/regressions.test.ts：待确认原因（Windows）

测试文件：`packages/device/test/regressions.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected [ …(2) ] to deeply equal [ 'BUSY', 'OWNED' ]`

建议修复文件：`packages/device/test/regressions.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## packages/gateway/test/hardening.test.ts：待确认原因（Windows）

测试文件：`packages/gateway/test/hardening.test.ts`。

归属：API。

错误原文（同类不同临时路径保留首个代表）：

- `TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined`

建议修复文件：`packages/gateway/test/hardening.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## packages/gateway/test/server.test.ts：待确认原因（Windows）

测试文件：`packages/gateway/test/server.test.ts`。

归属：API。

错误原文（同类不同临时路径保留首个代表）：

- `TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined`

建议修复文件：`packages/gateway/test/server.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/channel-card/test/protocol.test.ts：待确认原因（Windows）

测试文件：`plugins/channel-card/test/protocol.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected 438 to be 448 // Object.is equality`

建议修复文件：`plugins/channel-card/test/protocol.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/channel-cli/test/channel.test.ts：待确认原因（Windows）

测试文件：`plugins/channel-cli/test/channel.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `Error: Test timed out in 20000ms.`

建议修复文件：`plugins/channel-cli/test/channel.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/channel-github/test/actions.test.ts：待确认原因（Windows）

测试文件：`plugins/channel-github/test/actions.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`
- `AssertionError: expected "vi.fn()" to be called once with arguments: [ { to: 'conv:feishu:target', …(1) } ]`

建议修复文件：`plugins/channel-github/test/actions.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/channel-qq/test/channel.test.ts：待确认原因（Windows）

测试文件：`plugins/channel-qq/test/channel.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected 438 to be 384 // Object.is equality`
- `AssertionError: expected { ok: false, …(2) } to deeply equal { ok: true, id: 'MEDIA1' }`
- `Error: QQ attachment must be an https URL or an absolute local path`

建议修复文件：`plugins/channel-qq/src/channel.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/clipboard/test/clipboard.test.ts：待确认原因（Windows）

测试文件：`plugins/clipboard/test/clipboard.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `Error: absolute_path_required`
- `Error: absolute_roots_required`
- `Error: unsafe_data_directory`

建议修复文件：`plugins/clipboard/src/config.ts`、`plugins/clipboard/src/index.ts`、`plugins/clipboard/src/store.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/clipboard/test/http.test.ts：待确认原因（Windows）

测试文件：`plugins/clipboard/test/http.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `Error: spawnSync /usr/bin/openssl ENOENT`

建议修复文件：`plugins/clipboard/test/http.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/cron/src/scheduler.test.ts：待确认原因（Linux）

测试文件：`plugins/cron/src/scheduler.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected undefined to be 'running' // Object.is equality`

建议修复文件：`plugins/cron/src/scheduler.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/interaction/test/contract.test.ts：待确认原因（Windows）

测试文件：`plugins/interaction/test/contract.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected 438 to be 384 // Object.is equality`

建议修复文件：`plugins/interaction/test/contract.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/learning/test/learning-store.test.mjs：待确认原因（Windows）

测试文件：`plugins/learning/test/learning-store.test.mjs`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: Expected values to be strictly equal:`
- `AssertionError: The expression evaluated to a falsy value:`

建议修复文件：`plugins/learning/test/learning-store.test.mjs`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/learning/test/plugin.test.mjs：待确认原因（Windows）

测试文件：`plugins/learning/test/plugin.test.mjs`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `Error: absolute_normalized_directory_required`

建议修复文件：`plugins/learning/src/index.mjs`、`plugins/learning/src/store.mjs`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/learning/test/skills.test.mjs：待确认原因（Windows）

测试文件：`plugins/learning/test/skills.test.mjs`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: The expression evaluated to a falsy value:`

建议修复文件：`plugins/learning/test/skills.test.mjs`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/learning/test/store.test.mjs：待确认原因（Windows）

测试文件：`plugins/learning/test/store.test.mjs`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: Expected values to be strictly equal:`
- `AssertionError: Missing expected rejection.`

建议修复文件：`plugins/learning/test/store.test.mjs`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/mcp-client/test/media.test.ts：待确认原因（Linux、Windows）

测试文件：`plugins/mcp-client/test/media.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: exit code 1 signal null`

建议修复文件：`plugins/mcp-client/test/media.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/memory/test/loader-acceptance.test.ts：待确认原因（Windows）

测试文件：`plugins/memory/test/loader-acceptance.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected true not to be true // Object.is equality`

建议修复文件：`plugins/memory/test/loader-acceptance.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/memory/test/wp1.test.ts：待确认原因（Windows）

测试文件：`plugins/memory/test/wp1.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected { externalContent: true, …(10) } to match object { externalContent: true, …(4) }`

建议修复文件：`plugins/memory/test/wp1.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/memory/test/wp2.test.ts：待确认原因（Windows）

测试文件：`plugins/memory/test/wp2.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `Error: ENOENT: no such file or directory, scandir 'C:\Users\RUNNER~1\AppData\Local\Temp\memory-wp2-GsH87e\timeline\edit.m'`

建议修复文件：`plugins/memory/test/wp2.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/memory/test/wp3.test.ts：待确认原因（Windows）

测试文件：`plugins/memory/test/wp3.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected [ Array(1) ] to deeply equal []`
- `Error: ripgrep (rg) unavailable in PATH; install rg and expose it to the service`

建议修复文件：`plugins/memory/test/wp3.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/memory/test/wp4.test.ts：待确认原因（Windows）

测试文件：`plugins/memory/test/wp4.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `Error: ripgrep (rg) unavailable in PATH; install rg and expose it to the service`

建议修复文件：`plugins/memory/test/wp4.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/memory/test/wp5.test.ts：待确认原因（Windows）

测试文件：`plugins/memory/test/wp5.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected [] to have a length of 2 but got +0`

建议修复文件：`plugins/memory/test/wp5.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/memory/test/wp6.test.ts：待确认原因（Windows）

测试文件：`plugins/memory/test/wp6.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected [] to have a length of 1 but got +0`
- `AssertionError: expected false to be true // Object.is equality`

建议修复文件：`plugins/memory/test/wp6.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## plugins/native-automation/test/cleanup.test.ts：待确认原因（Windows）

测试文件：`plugins/native-automation/test/cleanup.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: exit code 1 signal null`

建议修复文件：`plugins/native-automation/test/cleanup.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## 原生权限测试遇到非 macOS 平台分支（Linux、Windows）

测试文件：`plugins/native-automation/test/permission-actions.test.ts`、`plugins/native-automation/test/permission-rpc.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected "vi.fn()" to be called with arguments: [ { …(2) }, …(2) ]`
- `AssertionError: expected last "vi.fn()" call to have been called with [ { action: 'permissions' }, …(2) ]`
- `AssertionError: expected true to be undefined`
- `AssertionError: expected { platform: 'linux', result: { …(2) } } to deeply equal { Object (platform, result) }`
- `AssertionError: expected { platform: 'win32', result: { …(2) } } to deeply equal { Object (platform, result) }`
- `AssertionError: expected { state: 'unsupported', …(1) } to be { action: 'location-request', …(7) } // Object.is equality`
- `AssertionError: expected { state: 'unsupported', …(1) } to be { ok: false, …(2) } // Object.is equality`
- `AssertionError: expected { state: 'unsupported', …(1) } to be { permission: { …(2) } } // Object.is equality`
- `AssertionError: promise resolved "{ platform: 'linux', result: { …(2) } }" instead of rejecting`
- `AssertionError: promise resolved "{ platform: 'win32', result: { …(2) } }" instead of rejecting`
- `Error: ENOENT: no such file or directory, scandir 'C:\Users\RUNNER~1\AppData\Local\Temp\yonder-permission-unit-0NHAGD\artifacts'`
- `Error: Helper exited without JSON:`
- `TypeError: Cannot read properties of undefined (reading 'entries')`

建议修复文件：`scripts/yonder-permissions.mjs`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

## 浏览器插件非 macOS 拒绝先于测试断言（Linux、Windows）

测试文件：`plugins/browser-skill/test/plugin.test.ts`。

归属：CORE。

错误原文（同类不同临时路径保留首个代表）：

- `AssertionError: expected '{"source":"BrowserSkill/bsk","error":…' to contain 'disabled'`
- `AssertionError: expected '{"source":"BrowserSkill/bsk","error":…' to contain 'extensionsEnabled'`
- `AssertionError: expected '{"source":"BrowserSkill/bsk","error":…' to contain 'foreign'`

建议修复文件：`plugins/browser-skill/test/plugin.test.ts`；先核实失败路径，在相应平台实现或测试夹具中修正实际原因。

Q02 未闭环；主 Agent 需根据此清单确认根因、补精确修复卡并重跑三平台 CI，DIST-R10 尚未完成。
