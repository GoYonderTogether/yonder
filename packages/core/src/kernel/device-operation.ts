import type { Tool, ToolContext } from "@yonder/sdk";
import { localEnvironment } from "../runtime/index.js";
import type { RuntimeSessionConfig } from "../runtime/types.js";

export function deviceOperation(home: string, tools: Map<string, Tool[]>) {
	return async (
		config: RuntimeSessionConfig,
		deviceId: string,
		commandId: string,
		action: string,
		args: Record<string, unknown>,
		signal: AbortSignal,
	) => {
		const tool = tools.get("devices")?.find((tool) => tool.name === "devices_operation");
		if (!tool) throw new Error("Devices plugin filesystem backend is unavailable");
		const context: ToolContext = {
			agent: config.agent,
			profile: config.profile,
			session: config.sessionId ?? `workbench:${config.profile}`,
			capabilities: [...config.resolved.capabilities],
			...(config.resources ? { resources: config.resources } : {}),
			env: localEnvironment(home),
			signal,
		};
		const result = await tool.execute({ deviceId, commandId, action, arguments: args }, context);
		const value = JSON.parse(result.text);
		if (result.isError) throw Object.assign(new Error(value.message ?? result.text), { code: value.code });
		return value;
	};
}
