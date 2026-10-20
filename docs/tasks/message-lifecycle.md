# M43 消息生命周期与长任务交付

状态：进行中。授权：2026-10-20 用户要求修复全部已发现问题，完成后直接发版。

## 目标与依据

D43、spec/06 §3、spec/10 §3、spec/11 §7.3：每条模型消息独立气泡；阶段汇报及最终消息独立，工具/后台等待不悬挂旧流；后台完成自动继续且不依赖追问；去重、取消、unknown及CLI契约保留。

## 路径

packages/sdk/src/types.ts；packages/core/src/runtime/{index.ts,types.ts,stream.test.ts}；packages/core/src/delivery/；packages/core/src/store/；plugins/channel-feishu/{src,test}/；必要CLI消费方packages/cli/src/index.ts。设计方先修改spec/06、10、11、decisions及index；发行统一package.json/package-lock.json、CHANGELOG，结果留本文件。

## 验证

真实模型长工具：初始消息先关闭，工具和后台仍运行；无需新用户消息，阶段与最终分别出现，内容及回执不重复。协议回归覆盖多消息、空/NO_REPLY、steer所有权、慢渠道、取消/失败、恢复去重、飞书关闭及节流尾片段，工具参数说明。执行build/typecheck/test/lint，保留原始计数；真实外部飞书未执行则明确未测。

## 问题

现场任务未等待用户追问才发送：07:12:54已开始发送，07:13:32才追问；实际参数错误延迟投递。主要根因是整轮流式协议和生命周期，而非后台唤醒丢失。

## 结果

待填写。
