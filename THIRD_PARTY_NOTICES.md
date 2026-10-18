# 第三方代码声明

## pi coding-agent 1.3.0

来源：[earendil-works/pi](https://github.com/earendil-works/pi)，npm 包 `@earendil-works/pi-coding-agent@1.3.0`。

- `packages/coding-agent/src/core/auth-storage.ts` 的 `FileAuthStorageBackend` 异步文件锁与读写语义，复制并适配到 `packages/core/src/runtime/credentials.ts`。没有复制同步缓存、命令凭据解析或其他程序的凭据。
- `packages/coding-agent/src/core/provider-composer.ts` 的模型字段缺省与合并逻辑，复制并适配到 `packages/core/src/runtime/models.ts`。
- `packages/coding-agent/src/core/model-config.ts` 的模型配置校验 schema，复制到 `packages/core/src/runtime/model-schema.ts`。

[原许可证](https://github.com/earendil-works/pi/blob/main/LICENSE)：

```text
MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 原生 pi 终端界面 1.3.0

- 精确依赖 `@earendil-works/pi-tui@1.3.0`、`@earendil-works/pi-coding-agent@1.3.0`，来源 `earendil-works/pi` tag `v1.3.0`，沿用上述 MIT 许可证和版权。
- `packages/cli/src/pi-native.ts` 仅加载同包的 UI helper：`modes/interactive/chat-viewport.js`、`tui-renderer.js`、`theme/theme.js`、`components/status-indicator.js`、`core/keybindings.js`、`core/tools/renderers/index.js`。默认布局、主题、键位和工具渲染直接使用上游代码。
- `packages/cli/src/vendor/pi-footer.ts` 提取自该 npm 包 source map 中原始 `packages/coding-agent/src/modes/interactive/components/footer.ts`；只将 AgentSession/SessionManager 数据访问换为实际 Yonder 控制面快照，移除 Yonder 未使用的实验/虚拟模型分支。原有行布局、宽度处理、统计格式、样式和模型对齐渲染保留。无 pi 会话文件、模型循环或第二 runtime。
- `terminal.ts` 直接使用上游 CustomEditor、AssistantMessageComponent、UserMessageComponent、ToolExecutionComponent、SessionSelectorComponent、ExtensionSelectorComponent 与 ExtensionEditorComponent；数据与动作接 Yonder。会话删除改为明确拒绝并提示 `/close`，保留历史。
