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

## WP2

文件：新增 src/{calendar,capture,records,store}.ts、test/wp2.test.ts；修改 src/{index,status}.ts、package.json、README.md、verification.md；整理 proposals/memory/open-questions.md 的 Q4 已裁决状态（依据 c5f8e9d）。

### 原始检查记录

- `npm run build` 初步构建：通过，0 TypeScript 错误。
- 新增测试后执行 `npm run build && npm run typecheck && npm test && npm run lint`：全部退出 0，build/typecheck 各 1 通过 / 0 失败 / 0 跳过，无用例计数。
- npm test：Tests 207 passed / 0 failed / 23 skipped（230）；Test Files 54 passed / 0 failed / 11 skipped（65）。memory 共 12 项（WP1 5 + WP2 7）通过。
- lint：228 files，0 errors / 204 warnings / 1 info，退出 0。格式预检仅警告，无失败。
- 独立 checkPlugin：通过，errors=[]（另由 WP1 的契约测试再次调用）。

### 已验证

- 时区、DST、跨年 ISO 周、周四定月；40 个并发真实文件追加不丢行、id 不重复、日期标题不重复。
- 正文换行/空行/原有缩进与 CRLF 保留；整理仅翻标记和追加去向，重复整理无写入；周节替换/追加不改末尾记录流。
- 真实文件在读改写期间被修改：第一次冲突重读保留用户文本；第二次冲突拒绝，文件保留第二次用户编辑，原子写临时文件清理。
- 长正文完整存 raw；来源及多行标题 frontmatter；material 忽略 by，发出 memory.captured 的契约参数；私密双来源同月追加，不进入 timeline；补记到达顺序不重排。
- 未来日期、非法日期、material+private、未知参数、缺写能力、已取消调用被拒；日志仅元信息，无正文。status 的积压年龄改用记录日期标题与时间，支持补记。

### 仅实现未做端到端验收

- material 事件经 SDK 注册收集边界验证了发出参数；未接真实 Harness 事件库或绑定唤醒模型。
- mtime 按规范在原子写临时文件创建后、内容写入前比对；未做跨进程压力或外部编辑器与最后 rename 同时发生的实时竞态验收。
- 未运行真实模型（默认 23 skipped 保留），未访问用户 Obsidian/微信，未安装服务。
- SDK collector 仅用于注册/事件调用边界，文件操作全部为临时目录中的真实 FS；未模拟模型或文件系统。
- 精确依赖及用途见 README。npm 的 workspace 过滤安装报告 no workspace folder present，退出 0 但未安装目标包；确认后在隔离 /tmp 前缀安装相同精确版本并将 node_modules 放到 plugins/memory/node_modules（忽略目录），构建使用真实包。临时目录已清理；未修改根 package-lock.json，未声称全新 npm ci 已验证。
- Q1–Q4 均已裁决；本包无新增规范待决项。WP3 可开始。
