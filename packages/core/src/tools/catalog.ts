import type { Capability } from "@yonder/sdk";

export const coreToolCapabilities: Record<string, Capability[]> = {
	message_send: [],
	agent_ask: ["message"],
	parent_ask: [],
	task_run: [],
	task_continue: [],
	session_list: ["admin"],
	session_read: ["admin"],
	identity_lookup: ["read"],
	identity_link: ["admin"],
	skill_view: [],
	process: [],
};
