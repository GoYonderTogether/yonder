# Shared Bot fix-round verification — 2026-11-03

仅操作两个 shared-core worktree；不 push、不部署、不访问 zeth-root，不输出模型 key。根 REFACTOR-REPORT.md 按任务书保持未提交。最终清理按维护者要求移除机器原始日志/JSON/TSV/文本转储；本文保留实际命令、计数、失败与短摘录，不以新成功覆盖旧失败。

## Main 合入与命令

采用 merge：990bef27 合 ae197ecb，31215dd2 合 4e58ceb8；最终清理 add9b951 合 0fcaf613，061b284c 再合 fe09dfae（含26110215版本及渠道身份/原始目标规范）。79 条 main 提交内容保留见 [逐项审计](main-content-audit.md)。Cloud main 仍 52692f5，无新增提交。

完整 Yonder gate：`npm run build`、`npm run typecheck`、`npm run lint`、`npm test -- --maxWorkers=4`、`npm run test:node`。Cloud 根/server build/typecheck、真实 PG/Redis 全量 server tests、deploy、market、SSR 的具体命令和结果见 [Cloud 总账](../../../../yonder-cloud-shared-core/docs/verification/fix-round/verification.md)。

## 先前完整 gate 与失败

| 轮次 | 实际结果 |
|---|---|
| 初轮 | build/typecheck exit2；lint exit1；Vitest 2780 pass /4 fail /112 skip，520 files pass /2 fail /67 skip，179.14s；Node83/0/0/0/0 |
| imports/夹具修后 | build/typecheck exit0；lint exit1（两个验收 JSON 格式）；Vitest2785/1/112，522 files pass /1 fail /67 skip，141.83s；Node83/0/0/0/0 |
| shutdown/D3后 | build/typecheck/lint exit0；Vitest2763/0/113，518 files pass /67 skip，137.17s；Node83/0/0/0/0 |
| 模型缓存修后，源码658713ed | 全部exit0；Vitest2764/0/113，518 files pass /67 skip，167.20s；Node83/0/0/0/0 |

初轮 remote-search 三失败是移除wrapper后未注入已有真实实现，由281772c2修fixture。另一次gateway ready poll失败未归因，定向复跑通过，未改timeout。第二轮console在close后清目录报ENOTEMPTY：已接纳run.end观察尚在写文件。6dc3fa3a在底层storage.close前等待最终投递和观察，用延迟FS remove负对照证明原逻辑失败，未加rm重试。D3 main明确删除五个上游hashline测试文件，解释文件/用例数变化。113默认skip含平台及显式live，不能全归因于凭据。

## 真实模型、故障与生命周期

修后真实GLM命令（源码3a428de5，其后至最终清理前无产品源码变化）：

| 命令 | 实际结果 |
|---|---|
| `agent-network run -- node scripts/cloud-worker/verify.mjs --live` | A6 exit0，73.18s；两租户PG SOUL标识分别进入真实glm-5.3-flash回复 |
| `agent-network run -- node scripts/cloud-worker/verify.mjs --card --live` | A8 exit0，48.53s；真实interactive卡片含/connect、/download；原生转录有工具、结果唯一 |
| `agent-network run -- node scripts/cloud-worker/device.mjs --live` | A9 exit0，139.79s；临时真实local kernel/Card/device调用官方memory工具，online2/offline0；非生产或物理硬件验收 |
| `node scripts/cloud-worker/verify.mjs --card` | 卡片准备后失败回环exit0，2.91s；仅error、不预发卡且下一轮不复用 |
| `node scripts/cloud-worker/verify.mjs --case=<case>` | timeout/503/empty/503-reflect/send-then-503/reply-none/interrupt均exit0，依次2.58/2.04/2.00/2.11/2.38/2.25/1.98s |
| `node scripts/cloud-worker/lifecycle.mjs` | exit0，76.99s；PG advisory锁A时B先完成；idle74257ms释放未满LRU实例，再激活成功，completed3/pending0 |

故障检查使用真实PG/Redis/server/worker与明确HTTP transport故障端，不冒称真实上游产生503。断言唯一结果、后续prompt排除error、转录前脱敏及中断收尾。生产模型/worker凭据未进入持久转录或日志（布尔核对），未记录任何值。

## 长历史 A12

命令 `node scripts/cloud-worker/verify.mjs --load`，修后exit0，30.97s。单worker，真实PG/Redis/server，明确HTTP模型transport stub；100Bot各500条≥4096B durable归档消息及10个rewindable文档delta，共50000条，101轮（100cold+1warm）。idle141328384B，50ms采样peak300548096B，末尾300056576B；150/350MB预算通过。active/highWater20、opened100/closed80、completed101/pending0。707次modelsFor仅202个unique Models，归档正文entries/bytes读取0，PG连接2/TCP3/Timeout2。冷轮worker Client.query473–477、mean474.62，warm341；不含server/父进程seed SQL。未手动GC、减样本或提高预算，不把此transport负载称为100Bot真实GLM压力测试。

原始负载peak361267200B失败，有效修前诊断idle140476416B/peak350453760B失败且707调用创建707Models；首个探针因PG callback不返回Promise失败，非产品结论。b14d7cdf复用已有Runtime.boundModels WeakMap，去service全局Runtime强引用，各Bot独立timeout；658713ed只增加真实分配与归档读取观测。Agent修后同负载idle139935744B/peak315326464B成功；主Agent最终结果如上。保留这些差异，不以单次成功抹掉超预算记录。

