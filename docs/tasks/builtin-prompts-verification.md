# e910e85 内置提示词独立验证

结论：该提交已把新的完整内置提示词组装进真实 provider 请求；本机 Luna 在隔离实例中正常运行。没有发现需要阻断该提交的装配问题。此结论限于正文加载、身份/执行能力边界、元数据位置和本次实际调用，不等同于长期人格、品味或所有任务效果已验收。

- 精确提交：`e910e85319ee02836a0207bd8e001a8c808d1deb`。
- 取得方式：`git archive <SHA>`，没有使用共享工作区未提交文件。
- 隔离源码：`/tmp/yonder-prompt-verify-JjoKnz/source`；既有 node_modules 通过 APFS clone 复制，相对工作区链接指向这个 archive，未使用共享 dist。
- 隔离 home：`/tmp/yonder-prompt-verify-JjoKnz/home`。
- 运行包版本：`0.1.2026101906`。这是该提交 package.json 的版本，不把新源码提交假称为已经发布的新版本。
- 真实模型请求：provider `openai`，model `gpt-6-luna`，协议 `openai-responses`。
- 凭据：测试进程直接引用项目自有 `.yonder/auth.json`，沿用原生锁和刷新；未复制到隔离 home，未采集 headers，未显示凭据值。
- 没有安装、发布、push、停止/替换正式服务或修改正式 owner 数据。

## 实际命令与原始结果

在上述精确 archive 中执行：

```sh
npm run build
npm run typecheck
npx vitest run packages/core/src/prompt/index.test.ts packages/core/src/kernel/kernel.test.ts packages/core/src/runtime/runtime.test.ts packages/core/src/runtime/offline.test.ts --exclude '**/dist/**'
npx biome check packages/core/src/prompt/content.ts packages/core/src/prompt/index.ts packages/core/src/prompt/index.test.ts
YONDER_TEST_AUTH=/Users/zoran/Documents/yonder-harness/.yonder/auth.json VERIFY_COMMIT=e910e85319ee02836a0207bd8e001a8c808d1deb agent-network run -- node /tmp/yonder-prompt-verify-JjoKnz/verify-provider.mjs
node /tmp/yonder-prompt-verify-JjoKnz/audit-payloads.mjs
```

- build：退出 0，通过；`build.log`。
- typecheck：退出 0，通过；`typecheck.log`。
- 聚焦项目测试：**4 文件，9 通过，0 失败，0 跳过**；`focused-tests.log`。
- Biome：**3 文件通过，无修改**；`biome.log`。
- 原生真实模型运行：**6 次 done，0 失败，0 跳过**；因其中一次真实工具调用产生续轮，共 **7 次 provider 请求、7 个 HTTP 200**，不是 7 个独立用户任务。
- 产物装配断言：**97 通过，0 失败，0 跳过**；`assembly-audit.json`。这些是对实际 payload 的正文与边界检查，不是 97 个行为场景或质量评分。
- 运行回执另外检查了未复制 OAuth，`receipt.json` 内 7 项运行/隔离条件通过。

主 agent 的共享工作区 build 曾因另一条执行能力路线尚未提交的类型引用失败，见原 `/tmp/yonder-builtin-prompts-build.log`；该原始失败仍应保留。隔离 archive 构建通过说明该失败不在此精确提交树内，不能把共享失败抹除或把未提交代码混入本次证据。

准备阶段 `agent-network health https://chatgpt.com/` 的无凭据 HEAD 返回 HTTP 403，已判为网络可达、业务未验证；后来真实 provider 返回 7 个 HTTP 200 才构成模型业务证据。

## 真实装配结果

| 原生入口 | 最终 system 字符数 | 常驻身份层 | CLI 导航 | 实际提供 bash | 运行 |
|---|---:|---|---|---|---|
| main/exec，CLI 消息绑定 | 30,884 | 有 | 有 | 有 | done |
| main/readonly，独立 persistent 绑定 | 29,471 | 有 | 无 | 无 | done |
| verify-exec，无身份 task | 18,212 | 无 | 有 | 有 | done |
| verify-readonly，无身份 task | 16,799 | 无 | 无 | 无 | done |

四种组合均逐字包含完整 commonPrompt 和 runtimePrompt。实际顺序已按最终正文位置核对：framework → common → resident（有身份）→ runtime → CLI（exec）→ SYSTEM（有身份）→ skill 索引 → 所选工作区 context（有身份）→ pi 的 profile.instructions；当前测试 profiles 没有额外指令，最终空 instructions 段仍位于末尾。SYSTEM.md 和所选 AGENTS.md/USER.md 只进入常驻身份；即使 task preset 配置了工作区 context，也没有把常驻资料带入 task。无身份任务没有“你有唯一主人”的常驻设定，两次 Luna task 回答的 owner 都是 null。

