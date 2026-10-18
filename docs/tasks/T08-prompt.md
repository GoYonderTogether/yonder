# T08 提示词组装

**依据**
- `docs/spec/03-agents.md`（§5 全部）、`29-41`（工作区内容与自动生成）
- `docs/spec/04-plugins.md`（§3.3 上下文贡献）
- `docs/spec/06-delivery.md`（框架段要讲的规则）
- `docs/spec/09-cli-release.md`（版本通知）

**路径**：`packages/core/src/prompt/`

**必须**
- system 五段的顺序与确定性规则；第 ③ 段（skill 索引）在 T13 之前没有内容；只调用 `contexts` 选中的贡献。
- 框架段：内容只覆盖 03 §5.2 与 06 §4 列出的点；英文，不超过 250 词；`yonder` 命令那一句只在配置档有 `exec` 时出现。
- `<turn>` 块格式严格按 03 §5.3：`from`、`attachment` 行；`http(s)` 附件下载到 `<home>/.yonder/attachments/`；模型支持图片时图片附件转为图片块（交给 T05 的 submit）；会话 `version` 与当前版本不同时加 `notice` 行并更新 `version`；`wake: write` 时的简化形式。
- `placement: turn` 的贡献追加在 `<turn>` 之后，`RenderContext.event` 为当前事件。
- 初始化 agent 时写入 `SYSTEM.md` 模板（03 §5.4）；选中的上下文贡献缺文件时按 `scaffold` 生成。

**禁止**：在 system 中放时间或其他每次变化的内容；虚构人设或示例对话。

**验收**：同样输入渲染两次逐字相同；T10 的 context-files 仅在选中时进入 system，未选中的贡献不被调用（计数断言）；`<turn>` 块快照测试（含附件、通知、write 形式）；框架段词数测试。

## 问题

- 图片已按模型输入类型、单条/请求张数和已知字节数筛选；尺寸与未提供 bytes 的本地图片、已有历史图片对请求总限额的影响尚未做真实模型验收。
- http(s) 附件会下载到主机 home；远程执行环境读取这些主机附件的组合路径尚未验收，留第二轮核实。

## 结果

第一轮：已实现（待验收）。

- 实现英文框架、SYSTEM.md、skill 索引插槽、按配置顺序调用的 system/turn 上下文；instructions 由 pi 追加末尾，不重复拼接。
- 实现带身份、附件与版本通知的 turn 输入；write 形式只保留时间、身份和附件环境信息；http(s) 下载保存到 home 附件目录。
- 实现空人设 SYSTEM 模板与选定上下文文件生成，工作区文件通过执行环境访问。
- 实际检查：核心 `tsc -b` 通过；提示词最小测试 1 文件/1 测试通过（两次结果一致、未选贡献不调用、框架词数与 exec 文案）；本目录 Biome 通过。首次检查的测试类型错误已修正。未执行完整附件/版本/真实图片验收。
