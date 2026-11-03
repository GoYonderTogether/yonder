import type { MessageInData, YEvent } from "@yonder/sdk";

export const needsTurnContext = (event: YEvent, { kind }: Partial<MessageInData>) =>
	["runtime.tool-result", "runtime.continuation"].includes(event.type) ||
	(!!event.conv &&
		(["group", "channel", "parent-request"].includes(kind ?? "") ||
			(event.type === "message.in" && kind === "dm") ||
			event.type.endsWith(".group-batch") ||
			event.type.endsWith(".batch-ready")));
