# U00 规范批准与来源冻结

**依据**：docs/spec/12-terminal-interaction.md 及其关联 02/03/06–09；D30。

**依赖**：无。

**允许路径**：AGENTS.md、docs/spec/02/03/06/07/08/09/12、docs/architecture.md、docs/index.md、docs/decisions.md、docs/tasks/terminal/、docs/tasks/README.md。

**必须**：记录用户批准，统一待审核文案；冻结 pi coding-agent/tui 1.3.0 复用范围；确认实际公开 UI 导出及运行时耦合。

**验证**：文档 diff 与本地链接检查；不改产品代码。

## 问题

暂无。

## 结果

完成：用户已批准方案与开工。固定 npm pi-coding-agent/pi-tui 1.3.0；已读真实发布包的 InteractiveMode 装配、createChatViewport、CustomEditor、AssistantMessageComponent、ToolExecutionComponent、ExtensionSelectorComponent 与 FooterComponent。前述组件有公开导出；布局 helper 需按 MIT 提取，FooterComponent 依赖 AgentSession，提取时只替换数据来源。没有运行另一套 coding-agent。

实际检查：git diff --check 通过；文档本地链接检查通过。此结果不证明 TUI 已实现。
