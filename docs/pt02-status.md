# PT-02 实施记录

- `task_run`：保留公共名和参数；压缩描述，委派边界、结果核验、后台回传移入按实际提供加载的指南。未改变权限或预设选择。
- `message_send`：保留公共名、参数和投递语义；接收者来源、自动投递与不确定结果处理移入指南。
- `process`：保留同一操作入口和权限，缩短描述；句柄来源、自动回传及不可逆副作用移入指南。
- `tool_search`：沿用 pi 搜索和延迟加载；描述与指南明确下次模型请求可见，不修改搜索实现。
- 本批未合并任何公共工具，未改用户显式 offer；§7 其他条目、官方默认选择和插件逐项优化待续。

2026-10-28 源码装配快照，近似 token = ceil(UTF-8 字节/4)：main system 2533、指南 315、描述 2246、参数 schema 3966，合计 9060；executor 分别 2409、315、795、1290，合计 4809；default task 分别 2197、315、1080、1534，合计 5126；coding task 分别 2245、315、738、1222，合计 4520。system 为现有 `systemPromptParts` 合并估算，指南按选中工具去重；schema 和描述缺少并行新增的 find/ls，插件来自已有 dist，且不含协议包装，因此不是完整请求或精确计费；main 的 schema 已超过 2000，不能声称预算达标。后续在同一构建 commit 捕获真实请求补齐缺项，单列扩展 profile 和已发现 schema，逐项优化后复测。

真实模型首次尝试：临时 HOME、siliconflow/deepseek-ai/DeepSeek-V3.2，1 测试失败、0 通过；约 125 秒时临时目录锁被移除，报告 `ECOMPROMISED` / `Lock is already released`，未取得搜索与工具调用证据。未验证错误后按 hint 纠正；需在稳定临时 HOME 下复测，不用本次结果声称模型验收通过。

2026-10-28 第三轮：新 init 默认常驻 read/write/edit/bash，其他已选且有权限的工具按需搜索；未显式设置工具的配置档使用同一默认，已有显式 offer 且未设置 search 保持空 search。bash 的操作规则从描述移到指南。审计：默认以外的内核和所选插件工具均通过现有 catalog 的权限与插件选择过滤后按需加载，未选插件仍不可发现；未逐个重写各插件 schema。

当前源码对应的五个默认工具参数 schema 以 JSON UTF-8 字节 / 4 上取整估算共 444（read 76、write 57、edit 194、bash 61、tool_search 55；逐项取整之和与整体不同），不含协议包装，不是实际模型 tokenizer。仅缩减描述或移动指南不改变参数契约；实际请求 token 仍待验证。

第三轮真实验收：干净副本 HEAD 为 `12b259c`；`verify-copy.sh` 因其他卡验收 HOME 活跃拒绝更新，不能记为脚本成功。`verify-home.sh` 创建临时 HOME `pt02r3` 并启动成功，验收后已停止。指定真实模型 `siliconflow/deepseek-ai/DeepSeek-V3.2` 的 `real-check.sh` 三次均 done：搜索后调用为 `tool_search(find) → find → bash → bash`（42.7 秒）；错误后纠正为 `read(missing-pt02-file.yaml) → read(agent.yaml)`，模型报告 ENOENT 后纠正（45.0 秒）；按需加载非默认工具为 `tool_search(ls) → ls`（27.1 秒）。以上为 transcript 调用顺序；精确 token 未测，444 仅为上述字节估算。

再次执行 `verify-copy.sh` 检出 `0edb8ee`（包含 `12b259c`），全仓 build 失败：并行修改的 `plugins/code-intel/src/ast-grep-replace.ts:46,48` 引用缺失的 `ToolContext.authorizeFileWrite`。本次真实模型三项结果来自先前已构建副本，不将本次构建记为通过。
