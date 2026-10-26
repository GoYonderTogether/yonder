# W0 verification — 2026-10-26

基线：`7a5ccf5434da04d9a7f08f6eb2c20ef945728b0d`，独立分支 `codex/multidevice-w0-20261026`。Node v24.21.0；仅W0契约、标准签名helper、SDK最小重导出及文档，没有daemon/设备工具/Card执行服务。

| 检查 | 原始结果 |
|---|---|
| npm install --package-lock-only --offline --ignore-scripts --no-audit --no-fund | exit 0，无网络解析 |
| npm ci --offline --ignore-scripts --no-audit --no-fund | exit 0，added 335 |
| protocol首次tsc | TS2322（map枚举推导never）；改用现成Type.Enum后编译通过 |
| protocol/SDK tsc，最终typecheck | exit 0 |
| 契约vitest | 17 passed / 0 failed / 0 skipped；一次基础签名检查、一次增加内层身份绑定后复测，均17/17；非模型测试 |
| 默认build第1次 | Clang用户cache不可写，exit 1 |
| 默认build第2次（临时Clang/Swift cache） | SwiftPM嵌套sandbox_apply拒绝，exit 1 |
| 完整build，临时cache且经执行权限审查 | exit 0；TypeScript、原生macOS Helper与companion；仅构建，没有安装服务/启动VM |
| lint首次 | 两个生成JSON格式错误；格式化后修复 |
| 最终lint | exit 0；414 files / 0 errors / 482 warnings / 14 infos；没有修其他源文件 |
| 默认全量第1次（受限环境） | 多项本地协议/fixture失败后无输出，主动终止exit130；无完整汇总，不能算通过 |
| 默认全量第2次（YONDER_TEST_REAL=0，经执行权限审查） | exit 1；745 passed / 1 failed / 40 skipped（786）；117文件passed / 1 failed / 19 skipped（137）；33.32s |
| git diff --check | exit 0 |
| 独立protocol tarball离线安装及导入 | exit 0，见下方工件记录 |

默认全量唯一剩余失败：`plugins/memory/test/wp7.test.ts:62`期望本周task内容，但fixture在第21行硬编码`timeline/2026-W43.md`，`plugins/memory/src/contexts.ts:98-100`按实际当前周读取。当前UTC为2026-W44；`git diff --quiet <base> -- plugins/memory` exit0，文件与基线完全相同。本轮不修改该范围。另做一次最小真实基线对照：从完整基线SHA通过git show提取未修改的contexts.ts及wp7.test.ts到独立/tmp目录，运行单测试；同样exit1，复现同一undefined/string断言失败（1 failed，0 passed）。contexts的运行依赖只有Node、luxon/yaml，SDK是擦除的type import，未载入W0协议模块。可归因为基线固定W43测试与当前W44的日期不匹配，非本W0引入回归；仍保留745/1/40和默认全量失败状态。

包验证先遇npm全局cache EPERM，使用独立/tmp cache和本地已固定的TypeBox tarball完成；没有chown或更改用户目录权限。独立安装目录的lock只有protocol与typebox两个node_modules条目；从该目录真实import成功。这个结果只覆盖protocol，不能冒充尚未实现的executor产物A2通过。

- 工件 SHA256：`666c6b8b46ce7590d3d9864e82c469c9532b11b19209f6ca314a79fb816c082d`。
- 压缩包：35457 bytes；package unpacked：301507 bytes。
- 独立node_modules：1815263 bytes（含TypeBox 1.3.27）；没有SDK/core/pi/model包。
- execution schema SHA256：`eb26e030ff39346e32c399e3148ed73c4fb538e40787fded83f4478c26e72fea`。
- relay schema SHA256：`d2b734f540c95b8bd9dd7c7abc31efd2693c6bd7ebf69ee51e6d6b0a2fadc39e`。

临时原始证据：`/tmp/yonder-w0-build.log`、`/tmp/yonder-w0-default-test.log`（受限/中止）、`/tmp/yonder-w0-default-test-escalated.log`（完整失败计数）、`/tmp/yonder-w0-memory-baseline-test.log`（基线同失败）、`/tmp/yonder-w0-typecheck-final.log`、`/tmp/yonder-w0-lint-final.log`；只把汇总入本分支，原始日志不入产品库。

未测/未实现：真实持久配对、真实grant存储、command双端持久化、双daemon拒启、进程kill/取消/设备锁、Agent→设备闭环、TLS网络端点与Card relay实际通信、生产Card SHA、Windows许可/安装、Linux安装/VM边界、六端包和长期稳定性。W0内存临时密钥测试不能替代A5/A7。checkpoint restore/clone不提供执行控制恢复入口，当前固定unsupported。
