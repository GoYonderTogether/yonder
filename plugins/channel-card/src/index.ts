import { definePlugin } from "@yonder/sdk";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { CardChannel, type Config } from "./channel.js";

export const configSchema = Type.Object(
	{
		endpoint: Type.Optional(Type.String()),
		device: Type.Optional(
			Type.Object(
				{ kind: Type.Optional(Type.Union(["laptop", "desktop", "server"].map((v) => Type.Literal(v)))) },
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);
const parameters = Type.Object(
	{
		instance: Type.String({ minLength: 1 }),
		title: Type.String(),
		markdown: Type.String(),
		display: Type.Optional(
			Type.Object(
				{ kind: Type.Union([Type.Literal("html"), Type.Literal("svg")]), source: Type.String() },
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);

export default definePlugin({
	setup(api) {
		const instances = new Map<string, CardChannel>();
		api.channels.register({
			type: "card",
			multiAgent: true,
			configSchema,
			create(id, config) {
				if (instances.has(id)) throw new Error("Duplicate card instance");
				const channel = new CardChannel(id, config as Config, api);
				instances.set(id, channel);
				return channel;
			},
		});
		api.tools.register({
			name: "channel-card_card_push",
			description:
				"Draft the calling Agent's own card for human review. Does not publish. Supply a configured card instance, title, markdown and optional HTML/SVG display.",
			capabilities: ["write", "network"],
			parameters,
			async execute(input, ctx) {
				if (!Check(parameters, input)) return { isError: true, text: "Invalid card parameters" };
				const { instance, ...data } = input;
				const channel = instances.get(instance);
				if (!channel) return { isError: true, text: "Unknown card instance" };
				// 任务/预设会话没有 Agent 身份，cardPush 一定失败；直接说清原因，别让模型去猜（JV2-J03-02）。
				if (!ctx.agent)
					return {
						isError: true,
						text: "Card draft needs an Agent identity: this session has none (task/preset sessions have no Agent). Call it from the main Agent session — `yonder chat` or a message in the card channel — or draft the card from there. · 名片起草需要 Agent 身份，任务会话没有 Agent：请在 Agent 会话（yonder chat）或名片渠道里调用。",
					};
				try {
					return { text: JSON.stringify(await channel.cardPush(ctx.agent, data, ctx.signal)) };
				} catch (error) {
					// 未注册 = 本 home 还没登录 card 渠道或该 Agent 不在登记表里；其它失败带上真实原因。
					if (error instanceof Error && error.message === "Card Agent not registered")
						return {
							isError: true,
							text: `Card draft failed: Agent "${ctx.agent}" is not registered on card instance "${instance}". Run \`yonder channels login card\` in this home (it registers every enabled Agent), then retry. · 这个 Agent 未在 card 实例注册：先在该 home 执行 yonder channels login card 完成登录与登记，再重试。`,
						};
					const reason = error instanceof Error ? error.message : String(error);
					return {
						isError: true,
						text: `Card draft failed: ${reason}. The request to POST /api/device/cards did not succeed; retry after checking the card instance connection. · 名片起草失败：${reason}；确认 card 实例连接后重试。`,
					};
				}
			},
		});
	},
});
