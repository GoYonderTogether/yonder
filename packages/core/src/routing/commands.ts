import {
	type ChannelLoginResult,
	channelChatCommands,
	chatCommands,
	type RunResult,
	type SessionInfo,
	type YEvent,
} from "@yonder/sdk";
import type { DeliveryService } from "../delivery/index.js";
import type { RuntimeSessionConfig } from "../runtime/index.js";
import type { createSessions } from "../sessions/index.js";
import type { SkillsReport } from "../skills/index.js";
import { newEvent, type Store } from "../store/index.js";

export function chatCommand(text: string): string | undefined {
	return text.startsWith("/") && !text.startsWith("//") ? text.slice(1).trim() : undefined;
}

/** Commands use the already-authorized source session; they never invoke a shell or model. */
export async function runChannelCommand(
	session: SessionInfo,
	event: YEvent,
	services: {
		store: Store;
		sessions: ReturnType<typeof createSessions>;
		delivery: DeliveryService;
		skills: (profile: RuntimeSessionConfig) => Promise<SkillsReport>;
		login?: (instance?: string) => Promise<ChannelLoginResult>;
	},
): Promise<RunResult | undefined> {
	const command = chatCommand(String((event.data as { text?: unknown }).text ?? ""));
	if (command === undefined || !event.conv) return;
	const { store, sessions, delivery } = services;
	const result: RunResult = { agent: session.agent, session: session.id, status: "done", text: "" };
	// A durable command attempt is not a model run. After a crash, its side effect is never replayed.
	const attempt = newEvent({
		type: "channel.command",
		parent: event.id,
		conv: event.conv,
		data: { msgId: `${event.id}:${session.id}`, command, session: session.id },
	});
	if ((await store.events.append(attempt)).id !== attempt.id) return result;
	try {
		const profile = await sessions.resolveSession(session.id);
		if (!profile.resolved.capabilities.includes("read")) throw new Error("当前来源没有读取会话权限");
		if (command === "help")
			result.text = channelChatCommands.map((item) => `/${item.name} — ${item.description}`).join("\n");
		else if (command === "session")
			result.text = `Agent: ${session.agent}\nSession: ${session.id}\nMode: ${session.mode}\nProfile: ${session.profile}\nModel: ${profile.resolved.model}`;
		else if (command === "skills")
			result.text =
				(await services.skills(profile)).skills
					.filter((skill) => skill.indexed)
					.map((skill) => `${skill.name} — ${skill.description}`)
					.join("\n") || "无技能 / No skills";
		else if (/^connect(?:\s+[a-z0-9-]+)?$/.test(command)) {
			if (!profile.resolved.capabilities.includes("admin") || !profile.resolved.capabilities.includes("network"))
				throw new Error("接入渠道需要 admin + network 权限");
			if (!services.login) throw new Error("当前服务不支持渠道登录");
			const response = await services.login(command.split(/\s+/)[1]);
			result.text = [
				`渠道：${response.instance} · ${response.status}`,
				response.qrcodeUrl ? `请用微信扫描二维码完成接入：[打开扫码链接](${response.qrcodeUrl})` : undefined,
				response.expiresAt ? `有效期至 ${response.expiresAt}` : undefined,
			]
				.filter(Boolean)
				.join("\n");
		} else if (command === "stop") {
			await sessions.api.abort(session.id);
			result.text = "已中止当前会话 / Stopped";
		} else
			result.text = chatCommands.some((item) => item.name === command)
				? `/${command} 仅适用于终端交互；/help 查看当前可用命令。`
				: "未知命令；/help 查看当前可用命令。";
	} catch (error) {
		result.status = "error";
		result.text = error instanceof Error ? error.message : "命令执行失败";
	}
	const sent = await delivery.sendCommand(session, event, result.text);
	await store.events.record({
		type: "channel.command.result",
		parent: event.id,
		conv: event.conv,
		data: { session: session.id, command, status: result.status, delivery: sent },
	});
	return result;
}
