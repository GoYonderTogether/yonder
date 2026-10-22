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

## WP3

文件：新增 src/retrieval.ts、test/wp3.test.ts；修改 package.json（两项工具声明）、src/index.ts（注册）、src/files.ts（拒绝绝对路径）、src/config.ts（origin 枚举显式 TypeBox tuple，修正动态 map 导致的 Static 推导）、README.md、verification.md。未改其他路径。

### 原始检查记录（按发生顺序保留）

1. 初步 `npm run build`：失败，2 个 TypeScript 错误（origin 动态 Union 的 Static 推导）；已改为显式 Literal tuple。
2. 首次完整链：build、typecheck 通过；npm test 为 Tests 211 passed / 4 failed / 23 skipped（238）；Test Files 54 passed / 1 failed / 11 skipped（66）。四项失败均为 WP3 搜索返回空，因 macOS 临时目录逻辑路径与 rg 真实路径混用，合法命中被相对路径过滤。lint 因 && 未执行。
3. 定位时专项 `npx vitest run plugins/memory/test/wp3.test.ts --reporter=verbose`：4 passed / 4 failed / 0 skipped（8），1 failed file。保留与首轮一致的失败，未改断言。
4. 统一按 canonical base 计算相对路径后，同一专项：8 passed / 0 failed / 0 skipped（8），1 passed file。
5. 补齐真实缺 rg 的用例并排除隐藏路径、明确 derived 文件来源后，最终执行 `npm run build && npm run typecheck && npm test && npm run lint`：全部退出 0。
6. 最终 npm test：Tests 216 passed / 0 failed / 23 skipped（239）；Test Files 55 passed / 0 failed / 11 skipped（66）。memory 共 21 项（WP1 5 + WP2 7 + WP3 9）通过。
7. 最终 build、typecheck：各 1 通过 / 0 失败 / 0 跳过，无测试用例计数；不覆盖上述首轮失败。lint：230 files，0 errors / 207 warnings / 2 infos，退出 0。
8. 独立调用 checkPlugin：通过，errors=[]；契约用例也通过。格式预检仅警告/提示，无错误。

### 已验证

- 中文字面子串、正则字符按字面、全角冒号输入的 NFKC 双搜、未改写源文件康熙部首原文；后者不声称能被普通汉字命中（转换产物验收属 WP4）。
- 按命中行与缩进续行的 origin/date 过滤；跨年周标题与 private 同月 owner/agent 混合来源；raw frontmatter、mine 固定 human-written、派生文件 derived、登记目录配置 origin。
- distinct term 数 / 命中次数 / 日期排序，any/all、zones、since/until、limit、total/truncated；默认排除 archive/private，显式 private 读取与检索、frontmatter private 排除。
- 登记目录的命中路径带来源名；检索与读取前后真实文件字节及 mtimeNs 完全相同。
- 拒绝越界、绝对路径与符号链接读取；检索不跟随链接，不返回隐藏文件、.obsidian/node_modules 或非文本文件。
- memory_read 按 ISO 周定位、行分页、12000 字符截断；参数、日期、path/week 二选一、能力与取消边界。
- 真正清空子进程 PATH 后 rg 无法启动：search 返回具体诊断，status 报不可用；未模拟 rg 或提供回退。

### 仅实现未做端到端验收

- 已做源码工具调用、构建产物 checkPlugin 和真实临时 FS/rg 验证；未安装到正式服务，未用真实模型验收，未访问用户 Obsidian/微信归档。默认 23 skipped 如实保留。
- 未进行跨进程/跨宿主压力验收；登记目录只读验证覆盖本轮临时目录中的检索/读取，不代表用户真实资料库验收。
- 未修改根 package-lock.json，未执行全新 npm ci。WP3 未新增依赖。
- Q1–Q4 已裁决；本包没有新增待决规范空白。已停在 WP3，不实施 WP4–WP7。

## WP4

文件：新增 src/{manifest,ingest}.ts、test/{harness,wp4.test}.ts；修改 src/{capture,index,retrieval,store}.ts、package.json、README.md、本记录与 open-questions.md（Q5 已裁决，440b35a）。

- build 初步及最终、typecheck 最终均退出 0。
- 首次完整链：测试 212 通过 / 4 失败 / 23 跳过；文件 52 通过 / 4 失败 / 11 跳过。另有 WP4 suite 因已移除的 Vitest 参数签名加载失败（0 用例）；4 项失败是旧 CLI/微信测试 5 秒超时。lint 未执行。
- 定位专项首次：suite 加载失败，无用例；修正签名后：4 通过 / 1 失败 / 0 跳过，失败为 watcher 路径别名；已修正，不改断言与超时。
- 最终链 `npm run build && npm run typecheck && [MEMORY_TEST_CONVERTER 与 MEMORY_TEST_SAMPLES] npm test -- --maxWorkers=2 && npm run lint`：全部退出 0；测试 221 通过 / 0 失败 / 23 跳过（244）；文件 56 通过 / 0 失败 / 11 跳过。较低并发用于避免首轮宿主竞争导致的旧用例超时。
- lint：234 文件，0 errors / 211 warnings / 2 infos。独立 checkPlugin：[]。
- 已验证：真实 FS 的 owner/渠道/命令/空消息过滤、附件限额路径、重复事件去重、原件字节不变与 manifest 来源覆盖既有 frontmatter、hash 去重归档、chokidar 实际监听与 stop、真实进程非零/空输出/超时保留原件。
- markitdown 0.1.9 通过环境变量传入，实际转换 test.pdf、test.docx、zh.docx、zh.pdf 四份样本；转换文件 NFKC、指定 frontmatter、普通汉字检索通过。原件与转换产物共存。
- 仅实现未做端到端：真实飞书隔天采集/回忆、真实消息附件与服务生命周期；未访问 Obsidian 或微信内容。本包没有新增待决问题。
- chokidar 精确 5.0.0（MIT，Node >=20.19.0），兼容项目 >=22.19，使用 awaitWriteFinish（1000ms）及周期重扫；未用6.x。根锁文件未改，依赖按授权路径在插件 package.json 精确列出。
