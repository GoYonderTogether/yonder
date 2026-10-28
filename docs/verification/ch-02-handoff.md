# CH-02 后续与验证边界

- 社交参与判断已接入路由；群 batch、folded 的积累和定时调度属于 CH-03，当前仅保存原事件，不自动运行。
- 社交 profile 的私人 context、memory 和工作区隔离依赖实际配置；本卡未证明文件沙箱或私人内容隔离。需要在受限 profile 下用临时 HOME 和真实模型验证。
- 无真实渠道账号，本卡未验证平台身份、原生 @ 元数据或实际投递。adapter 的事件输入不能替代平台验收。
- 已通过真实 SQLite 和 sessions 的路由测试，runtime 为测试替身，不是实际内核或真实模型验收。
- 不同 social Agent 的映射若都指向同一目标，路由保守拒绝；显式映射仅唤醒目标 Agent；没有显式映射时，无 social Agent 保留既有 fan-out。

## 真实模型单场景验收

- 临时 HOME 和 YONDER_HOME、真实内核与 `siliconflow/deepseek-ai/DeepSeek-V3.2`，只从指定主人 home 的 siliconflow 凭据槽导入临时认证文件；测试渠道仅模拟传输，未使用真实平台。测试结束清理临时目录。
- 首轮：1 文件失败，0 通过 / 1 失败 / 0 跳过；主人 main 的目标运行在 90 秒内未结束。当时默认 onboarding 同时唤醒 main；移除测试配置中的 onboarding 后复测，不能把首轮失败覆盖。
- 首次复测：1 文件通过，1 通过 / 0 失败 / 0 跳过；再启用输出获取关联信息：1 文件通过，1 通过 / 0 失败 / 0 跳过，群输入事件 `01M61K6TYJ3TB3XD3QT6C764Y9`、main session `2`、群 session `22`、群投递 1 次。
- 改为通过 `YONDER_CH02_AUTH_SOURCE` 显式指定凭据文件后复测：1 文件通过，1 通过 / 0 失败 / 0 跳过；群输入事件 `01M61KYTGC6DGHSDW42W24RAAN`、main session `2`、群 session `22`、群投递 1 次。群投递内容和群转录均未包含仅写入 main 的私人 canary；测试仅记录投递次数，未保留 run 或投递事件 ID。
- 该单场景不证明所有私人 context、memory、文件工作区隔离；真实渠道身份、原生 @ 和实际平台投递仍未测。
