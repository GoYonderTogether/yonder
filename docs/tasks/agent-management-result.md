# X3 Agent 热管理结果

主路补记：1907已正式发行安装；正式main/maintainer热更新工作说明均返回校验/保存/接纳成功，restartRequired=false，见[整轮结果](execution-capabilities-result.md)。本轮没有为验收新增正式Agent，真实忙碌归档/渠道/TUI组合未测保留。

分路原交接（2026-10-19）：源码已实现，整体集成、真实忙碌/渠道/TUI与正式安装验收由主路续验。不切分支、不提交、不推送，未修改正式 home。

## 变化

- `id` 保留机器引用与历史身份，`name` 为昵称，新增可选 `work`。注册项新增 `archivedAt`，Map 保留归档对象供历史和既有运行解析；默认 main 不提供归档。
- `agents list/show/create/update/validate/archive/remove/restore` 与 `presets list/show/create/update/validate/remove` 经既有 management RPC。写入请求使用 `--file <JSON>`；Agent create 额外指定 `--preset <id>`，并明确 name/work/owner/bindings，可选 profile 覆盖。
- 模板复用现有 Profile 默认值、解析与 SYSTEM/选中上下文 scaffold；未指定权限为 readonly，不复制主Agent权限。注册ID或目标目录已存在时拒绝，不覆盖原目录、不递归删除工作区。remove Agent 等价 archive。
- watcher 重新读取唯一注册来源 yonder.yaml.agents，与全部 Agent、home preset 一起校验，成功后原位更新共享 Map 和有效注册项；失败保留整份旧有效状态。服务内管理请求串行化，文件写入使用现有 proper-lockfile；注册/preset 使用临时文件替换，命令等待实际 reload 结果。
- 开放会话保护 Agent/profile/preset 引用及 workspace/env（包括已选profile的有效env）。保留运行配置快照。非 Agent 的 yonder.yaml 字段仍需重启；管理写入保留其磁盘内容，返回 restartRequired，并在后台发现时报告。
- CLI JSON 保留内部id；原生 TUI 发言人、底栏、渠道选择、会话选择改用昵称/工作投影。自管理skill按实际命令更新。
- 按主路最新接纳规则，归档仅禁止新输入，既有任务自然完成，不按忙碌状态拒绝归档。新输入准入由主路的 routing/sessions 接线，历史读取与 resolveSession 不应拒绝归档对象。
- 为X5添加 limits.maxTokens 可选正整数与默认200000；实际软提醒由主路Runtime实现。为cron接入 execution.resolve/run：核对真实session所属agent/profile，归档拒绝新执行，检查创建能力和当前能力都含exec，调用主路Runtime.executeCommand。

## 实际检查

- `npx vitest run packages/core/src/kernel/management.test.ts packages/core/src/kernel/kernel.test.ts packages/core/src/config/config.test.ts packages/cli/src/index.test.ts packages/cli/src/completion.test.ts`：**5 files、10 tests passed**，0失败/跳过。隔离真实home和真实Kernel，不调用或伪造模型。
- 新聚焦流程覆盖 preset创建/修改/删除、模板生成并服务接纳、昵称工作修改、非法模型拒绝且文件不变、已注册ID拒绝、归档恢复、默认main归档拒绝、开放preset引用删除拒绝、并发管理写入、保留待重启字段、无效外部注册保留旧有效配置。
- 真实CLI离线流程：init → preset create → agents create/show/archive/restore，JSON返回 saved=true、valid=true、accepted=false，readonly默认和真实临时workspace吻合；临时home已删除。
- 当前改动文件经Biome格式化；check无error，保留仓库已有及局部non-null等warning，不作无关清理。
- 初次typecheck因共享execution/Runtime接口尚未落地失败；主路接线后最近一次X3无类型错误，整仓仍因主路进行中的runtime/background字面量与readonly类型报错。最终build/typecheck以主路整合结果为准，不能将本记录解释为整仓通过。

## 未测与边界

- 未在正式home创建、改名、归档或迁移任何Agent；未安装/重启日用服务、未发外部消息、未触发真实模型。
- 未以真实运行模型验收归档时在途/排队任务继续、权限快照与后台任务恢复；未验证归档后实际渠道不再路由；这些依赖主路新准入和Runtime整合。
- TUI接线已实现，尚未提供实际PTY图像验收。源码/UI投影及CLI成功不等于真实画面、真实模型或正式安装验收。
- 默认main归档明确拒绝；本轮不增加defaultAgent迁移契约。模板不设计人格、不创建灵魂内容、不装新插件，不提供真实删除或目录迁移。
