# T01 仓库骨架

**依据**：`docs/tasks/README.md`（仓库布局一节）、`docs/spec/07-runtime.md:3-8`（§1）、`docs/spec/04-plugins.md:9-30`（§2 清单格式）

**路径**：根目录配置文件、`packages/*/`、`plugins/*/` 的空骨架。

**必须**
- npm workspaces；三个包与两个插件各自有 `package.json`、`tsconfig.json`、`src/index.ts`（只导出空模块，不写占位功能）。
- 插件的 `package.json` 带 §2 规定的 `yonder` 清单字段，`contributes` 留空数组，由 T10 填写。
- 根脚本：`build`、`typecheck`、`test`、`lint`。
- pi 依赖只写在 `packages/core/package.json`，精确版本取 T00 记录的版本。
- `.gitignore` 包含 `node_modules/`、`dist/`、`.yonder/`、`HANDOFF.md`。

**禁止**：任何业务代码。

**验收**：`npm install && npm run build && npm run typecheck && npm test` 在干净克隆上通过（测试为零个也算通过）。

## 问题

（无）