本次协议把系统正文放在最终 JSON 的 **`input[role=developer].content`** 中，不能只寻找 `instructions` 字段。观察器在原生 `onPayload` 边界取得 provider 已转换的 body，原样转交已有钩子返回值，不替换正文、工具或响应；`onResponse` 只记录状态码，未记录 headers。随后所有调用实际成功。

同一 main/exec 会话首次、后续消息与工具任务的最终 system 逐字相同，SHA256 均为：

```text
a29b679825f2a3c85be272d3d48e4acc0812ec8f2bfac40944fcf3a40551d15c
```

动态 `runtime: version/home`、`execution: env/cwd`、`host: platform/prepared/timezone` 位于本轮 `<turn>` 内。没有把实际隔离 home 放进 system；事件原 `time` 仍保留，prepared 是后来准备本次输入的时刻。宿主实测 platform=darwin、timezone=America/Caracas。第一次和下一次 prepared 分别为 `2026-10-19T17:00:53.538Z` 与 `2026-10-19T17:01:02.688Z`；Luna 后续回答准确区分了两者及其来源。

真实 bash 只调用一次 `pwd`。原生转录记录该调用，返回：

```text
/private/tmp/yonder-prompt-verify-JjoKnz/home/agents/main
```

这是 `/tmp/.../home/agents/main` 的实际 macOS 路径，不是正式工作区。readonly 的最终工具声明没有 bash，保留 read/skill_view。

Luna 的信息提取回答能识别产品、开发者、版本与角色身份；对未提供的 cron 和部分运行细节多返回 null。readonly 对 session_kind 返回了 unknown 而不是请求的 null。这说明本次装配与基本使用成立，不代表字段回答完全一致；本次没有改提示词去迎合单个样例，也没有据此宣称整体行为质量通过。

## 证据入口

- `request-01-resident-exec.json` 至 `request-07-resident-exec-tool.json`：不含 headers 的最终 provider body。
- `context-*.json`：转换前模型上下文，均来自隔离实例和公开内置资料。
- `requests-index.json`：请求的真实模型、协议、system hash 与字符数。
- `http-responses.json`：7 个真实 HTTP 200 状态。
- `*-final-system.txt`：各组合便于直接阅读的最终 system。
- `*-latest-turn.txt`：动态本轮输入。
- `*-run.json`、`runs.json`、`resident-transcript.json`、`verify-*-transcript.json`：原生事件/结果/转录。
- `assembly-audit.json`、`receipt.json`：断言和汇总。
- `../verify-provider.mjs`、`../audit-payloads.mjs`：本次隔离验证脚本；固定为本次临时目录，重跑须使用新的隔离目录，不能在已有 home 上重复 init。

## 未测

没有运行完整项目测试集；没有实际跨 Agent 委派、群聊/其他渠道、多设备或远程环境、cron、记忆长期检索、持续授权撤回、压缩后人格保持、品味对照、长期成本或任务成功率评测。此次仅选中 context-files 和本地 CLI，其他插件正文未进入不应被误解为它们已验收。没有替换正式安装，因此正式日用服务仍以其实际版本/源码运行。

后续是否喜欢该文字节奏和角色设计由用户判断；这次真实调用不能替代长期效果验证。

## 验证过程中的失败与纠正

- 准备阶段一次未引用 shell glob 的搜索带有不存在的 `test*`，zsh 返回 `no matches found: test*`；改为 `rg --files` 与明确路径继续。它发生在源码浏览阶段，没有执行测试或模型。
- 取得 archive 后，一次读取误写为 `packages/core/src/prompt/builtin.ts`，实际新增文件为提交 stat 已列出的 `content.ts`；该 cat 返回 ENOENT 后按准确路径读取。没有修改任何文件来绕过这个错误。
- 第一版请求索引导出器以为系统正文在 `instructions` 或 `messages`，但本次真实协议在 `body.input` 的 developer 消息中；该初版导出的 systemHash 因而基于空数组，不可作为证据。原始 provider body 一直完整保存，未变更。独立审计改用 `instructions`（若存在），否则抽取 `input` 中 system/developer 消息的实际 content；重新从现有 7 个原始 body 计算最终 hash，未额外调用模型，也没有改产品源码。最终 `requests-index.json` 是纠正后的结果。
- 首次 payload 审计为 91 通过、0 失败。按最终交接要求补上 6 种运行的完整排序断言后，只对原始产物再执行审计，最终为 **97 通过、0 失败**；没有为提高通过率删除断言。
- 主 agent 记录的共享工作区 build 失败以及最初 Biome 2 个格式错误/修复属于其实现阶段；本报告保留共享 build 的已知原日志位置，不冒充本独立 archive 的失败或抹去历史。独立 archive 的 build/typecheck/9 项测试/Biome 均首次执行通过。
- Luna readonly 回答的 `session_kind: "unknown"` 与用户样例要求的 null 不一致，是本次观察到的模型格式差异。它没有被算作装配测试失败，因为本轮验收目标是正文与边界真正进入 provider；也没有据此宣称模型对任意输出格式都已通过。
