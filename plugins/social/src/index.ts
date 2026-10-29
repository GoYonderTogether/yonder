import type { PluginAPI, YEvent } from "@yonder/sdk";
import { definePlugin } from "@yonder/sdk";
import { Batches } from "./batches.js";
import { createJudge, judgeModel, queueFromEvent, Snapshots } from "./snapshots.js";
import { registerSocialTools } from "./tools.js";

/**
 * 监听模式引擎排出的批次（带 messages/trigger）先过便宜模型判定与快照合并：
 * 价值低且非 @ 的批次丢弃并记账，其余合并成快照，回复触发时一次性注入全部未读。
 * 旧 `Batches` 路径的批次没有这两个字段，继续走原来的 ask 流程，不受影响。
 */
async function consume(api: PluginAPI, snapshots: Snapshots, event: YEvent): Promise<void> {
	const batch = queueFromEvent(event);
	if (!batch) return;
	const agent = (event.data as { agent?: string }).agent;
	const outcome = await snapshots.push(batch);
	if (outcome.kind === "replied") {
		await api.events.emit({
			type: "social.snapshot-reply",
			from: "plugin:social",
			conv: batch.conv,
			parent: event.id,
			data: {
				msgId: `snapshot-reply:${event.id}`,
				...(agent ? { agent } : {}),
				trigger: batch.trigger,
				reason: outcome.reason,
				unread: outcome.unread,
			},
		});
		return;
	}
	if (outcome.kind === "dropped")
		await api.events.emit({
			type: "social.batch-read",
			from: "plugin:social",
			conv: batch.conv,
			parent: event.id,
			data: {
				msgId: `snapshot-dropped:${event.id}`,
				...(agent ? { agent } : {}),
				through: batch.messages.at(-1)?.id,
			},
		});
}

export default definePlugin({
	setup(api) {
		const batches = new Batches(api);
		const snapshots = new Snapshots({ judge: createJudge(api), model: judgeModel(api.config) });
		registerSocialTools(api);
		api.events.on("routing.social-decision", (event) => batches.accept(event));
		api.events.on("message.in", (event) => batches.direct(event));
		api.events.on("run.end", (event) => batches.finished(event));
		api.events.on("channel-qq.group-read", (event) => batches.legacyRead(event));
		api.events.on("social.batch-ready", (event) => consume(api, snapshots, event));
		api.triggers.register({ id: "social", start: () => batches.start(), stop: () => batches.stop() });
	},
});
