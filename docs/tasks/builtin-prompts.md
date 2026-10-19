# 内置提示词落地与独立验证

2026-10-19：用户批准将当前 v4 中文设计落地源码并提交 commit，委派 sub-agent 验证该 commit 的真实装配与本机 Luna 调用；主 agent 继续提交官方角色方案供讨论。没有授权更新正式安装或落地官方角色插件。

## 范围与路径

- docs/spec/03-agents.md：新增非插件底座与动态运行事实的装配契约。
- docs/decisions.md：记录本次批准。
- docs/prompts/builtin.zh-CN.md：v4 等义中文审阅源。
- packages/core/src/prompt/content.ts：完整等义英文内置正文，随 TypeScript 编译，无额外资源复制或运行加载依赖。
- packages/core/src/prompt/index.ts：实际装配与 turn 运行事实。
- packages/core/src/prompt/index.test.ts：有/无身份与执行能力、装配次序、稳定性与元数据边界。
- 本任务文件：原始验证结果与独立验证入口。

保持用户 SYSTEM、所选上下文、技能索引及 profile.instructions；常驻身份只给真实 Agent，CLI 导航只给 exec。日期等动态事实不进入 system。身份模板仍为空段，不安装初始化插件或官方角色，不改 pi 运行/存储系统。

## 验收

相关现有检查与构建通过后提交本任务。独立验证者对明确 SHA 使用隔离 home 和真实 openai/gpt-6-luna，观察最终 provider 输入而非只看文件；常驻/task、exec/readonly、稳定正文、动态事实与工具权限分别验证。凭据只由受信任程序读取，不复制生产 OAuth，不修改正式服务。

## 结果

正文已以等义英文常量接入真实 systemSections；共同/运行共享、常驻身份与exec导航按条件装入，中文审阅源保留。运行输入新增软件version/home、实际env/cwd、宿主prepared时间/时区/platform；write背景不带这些环境快照，事件原时间保持。

- 聚焦 `npx vitest run packages/core/src/prompt/index.test.ts --exclude '**/dist/**'`：1文件、3通过、0失败、0跳过。覆盖稳定性、次序、所选context、无身份任务不读工作区、exec与readonly、动态事实和write区别。
- Biome检查3个变更TS文件最终通过。第一次有2个格式错误，自动修复后重查通过，没有删除检查。
- 共享工作区 `npm run build` 失败，原日志 `/tmp/yonder-builtin-prompts-build.log`：并行执行能力实现中的kernel引用尚无类型定义的`KernelServices.execution`与`Runtime.hasPendingWork`。它们不在本任务路径；没有擅自修改或把该失败写成通过。
- 准确提交随后交独立验证者 git archive 到隔离目录重建、typecheck与真实Luna验证。独立结果以实际轨迹另记；源码提交不代表正式安装生效。
