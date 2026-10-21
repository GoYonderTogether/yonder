# Sources

实现为 Yonder 原创，不复制其他 Agent 内核。

- 参考 Hermes Agent 的 `cron/jobs.py`、`scheduler_tick.py`、`execution_identity.py`：持久作业、执行身份和重启副作用边界。
- 参考 OpenClaw 的 `src/cron/schedule.ts`：at/every/cron 调度原语与DST。
- https://docs.openclaw.ai/automation/cron-jobs （2026-10-19访问）：持久调度、隔离任务和结果投递。
- https://github.com/harrisiirak/cron-parser （MIT，使用5.4.0）：成熟5/6字段、IANA时区/DST解析，不自制解析器。
