# PT-P154 LSP 导航验收记录

以下为实现 Agent 报告的结果，命令未提供，不在此补造。

- 临时 HOME、真实 clangd 后端：2 通过、0 失败；预先取消通过。首轮测试原始结果为 1 通过、1 失败。
- 临时 HOME、真实模型：1 通过、0 失败；仅证明模型调用了工具，测试没有断言后端成功。
- 真实跨文件 rename 验证失败：漏改头文件。当前工具禁用相关 `apply:true` 写入，跨文件授权 rename 未交付。
- `UPDATE_GOLDEN=1` 更新及正常重跑各 7/7；普通本卡测试 1 通过、2 跳过。工具注册契约由本卡测试守护，无通用工具 golden。
- 全仓 TypeScript 检查有并行修改的其他文件两处错误；文件大小检查有两处并行文件超限。
- 未测：执行中取消、T05 缓存索引、核心 find/ls 未选工具规则。

## P154r3 补充复现（2026-10-28）

- 在同一个真实路径的临时 C 项目中，用真实 clangd 和 pi-lens rename 预览：包含 `compile_commands.json`（`clang -c value.c`）时，WorkspaceEdit 包含 `value.c` 的两处和 `value.h` 的一处；只移除该文件后，WorkspaceEdit 仅包含 `value.c` 的两处。因此这次漏改发生在 clangd 返回编辑时，编译数据库缺失使头文件未进入结果；不是写入阶段丢弃了头文件。测试还观察到 macOS `/var` 与 `/private/var` 别名可使同一文件以两个 URI 重复出现。
- 已有 `apply:true` 仍禁用。MCP LSP 操作忽略取消信号，并在后端直接顺序写入；即便先取得预览，当前也无法判断 clangd 是否遗漏文件，不能把部分编辑当成完整 rename。SDK 新增的 `authorizeFileWrite` 可用于逐文件授权，但尚未接入此工具；中途取消后的已写文件报告也未实现。
- 实测命令：`PATH=/tmp/yonder-p154.j6R1jT/bin:$PATH YONDER_LENS_REAL=1 npx vitest run plugins/code-intel/test/lsp-navigation.test.ts`，正常路径及两次诊断变体各 2 通过、0 失败；第一次使用本机 pi-lens 时缺 `@earendil-works/pi-tui`，1 通过、1 失败。上述是预览，不是实际写入验收。TS 跨文件 rename、C/TS 授权写入和执行中取消均未测；本机未发现 `typescript-language-server`。
