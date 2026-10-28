# V03r3 Hermes alias 验证

- 原始记录：发布基线 `c81bbf02` 的 `alias.test.mjs` 失败（任务报告；原始运行的完整输出和计数未提供）。
- 修复候选 `cb20405` 已包含在 main，修改 Hermes skill 文案以同步 learning；本任务未重复修改文案。
- 当前工作区运行 `npx vitest run plugins/hermes-experience/test/alias.test.mjs`：3 项中 2 通过、1 失败；失败为 `learning.status` 视图不属于 `hermes-experience` 命名空间且未声明。运行时 learning 插件存在并行未提交改动。
- 针对文案同步断言运行 `npx vitest run plugins/hermes-experience/test/alias.test.mjs -t 'alias recipe and bundled skill stay in sync'`：1 通过、2 跳过。
- 曾误用 `node --test` 运行 Vitest 文件：运行器找不到 Vitest suite，1 失败；随后使用正确运行器重测，结果如上。
- 未执行 `migrate --apply`。
