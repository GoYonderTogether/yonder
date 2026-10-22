# BrowserSkill fork B 轨验收（2026-10-22）

状态：实现与隔离 source integration 已完成，待审核/合并。未部署 Yonder，未修改生产 home、真实 Chrome profile/policy、TCC 或服务。没有真实模型调用；不将源码插件集成冒充已安装 Yonder Agent 的验收。

## 来源与交付

- 上游最新 main：`6214e3d`，最新发行 cli-v0.3.3；书签提交重放为 `b55284f`。
- fork：[`8500bcbdf2e6bf0d19c33a9b156ba62a07f85ade`](https://github.com/zoran-xc/BrowserSkill/commit/8500bcbdf2e6bf0d19c33a9b156ba62a07f85ade)，分支 [yonder/bookmarks-0.3.3](https://github.com/zoran-xc/BrowserSkill/tree/yonder/bookmarks-0.3.3)，只推 fork，无 Tencent 写入。
- 上游 [PR #434](https://github.com/Tencent/BrowserSkill/pull/434) 仍 OPEN，旧 head f9b180b；未更新，因为本轮重放改写提交、增加 Yonder 特定管理与更新保护，不 force-push 共享 PR 分支。
- 对比、平台资料及精确 OWNER STEP：[七级路线](../research/chrome-extension-install.md)，设计 D54，插件入口 [index.ts](../../plugins/browser-skill/src/index.ts)。

## 实际验证

| 检查 | 原始结果 | 说明 |
|---|---|---|
| Rust workspace 首轮及最终轮 | 每轮 878 passed / 0 failed / 1 ignored；46 summaries | `cargo test --workspace --locked -j 4 -- --test-threads=4`，持有共享 heavy-test lock；首轮与最终源码复跑结果相同，原始结果分别保留 |
| Extension 全套（两轮） | 每轮 2693 passed / 0 failed / 248 skipped；174 files passed / 33 skipped | 最终轮使用 `pnpm --filter @browser-skill/extension exec vitest run --maxWorkers=4`。首轮 pnpm 转发多了一个 `--`，因此重跑显式限制 workers；未把 browser opt-in skips 当通过 |
| VOM | 82 passed / 0 failed | 3 files，maxWorkers=4 |
| DSH 插件 | 541 passed / 0 failed | 25 files，maxWorkers=4；Vite 有 sourcemap 缺失警告，不影响测试退出码 |
| i18n | 64 passed / 0 failed | 2 files，maxWorkers=4 |
| browser eval 基础脚本 | 25 passed / 0 failed / 0 skipped / 0 cancelled | Node 原生 test-concurrency=4；非全部真实页面/browser case |
| Yonder 插件最终 focused | 17 passed / 0 failed | 含 opt-in、参数边界、UTF-8 分块；早期 16 passed 的结果保留 |
| Yonder 全套 | 首轮 251 passed / 0 failed / 26 skipped；最终 252 passed / 0 failed / 26 skipped | 56 files passed / 13 skipped；新增 UTF-8 测试后复跑，maxWorkers=4，持锁 |
| Build/typecheck | Rust release、扩展 build、扩展 tsc、Yonder build/typecheck 均通过 | 最终 CLI 用 BSK_FORK_BUILD=1 编译；并非仅设置运行环境变量 |
| Lint | Rust fmt/clippy、fork Biome/stylelint、DSH typecheck 通过；Yonder lint 退出 0 | Yonder 204 warnings + 1 info，未顺手清全仓；fork 首轮 formatter 失败位于旧书签补丁 test 数组，已只修该行格式 |
| 实际安装 CLI → 临时 daemon → CfT → 构建后 Yonder 插件 | 1 passed / 0 failed；CfT 155.0.8059.39 | fixture 创建隔离 BSK_HOME、profile、临时扩展副本；manifest 只在测试副本将 bookmarks/management 提升为安装时权限，不能证明真人点击授权已完成 |
| Bookmarks 原生能力 | tree/create-folder/move/remove-empty-folder 成功 | URL 书签/非空文件夹/根修改被拒；中文、emoji、重复 URL 与 ID/顺序保留。另通过真实构建后的插件启动 owned session，执行四动作，拒绝删非空文件夹并清理 |
| Extensions 原生能力 | list/disable/enable 成功 | 对一次性测试扩展执行；不触及真实 profile。uninstall 因手势失败，移除工具动作，改 OWNER STEP |
| 默认 doctor | 7 ok / 1 fail，退出 1 | 共享 daemon 协议 1.3，新 CLI 1.4；未重启。doctor 不是全绿，不能宣称真人 Chrome 已就绪 |
| update 保护 | 显式 update 被拒，退出 2；安装文件哈希未变 | fork 编译关闭自动与显式上游更新；旧共享 daemon 未重启，其未来行为不由新二进制控制 |

测试源码入口：fork `apps/extension/src/tools/__tests__/bookmarks.browser.test.ts`，设置 `BSK_BOOKMARKS_CHROME` 为 CfT 可执行文件、`BSK_BOOKMARKS_BSK=/Users/zoran/.local/bin/bsk`、`YONDER_PLUGIN_ENTRY=<此 worktree>/plugins/browser-skill/test/bookmarks-live.mjs`，再在 fork 执行 `pnpm --filter @browser-skill/extension exec vitest run src/tools/__tests__/bookmarks.browser.test.ts --maxWorkers=4`。测试只建立自己的浏览器/daemon，结束后删除临时资源。

[原始摘要与失败记录](browser-skill-fork/results.txt)；[实际运行 popup 预览](browser-skill-fork/popup.png)。完整执行日志留在本机 `/private/tmp/yonder-r2/B-*.log`。

## 安装记录

安装 `/Users/zoran/.local/bin/bsk` 的 SHA256：`be10b8f04f1fad73adddf40b7418e5bb0c86a3adb04bea076af0a47ae5f81538`。
替换前备份 `/Users/zoran/.local/share/browserskill-fork/backup/bsk-before-r2-20261022T050023Z`，SHA256 `900c85d168a4a23f19767aa918b4de4c2ae0097cd298fca3691b89843935bb58`。
旧扩展与 build.json 同时保存在 backup 的对应 before-r2 路径，历史备份未删。
扩展待加载目录 `/Users/zoran/.local/share/browserskill-fork/chrome-extension`；build.json 记录精确 fork commit、hash、安装日期及未执行 profile 授权事实。

## 失败、阻塞与未测（保留）

- 首次 cargo 包名误写 bsk-cli（实际为 bsk），构建未开始；改正后构建成功。
- 首次 npm ci 因复制旧插件 manifest 的 SDK 版本为 0.2.26102103 而 404；恢复本 worktree 0.2.26102106 版本后成功，不发布旧版本。
- 真实集成前两轮失败 unknown_method（1 failed、以及 1 failed+1 passed），定位到 daemon forwarding 缺少新扩展方法，已补齐；第三轮 1 failed 为 Chrome 卸载要求手势，移除半工作的 uninstall 后第四轮和实际安装 CLI 轮均 1 passed。
- fork 首轮 lint 1 formatter error，已修正书签旧测试数组格式；Yonder 首次 fetch/rebase 因尚未提交的任务改动拒绝，未丢弃或 stash 用户文件，提交后正常重做。
- CWS 发布缺主人账号/凭据，未创建账号、未 upload/publish；审核通常数日，可能数周，不能保证立即可安装。External JSON / 企业策略不应用；R2 依据任务允许的官方文档路径说明。
- 临时 CfT 商店 Add to Chrome disabled；Developer-mode 页面可打开，但未自动接受文件选择或原生确认。真人 Chrome 商店安装、扩展 reload/permission、生产插件配置与真实模型测试：**未测**。
- Windows/Linux 原生平台及上游 opt-in 真实 browser 用例未在本机全覆盖。

## 必须由主人完成

先确认共享 BrowserSkill 无活动任务，在终端运行 `bsk daemon stop`，再 `BSK_AUTO_UPDATE=off bsk daemon start`（使用已安装 fork）；在目标真实 Chrome profile 加载/reload 上述匹配扩展，并在 popup 连接、授予需要的可选权限，最后重新运行 doctor。未完成之前，生产 daemon/profile 仍不匹配，且旧 daemon 未来可能继续按其原策略更新。Yonder 合并/部署后才在获准配置启用工具。安装任意商店扩展、卸载及 CWS 首发操作详见[完整 OWNER STEP](../research/chrome-extension-install.md#owner-step)。
