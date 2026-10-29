import type { Capability } from "@yonder/sdk";

export const coreToolCapabilities: Record<string, Capability[]> = {
	permissions: [],
	message_send: [],
	agent_ask: ["message"],
	parent_ask: [],
	task_run: [],
	task_control: [],
	task_continue: [],
	session_list: ["admin"],
	session_read: ["admin"],
	identity_lookup: ["read"],
	identity_link: ["admin"],
	// Workbench tools (contracts §18) are optional and gate themselves by session kind, so they carry no capability.
	session_archive: [],
	session_hand_up: [],
	bot_ask: [],
	bot_request: [],
	bot_attach: [],
	skill_view: [],
	process: [],
};
