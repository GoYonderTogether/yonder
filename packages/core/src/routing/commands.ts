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

/** Extra slash commands and background aliases (X14/B6). `argumentHint` feeds autocomplete. */
export const extraSlashCommands = [
	{ name: "reload", description: "重载配置 · Reload config", argumentHint: "" },
	{ name: "copy", description: "复制最近回复 · Copy last reply", argumentHint: "" },
	{ name: "name", description: "命名会话 · Name session", argumentHint: "<标题>" },
	{ name: "trust", description: "记录目录信任 · Trust directory", argumentHint: "<目录>" },
	{ name: "settings", description: "设置视图 · Settings", argumentHint: "" },
	{ name: "jobs", description: "后台任务（/bg 别名）· bg_status", argumentHint: "" },
	{ name: "logs", description: "后台任务日志（/bg logs）· bg_logs", argumentHint: "<id>" },
	{ name: "kill", description: "停止后台任务（/bg kill）· bg_kill", argumentHint: "<id>" },
] as const;
const extraPattern = new RegExp(`^(${extraSlashCommands.map((item) => item.name).join("|")})(?:\\s|$)`);

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
		reload?: () => Promise<unknown>;
	},
): Promise<RunResult | undefined> {
	const command = chatCommand(String((event.data as { text?: unknown }).text ?? ""));
	if (command === undefined || !event.conv) return;
	// Only consume recognized builtins. Plugin/model slash input keeps the normal admission path.
	if (
		!chatCommands.some((item) => item.name === command) &&
		!/^(model|effort|status|bg|compact)(?:\s|$)/.test(command) &&
		!extraPattern.test(command) &&
		!/^connect(?:\s+[a-z0-9-]+)?$/.test(command)
	)
		return;
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
			result.text = [...channelChatCommands, ...extraSlashCommands]
				.map((item) => `/${item.name} — ${item.description}`)
				.join("\n");
		else if (command === "session")
			result.text = `Agent: ${session.agent}\nSession: ${session.id}\nMode: ${session.mode}\nProfile: ${session.profile}\nModel: ${profile.resolved.model}`;
		else if (/^(model|effort|status|bg|compact)(?:\s|$)/.test(command))
			result.text = await sessions.api.command(session.id, command);
		else if (extraPattern.test(command)) result.text = await extraCommand(command, session, event, profile, services);
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
		} else result.text = `/${command} 仅适用于终端交互；/help 查看当前可用命令。`;
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

async function extraCommand(
	command: string,
	session: SessionInfo,
	event: YEvent,
	profile: Awaited<ReturnType<ReturnType<typeof createSessions>["resolveSession"]>>,
	services: { store: Store; sessions: ReturnType<typeof createSessions>; reload?: () => Promise<unknown> },
): Promise<string> {
	const [name = "", ...rest] = command.split(/\s+/);
	const arg = command.slice(name.length).trim();
	const caps = profile.resolved.capabilities;
	if (name === "jobs" || name === "logs" || name === "kill") {
		if (name === "jobs" && arg) throw new Error("用法：/jobs");
		if (name !== "jobs" && !/^\d+$/.test(arg)) throw new Error(`用法：/${name} <id>`);
		const alias = name === "jobs" ? "bg" : `bg ${name === "logs" ? "logs" : "kill"} ${arg}`;
		return services.sessions.api.command(session.id, alias);
	}
	if (name === "settings") {
		session = (await services.store.sessions.get(session.id)) ?? session;
		return JSON.stringify(
			{
				agent: session.agent,
				session: session.id,
				profile: session.profile,
				mode: session.mode,
				title: session.title ?? null,
				model: profile.resolved.model,
				thinking: profile.resolved.thinking,
				capabilities: caps,
			},
			null,
			2,
		);
	}
	if (name === "copy") {
		const { events } = await services.store.events.query({
			type: "message.out",
			...(event.conv ? { conv: event.conv } : {}),
		});
		const last = events.filter((item) => (item.data as { session?: string }).session === session.id).pop();
		const text = (last?.data as { text?: unknown } | undefined)?.text;
		if (typeof text !== "string" || !text) throw new Error("没有可复制的回复");
		return text;
	}
	if (!caps.includes("admin")) throw new Error(`/${name} 需要 admin 权限`);
	if (name === "reload") {
		if (!services.reload) throw new Error("当前服务不支持重载");
		await services.reload();
		return "已重载配置 / Reloaded";
	}
	if (rest.length === 0) throw new Error(`用法：/${name} ${name === "name" ? "<标题>" : "<目录>"}`);
	if (name === "name") {
		await services.store.sessions.update(session.id, { title: arg });
		return `会话已命名：${arg}`;
	}
	await services.store.events.record({
		type: "session.trust",
		parent: event.id,
		...(event.conv ? { conv: event.conv } : {}),
		data: { session: session.id, directory: arg },
	});
	return `已记录目录信任：${arg}`;
}
