# T01 仓库骨架

**依据**：`docs/tasks/README.md`（仓库布局一节）、`docs/spec/07-runtime.md:5-11`（§1）、`docs/spec/04-plugins.md:9-30`（§2 清单格式）

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

### 源码审查（2026-10-18）

修正根 test 脚本，排除 dist，移除 passWithNoTests。原入口把源码与编译产物重复计数；修正后 npm test 为 15 文件通过、1 跳过，17 测试通过、1 跳过。跳过的真实模型检查另行真实通过。原始重复结果保留在审查报告。

完整证据、未完成项和设计问题见 [第一轮源码审查](review-first-pass.md)。本节不替代原定验收；任务保持原状态。

### 第一轮原记录

（无）

## 结果

**改了什么**
- 根：`package.json`（npm workspaces，脚本 `build`=`tsc -b`、`typecheck`=`tsc -b --noEmit`、`test`=`vitest run --passWithNoTests`、`lint`=`biome check .`）、`tsconfig.base.json`（严格模式、NodeNext；`rootDir`/`outDir`/`include`/`tsBuildInfoFile` 用 `${configDir}` 统一放在这里，构建信息落在各包的 `dist/` 里，删掉 `dist` 就一定会重新构建）、`tsconfig.json`（项目引用）、`biome.json`、`package-lock.json`；`.gitignore` 删掉已不存在的 `spike/`。
- `packages/sdk`、`packages/core`、`packages/cli`、`plugins/channel-cli`、`plugins/context-files`：各自的 `package.json`、`tsconfig.json`（只写 `extends` 与 `references`）、`src/index.ts`（`export {};`）。依赖方向：core、cli、插件依赖 sdk，cli 依赖 core。
- 插件清单：`apiVersion: 1`、`id`、`entry: ./dist/index.js`，`contributes` 分别是 `{ "channels": [] }`、`{ "contexts": [] }`。
- pi 依赖只在 `packages/core`：`@earendil-works/pi-ai`、`pi-durable`、`chord` 均为 `1.3.0`。

**新增依赖（全部精确版本，dev）**：`typescript@7.0.2`、`vitest@5.0.5`、`@types/node@22.20.5`（与 `engines` 的 Node 22 下限对齐，避免用到 22 没有的 API）、`@biomejs/biome@2.5.15`（任务要求 `lint` 脚本而规范没指定工具；Biome 一个依赖同时做 lint 与格式检查，不需要插件）。

**测试**：在干净克隆上 `npm install && npm run build && npm run typecheck && npm test && npm run lint` 全部通过（vitest：No test files found，按 `--passWithNoTests` 退出码为 0；Biome：19 个文件无问题）。另做了一次临时探针（已删除）：core 里 import pi-ai、pi-durable、chord 的类型与值，TS 7 能通过类型检查，Node 运行时能加载。

**偏离规范之处**：无。
