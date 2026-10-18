# U02 原生 pi 界面接线

**依据**：docs/spec/12-terminal-interaction.md 及其关联 02/03/06–09；D30。

**依赖**：U01。

**允许路径**：packages/cli/src/、packages/core/src/kernel/、packages/core/src/runtime/、packages/cli/src/index.ts（必要控制接线）、packages/cli/package.json、package-lock.json、THIRD_PARTY_NOTICES.md、docs/tasks/terminal/、CHANGELOG.md。

**必须**：按 spec/12 §2/4/5/6 直接复用 1.3.0 上游布局、消息、编辑、主题、补全、选择与键位，只适配 Yonder 数据与动作。保留复制模块来源和修改范围。

**验证**：构建/类型；原生组件运行与动作检查；PTY 运行可读到真实会话，布局/键位不得改成自研版本。

## 问题

暂无。

## 结果

已实现，整体验收挂 U04。精确依赖 pi-tui/coding-agent 1.3.0；直接调用上游 createInteractiveTui/createChatViewport、主题、键位、消息、工具渲染和选择器。底栏按 MIT 提取，仅替换数据访问；来源详见 THIRD_PARTY_NOTICES。控制面补实际模型信息与原生 inbox 读取/撤回用于上游后续输入操作。

实际运行：隔离 home /tmp/ytui-live-H31ffU，真实 PTY 已显示 slash 菜单和双语候选；Luna 执行 pwd、工具结果和中文回复进入原生组件。发现同一 final 的尾部流更新导致额外 partial，已将运行期消息 id 收束到实际 entry id；修复后复验挂 U04。首次构建发现两项类型适配错误，已修复，构建通过。未替换日用安装。