## 从原始文件摘取的短原文

下列行在删除原始产物前直接读取，没有拼造缺失内容；顺序为最终Vitest、第二轮关闭失败、A6、A8、idle释放及A12计数：

```text
 Test Files  518 passed | 67 skipped (585)
      Tests  2764 passed | 113 skipped (2877)
Error: ENOTEMPTY: directory not empty, rmdir '/private/tmp/ya-1MTztR/.yonder/plugins/channel-card'
      "soulTokenMatched": true
          "link": "/connect",
          "link": "/download",
  "idleReleaseMs": 74257,
	"idleBytes": 141328384,
	"peakBytes": 300548096,
	"completedRounds": 101,
```

## 开发失败与证据限制

PG/storage首轮47/3、次轮44/6、第三轮50/0；扩展54/1后修tasks storage guard，最终artifact/guard16/0。移动core测试初轮778/2/61，修共享speech的anchor-updated兼容及vendor版本误改，保留断言。PG before/order初轮fixture缺name为8/1，修后2/0。shutdown负对照1fail/7skip，恢复实现后focused22/0。真实factory模型绑定focused3/0。

上一轮清理误删9份已引用定向日志，7份从本任务原始工具stdout完整恢复；两份完整raw（原44/6、7187B；54/1、1497B）只恢复真实片段。这是历史损失，不能称无损。当前维护者明确要求删除全部机器原始产物，保留本文的真实计数、原因及必要摘录；恢复过程简述见 [清理更正](scratch-log-audit.md)。

真实Luna未测：YONDER_TEST_AUTH未设且默认.yonder/auth.json不存在。未部署，未验证2核2GB同机PG/Redis/nginx长期共存和日常设备全部硬件grant组合。

## 最终清理轮 gate 的执行边界

先在ebd44c00开始gate时，build/typecheck/lint退出0；main随后又前进，旧Vitest尚未退出时执行merge，测试读到了临时冲突标记。这次运行不是冻结源码验收：实际Vitest2678pass/9fail/113skip，18files fail/500pass/67skip，133.16s，Node阶段未执行。实际JSON解析错误位置包括886（line40,column1）及403（line24,column1），对应临时manifest冲突标记。没有为这些冲突窗口失败改产品断言或timeout；merge及lock metadata修复完成后，在8e6b474d重新执行完整gate。最终结果在下方单独记录。

## 最终清理后的冻结源码完整 gate

产品及manifest/lock冻结在`8e6b474dd25b537a26fff066010a2609c447f9ff`；之后仅可读验证文档与raw删除（6031b432、772d941c）。main为`fe09dfaebb17e9b9df4bec634393a5165123e39c`，基线以来79条提交逐项保留。没有因转发文件删除修改行为断言、timeout或skip。

| 命令（Yonder根目录） | 退出码 | 实际墙钟秒数 | 结果 |
|---|---|---|---|
| `npm run build` | 0 | 15.58 | 完整构建 |
| `npm run typecheck` | 0 | 8.93 | 完整类型检查 |
| `npm run lint` | 0 | 2.18 | 含size/layers；107shared模块、747workspace生产TS，层级基线0 |
| `npm test -- --maxWorkers=4` | 0 | 141.57 | 2764pass/0fail/113skip；518files pass/67skip；runner141.01s |
| `npm run test:node` | 0 | 1.80 | 83pass/0fail/0cancelled/0skip/0todo，runner1615.915667ms |

实际最终stdout短摘录：

```text
 Test Files  518 passed | 67 skipped (585)
      Tests  2764 passed | 113 skipped (2877)
   Duration  141.01s (tests 67%, import 29%, transform 3%)
ℹ tests 83
ℹ pass 83
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

前述被merge干扰的旧运行实际错误短摘录（不作冻结源码验收）：

```text
  "native-automation: Expected double-quoted property name in JSON at position 886 (line 40 column 1)",
```

Cloud本轮完整gate重新通过：build/typecheck全部0，真实PG/Redisserver208/0（22suites，79.203s），deploy19/0、market13/0、SSR3/0、version check0；无lint script。SSR首次漏既有TSX_TSCONFIG_PATH导致0/3，正确命令后3/0；原始执行错误保留在Cloud总账，不改源码或断言。

本轮没有重跑真实GLM或A12：先前修复后的真实结果、资源数值及原始失败已在本文保留，不称为此次转发路径/文档清理后的新模型测量。

清理范围：Yonder删除73份tracked raw（1025383B/28230lines）及324份ignored/untracked scratch（1500578B/26128lines）；Cloud删除11份tracked raw及8份untracked scratch。两仓docs/verification的.log/.json/.jsonl/.txt/.tsv均为0，文档不再引用已删除文件。截图与可读Markdown保留。新gate仅在进程内存提取结果，无新raw文件。

转发文件清理：ebd44c00删除13个local-host/kernel forwarders及gateway/protocol/views.ts，全部消费者直达真实包。唯一保留的单行export-star是gateway/protocol/index.ts：package.json公开导出./protocol，App9处真实导入，属于现行公共入口。packages/plugins其余源码没有单行star转发规避层级门。

结束检查命令`git rev-list --count refactor/shared-bot-core..main`在两仓均输出`0`；`git diff --check`通过。无push、部署、生产访问或key输出。
