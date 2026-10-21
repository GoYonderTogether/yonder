export const chatCommands = [
	{ name: "new", description: "新建会话 · New session" },
	{ name: "resume", description: "继续会话 · Resume session" },
	{ name: "session", description: "当前会话 · Session info" },
	{ name: "hotkeys", description: "快捷键 · Hotkeys" },
	{ name: "connect", description: "扫码接入渠道 · Connect channel" },
	{ name: "channel", description: "渠道聊天 · Channel chat" },
	{ name: "skills", description: "技能 · Skills" },
	{ name: "stop", description: "中止运行 · Stop" },
	{ name: "close", description: "关闭任务 · Close task" },
	{ name: "help", description: "帮助 · Help" },
];

const channelCommandNames = new Set(["help", "session", "skills", "stop", "connect"]);

export const channelChatCommands = chatCommands.filter((command) => channelCommandNames.has(command.name));
