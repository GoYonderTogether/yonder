import type { Capability } from "@yonder/sdk";

export const coreToolCapabilities: Record<string, Capability[]> = {
	message_send: [],
	agent_ask: ["message"],
	task_run: [],
	session_list: ["admin"],
	session_read: ["admin"],
	identity_lookup: ["read"],
	identity_link: ["admin"],
	skill_view: [],
};
