# PT-P001 CodeGraph 验证

- CodeGraph CLI 1.6.1，pi-codegraph 0.7.3（MIT）；参数与 argv 对照扩展源码。
- `UPDATE_GOLDEN=1 npx vitest run plugins/code-intel/test/code-intel.test.ts` 和不设变量重跑均 1 文件 1 通过；实际临时索引验证 `index.ts:486 install` → `grep.ts:5 createGrepTool`，对照调用者源码。冷索引、CLI 缺失、过期索引和取消也通过；首次两轮原始结果各 0 通过 1 失败，测试夹具与预期调用边不符，改为复制真实调用者后重跑。工具注册测试守护名字与能力，没有更新无关 golden。
- 临时 HOME 且只读取 siliconflow 槽，`agent-network run -- env HOME=<临时目录> YONDER_CODEGRAPH_REAL=1 npx vitest run plugins/code-intel/test/real.test.ts`：1 文件 1 通过，真实 siliconflow/deepseek-ai/DeepSeek-V3.2 调用该工具。首次把临时 HOME 传给 agent-network 时启动失败 FileNotFoundError；改为只给受信任子进程传 HOME 后通过。
- 插件定向 TypeScript 和 Biome 通过。全仓 file-size 失败：并行的 SDK types、delivery、runtime、tools、terminal、kernel 文件超基线；全仓 tsc 包含并行修改错误，原始运行还发现本卡测试跨项目 rootDir，已移至插件 test 目录。
- 未测：真实非本地执行环境、未选插件模型上下文与 token 增量、T05 截断原文及索引、核心 find/ls 不注入规则。当前 SDK 结果的 T05 本地缓存由并行工作提供，远程 env 的缓存未接通。
