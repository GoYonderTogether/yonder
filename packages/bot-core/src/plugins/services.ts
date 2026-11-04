import type { Delivery, PluginAPI, SessionsAPI, ToolContext } from "@yonder/sdk";

type PluginMessage = Parameters<PluginAPI["messages"]["send"]>[0];
export type KernelServices = Omit<
	Pick<
		PluginAPI,
		| "permissions"
		| "social"
		| "agents"
		| "events"
		| "messages"
		| "credentials"
		| "sessions"
		| "subagents"
		| "identity"
		| "services"
		| "host"
		| "execution"
		| "models"
		| "log"
	>,
	"messages" | "sessions" | "social" | "agents"
> & {
	agents: Pick<PluginAPI["agents"], "list"> & {
		configureBinding(
			request: Parameters<PluginAPI["agents"]["configureBinding"]>[0],
			pluginId: string,
			ctx: ToolContext,
		): ReturnType<PluginAPI["agents"]["configureBinding"]>;
		inspectBinding(
			request: Parameters<PluginAPI["agents"]["inspectBinding"]>[0],
			pluginId: string,
			owner: Parameters<PluginAPI["agents"]["inspectBinding"]>[1],
		): ReturnType<PluginAPI["agents"]["inspectBinding"]>;
	};
	social?: Omit<NonNullable<PluginAPI["social"]>, "admitBatch"> & {
		admitBatch(
			request: Parameters<NonNullable<PluginAPI["social"]>["admitBatch"]>[0],
			pluginId: string,
		): ReturnType<NonNullable<PluginAPI["social"]>["admitBatch"]>;
	};
	messages: { send(message: PluginMessage, pluginId: string, ctx?: ToolContext): Promise<Delivery> };
	sessions: Omit<SessionsAPI, "submit" | "notify"> & {
		notify(id: string, input: { event: string; text: string }, pluginId?: string): ReturnType<SessionsAPI["notify"]>;
		submit(
			id: string,
			input: Parameters<SessionsAPI["submit"]>[1],
			options?: Parameters<SessionsAPI["submit"]>[2],
			pluginId?: string,
		): ReturnType<SessionsAPI["submit"]>;
	};
};
