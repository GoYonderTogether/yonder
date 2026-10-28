import { definePlugin, type ToolContext, type ToolResult } from "@yonder/sdk";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { CompanionService } from "./interaction-store.js";
import { registerSessionManage } from "./session-manage.js";
import { registerSessionTools } from "./session-tools.js";
import { registerSuggestions } from "./suggestions.js";
import { registerViews } from "./views.js";

const present = Type.Object({ card: Type.Unknown() }, { additionalProperties: false });
const result = Type.Object(
	{ id: Type.String({ minLength: 1 }), wait: Type.Optional(Type.Boolean()) },
	{ additionalProperties: false },
);
const json = (value: unknown): ToolResult => ({ text: JSON.stringify(value) });
export default definePlugin({
	configSchema: Type.Object({ desktop: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
	setup(api) {
		registerSuggestions(api);
		registerSessionTools(api);
		registerSessionManage(api);
		const service = new CompanionService(api.paths.data);
		registerViews(api, service);
		api.triggers.register({ id: "interaction-service", start: () => service.start(), stop: () => service.stop() });
		api.tools.register({
			name: "interaction_present",
			description:
				"Present an interactive local Yonder card. Card: {id,title,prompt,kind:'choice'|'form',options?:[{id,label}],next?:card,autoClose?:boolean}. Default completion collapses the window. Returns a request id. Call interaction_result with the returned id and wait:true to receive the actual user's steps in this session. Never use this card alone as authorization to execute another tool. Use for a real decision that benefits from a local card: one natural self-contained question, short verified choices, no invented accounts or options.  Read the actual result before proceeding; dismissal or timeout is not approval.",
			parameters: present,
			capabilities: ["message"],
			async execute(input, ctx) {
				ctx.signal.throwIfAborted();
				if (ctx.env.id !== "node:local") throw new Error("UI companion requires node:local");
				if (!Check(present, input)) throw new Error("Invalid card arguments");
				return json(await service.present((input as { card: unknown }).card, ctx));
			},
		});
		api.tools.register({
			name: "interaction_result",
			description:
				"Read the real user's interaction steps for a card created by this session/profile. wait defaults to true, using the host's cancellable tool/background lifecycle; false returns current status. Cancelling a wait leaves the card available for a later wait. A closed session cancels its pending cards.",
			parameters: result,
			capabilities: ["read"],
			async execute(input, ctx: ToolContext) {
				if (!Check(result, input)) throw new Error("Invalid result arguments");
				const { id, wait } = input as { id: string; wait?: boolean };
				return json(await service.result(id, ctx, wait ?? true, ctx.signal));
			},
		});
		api.events.on("session.close", async (event) => {
			const session = (event.data as { session?: unknown }).session;
			if (typeof session === "string") await service.closeSession(session);
		});
	},
});
