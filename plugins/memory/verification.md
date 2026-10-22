# memory 工作包验证

## WP1

范围：包骨架、全量配置 schema 与字段级语义校验、初始化触发器、memory_status；清单仅声明本阶段已注册的工具与触发器。memory-bootstrap 当前只做初始化，attention/周期审计属 WP6。

文件：根 package.json、tsconfig.json；plugins/memory/{package.json,tsconfig.json,README.md,verification.md,src/config.ts,src/files.ts,src/status.ts,src/index.ts,test/wp1.test.ts}；proposals/memory/open-questions.md（Q1–Q3 裁决记录）。

### 原始检查记录

- 首次格式预检 `npx biome check --write plugins/memory package.json tsconfig.json`：失败，9 文件，2 errors（隐式 any）、6 warnings；已修正错误。
- 首次完整链在 `npm run build` 失败：1 个 TS2375（exactOptionalPropertyTypes 下 version 可能 undefined）；后续 typecheck/test/lint 因 && 未执行。已修正。
- 修正后执行完整链 `npm run build && npm run typecheck && npm test && npm run lint`：全部退出 0。
- build：1 次通过 / 0 次失败 / 0 次跳过（另保留上述初次失败）。typecheck：1 次通过 / 0 次失败 / 0 次跳过；这些命令无测试用例计数。
- npm test：Tests 200 passed / 0 failed / 23 skipped（223）；Test Files 53 passed / 0 failed / 11 skipped（64）。memory WP1 的 5 项均通过。默认跳过的真实模型等用例未测，未设置 YONDER_TEST_REAL，未读取凭据。
- lint：223 files，0 errors / 190 warnings / 1 info，退出 0。保留仓库原有诊断及本插件非空断言警告；无断言削弱。
- 独立调用 `checkPlugin(plugins/memory)`：通过，errors=[]；包内契约测试也调用同一函数。

### 已验证

- setup 仅注册，不创建目录；触发器 start 初始化；重启不覆盖已有 SCHEMA.md 与 me/now.md 字节。
- root 与登记目录相同、两方向包含、符号链接别名重叠均在 setup 配置验证阶段报 roots[0].path 错误；不初始化。
- 配置必填项、时区、绝对路径、所有嵌套字段与错误值校验。
- 真实临时目录中的 inbox 计数、私密内容排除、外部内容标记、工具 read/admin 能力；rg --version 在当前进程 PATH 可用。

### 未验证与边界

- 未做真实模型、正式安装、服务进程 PATH、Obsidian/微信归档与端到端采集验收。
- 无新增下载依赖；精确使用已安装的 SDK 0.2.26102103、typebox 1.3.27、yaml 2.9.1。仓库根 package-lock.json 按本轮路径限制未修改，未声称 npm ci 的新增 workspace 锁文件接线已验证。
- WP2–WP7 的能力未实现；不把初始化触发器注册视为 attention 节律完成。
