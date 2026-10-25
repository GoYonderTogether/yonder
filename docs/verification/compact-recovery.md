# 聊天与压缩恢复统一

2026-10-23；用户授权：复用现有机制，统一重试/回退，补错误记录和提示，真实验证。未安装、重启日用服务、合并或发布。

## 实现

- pi fork 分支 `zoran/compact-recovery`，提交 `f263794abacef09ee0ca59bb0d79ae039ca59c9f`，本地 checkout `/Users/zoran/Documents/github/yonder-pi-compact-recovery`，尚未推送。
- generation/compaction 共用 `modelRecovery`；各自继续拥有原生 checkpoint、取消和提交事务。压缩增加同一 shouldRetry 钩子，Yonder 注册同一 transientModelError 分类。保留已有回退链对所有模型 error 计数的契约，不把鉴权错误策略悄悄改掉。
- 两条请求路径关闭 SDK 隐式重试；原生状态统一负责次数与退避。压缩在模型切换后保留总尝试次数，避免退避从头开始。
- 失败尝试以无 model 正文的 `pi.model-attempt` entry 保存 task、operation、model、attempt、failures、error、action、nextModel/retryAt，与状态提交原子化，不增加队列，不进入模型上下文。压缩耗尽保留最后错误并明确说明 retries/fallback chain exhausted；原历史不删。
- 通过原同步脚本从本机 fork 的完整 commit 同步；仅本次 git fetch 使用进程级 URL 映射到本地 fork。来源 SHA 和第三方说明已更新；远端尚无该提交。

## 最终验证

- pi 原有 generation、generation-recovery、compaction 三组回归：138 通过 / 0 失败 / 0 跳过。原有上游测试含测试夹具，不冒充真实模型验收。
- Yonder `npm run build`、`npm run typecheck` 通过。
- 默认 `npm test -- --maxWorkers=4`：99 文件通过 / 19 文件跳过；424 用例通过 / 0 失败 / 38 跳过，共 462。
- `npm run lint`：退出 0，331 warnings / 14 infos / 0 errors，保留既有告警。
- 真实定向：`YONDER_TEST_REAL=1`，使用仓库既有 auth 文件路径，未复制 OAuth 或输出凭据；agent-network 只向本次测试进程注入代理。fallback.test.ts、recovery.test.ts：7 通过 / 0 失败 / 0 跳过，用时 110.05 秒。成功内容来自真实 Luna/Sol；故障通过真实 loopback TCP/HTTP 注入，不模拟模型输出。
- 覆盖：聊天/压缩的原生退避与重启、手动及阻塞压缩回退、链耗尽明确提示、故障解除后重新压缩、无回退链的 501 失败经宿主分类重试、聊天鉴权/配额排除与取消、不重放已完成工具。

## 原始失败与限制

- pi 首轮 132 通过 / 6 失败：新诊断 entry 和耗尽文案改变旧断言；第二轮 136/2：一处测试预期修改到了等待前的断言；修正位置后 138/0，SDK 重试调整后再次 138/0。断言保留精确顺序并增加诊断不含 model 正文检查。
- pi `npm run check` 首轮包含本次 nextModel 可空类型错误，已修；再次运行无 durable 报错，但全仓仍被 ai 模型目录/SDK 类型不匹配等非本次文件错误阻塞，未声明全仓检查通过。日志 `/tmp/yonder-pi-compact-check.log`。Yonder 使用锁定 npm 依赖的实际 durable 构建通过。
- 首次同步误用短 SHA，fetch 拒绝；继而构建因尚未同步 CompactionHooks 失败。改为完整 SHA 同步后构建通过。
- 真实首轮 5 通过 / 2 失败，另有 1 个未处理流异常：新增测试修改了启动后配置、仍使用旧 retry 快照；另一个真实代理上游断流使旧转发器出现未处理错误并超时。修正为重开隔离 Runtime 和转发流错误后，串行复跑 7/7。未放宽超时、预算或成功断言。
- lint 中间一次 2 个格式错误，格式化后退出 0。原日志 `/tmp/yonder-compact-real.log`、最终 `/tmp/yonder-compact-real-final.log`、默认 `/tmp/yonder-compact-default-final.log`、lint `/tmp/yonder-compact-lint-final2.log`。
- 未验证正式日用服务安装与真实客户端展示；未提交远端 fork 或 Harness PR。

## 发布集成与服务修复（2026-10-25 UTC）

- 本节接续上次本地验收，不覆盖上面的历史状态。用户授权合并、发版、更新日用服务和推送 pi fork。
- pi 正式 `yonder/1.3` 已快进到 `f263794abacef09ee0ca59bb0d79ae039ca59c9f`；从远端用原同步脚本重新核对来源。
- 合入主线 `7cf1a591e3c0ba4336547eebd4f4f8197ac365f4`；保留主线重复回退模型去重、耐心退避和人类错误提示逻辑。
- 日用服务此前在 0.2.26102502 启动循环：home/development/system-snapshot/node_modules 指向已被版本清理删除的 0.2.26102403。原样保留插件源码，将链接改为稳定的安装 current/node_modules。插件 16/16 通过，doctor 通过；服务 PID 58552、ready=true，主会话 2 在 2026-10-25T03:28:11.493Z 恢复后 run.end=done。
- 首次集成检查与远端 fork 同步重叠，导致同步替换目录时 dist/tsconfig 临时缺失：默认测试 559 通过/6 失败/39 跳过、7 文件失败；真实两文件无法导入、0 用例执行。此为验证操作顺序错误。同步完成后顺序重新构建、typecheck、默认测试及 lint 全部退出 0；默认 590 通过/0 失败/39 跳过，99 文件通过/19 跳过。
