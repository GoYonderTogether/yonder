#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { type QrConnectCredentials, startQrConnect } from "@tencent-connect/qqbot-connector";
import lockfile from "proper-lockfile";
import { parseDocument } from "yaml";
import { parentMigration } from "./parent-migration.js";
import { groupInstructions, groupTools, legacyGroupInstructions } from "./participation.js";

interface SetupOptions {
	home: string;
	agent: string;
	instance: string;
	profile?: string;
	groupProfile?: string;
}
const identifier = /^[a-z0-9-]+$/;
const expand = (home: string, path: string) =>
	path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : resolve(home, path);

async function document(path: string) {
	const doc = parseDocument(await readFile(path, "utf8"));
	if (doc.errors.length || !doc.toJSON() || typeof doc.toJSON() !== "object") throw new Error(`Invalid YAML: ${path}`);
	return doc;
}

async function inspect(options: SetupOptions) {
	if (![options.instance, options.agent].every((id) => identifier.test(id)) || options.instance === "agent")
		throw new Error("Invalid QQ instance or agent ID");
	const file = join(options.home, "yonder.yaml");
	const config = await document(file);
	if (config.hasIn(["channels", options.instance]))
		throw new Error(`Channel ${options.instance} already exists; select a new --instance to preserve it`);
	const entry = config.toJSON().agents?.find((item: { id: string }) => item.id === options.agent);
	if (!entry || (entry.env && entry.env !== "local"))
		throw new Error("QQ setup requires an existing local Agent workspace");
	const agentFile = join(expand(options.home, entry.workspace), "agent.yaml");
	const agent = await document(agentFile);
	const value = agent.toJSON();
	if (value.archivedAt) throw new Error("Cannot bind an archived Agent");
	const main = value.bindings?.find((binding: { session: unknown }) => binding.session === "main");
	const profile = options.profile ?? main?.profile ?? value.defaultProfile;
	if (!value.profiles?.[profile]) throw new Error("Select an existing private-chat --profile");
	if (main && (main.profile ?? value.defaultProfile) !== profile)
		throw new Error("Private chat must use the existing main-session profile");
	const groupProfile = options.groupProfile ?? `${options.instance}-group`;
	if (options.groupProfile && !value.profiles?.[groupProfile]) throw new Error("Unknown --group-profile");
	if (!options.groupProfile && value.profiles?.[groupProfile])
		throw new Error("Group profile already exists; explicitly select it with --group-profile");
	return { file, config, agentFile, agent, profile, groupProfile };
}

async function atomic(path: string, content: string, mode: number) {
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, content, { mode, flag: "wx" });
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}

/** Explicit local CLI only; the loaded channel continues to use read-only PluginAPI.credentials. */
export async function configure(
	options: SetupOptions,
	credentials: QrConnectCredentials,
	pluginSource = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, ""),
) {
	if (
		!/^\d+$/.test(credentials.appId) ||
		!credentials.appSecret ||
		!credentials.userOpenid ||
		/\s/.test(credentials.userOpenid)
	)
		throw new Error("Binding did not return a bot and scanner OpenID; no configuration written");
	const initial = await inspect(options);
	const unlock = await lockfile.lock(initial.file);
	let unlockAgent: (() => Promise<void>) | undefined;
	try {
		unlockAgent = await lockfile.lock(initial.agentFile);
		const current = await inspect(options);
		const credential = `qq-${options.instance}`;
		if (
			Object.values(current.config.toJSON().channels ?? {}).some(
				(item: unknown) =>
					item !== null &&
					typeof item === "object" &&
					"type" in item &&
					item.type === "qq" &&
					"appId" in item &&
					item.appId === credentials.appId,
			)
		)
			throw new Error("This QQ bot is already configured in this home");
		const originalConfig = await readFile(current.file, "utf8");
		const originalAgent = await readFile(current.agentFile, "utf8");
		const privateAgent = current.agent.toJSON();
		current.agent.setIn(
			["profiles", current.profile, "plugins"],
			[
				...new Set([
					...(privateAgent.profiles[current.profile].plugins ?? privateAgent.defaults?.plugins ?? []),
					"channel-qq",
				]),
			],
		);
		const plugins: { use: string }[] = current.config.toJSON().plugins ?? [];
		if (!plugins.some((plugin) => plugin.use === pluginSource || plugin.use === "@yonder/plugin-channel-qq"))
			plugins.push({ use: pluginSource });
		current.config.set("plugins", plugins);
		current.config.setIn(["channels", options.instance], {
			type: "qq",
			appId: credentials.appId,
			credential,
			allowedUsers: [credentials.userOpenid],
			groupWindowSeconds: 3,
		});
		if (!options.groupProfile) {
			const agent = current.agent.toJSON();
			const model =
				agent.profiles[current.profile].model ?? agent.defaults?.model ?? current.config.get("defaultModel");
			if (!model) throw new Error("Group chat requires a configured model");
			current.agent.setIn(["profiles", current.groupProfile], {
				model,
				capabilities: ["read"],
				tools: { offer: groupTools, search: [] },
				// 参与机会由 social 的批次提供（spec 11 §15），群配置档必须选中该插件。
				plugins: ["social"],
				contexts: ["peer-workspace"],
				skills: [],
				instructions: groupInstructions,
			});
		}
		const bindings = current.agent.toJSON().bindings ?? [];
		for (const id of [
			`${options.instance}-dm`,
			`${options.instance}-group`,
			`${options.instance}-batch`,
			`${options.instance}-parent`,
		])
			if (bindings.some((binding: { id: string }) => binding.id === id))
				throw new Error(`Binding ${id} already exists`);
		current.agent.set("bindings", [
			{
				id: `${options.instance}-dm`,
				match: { channel: options.instance, kind: "dm", from: `acct:${options.instance}:${credentials.userOpenid}` },
				session: "main",
				profile: current.profile,
				busy: "steer",
			},
			{
				id: `${options.instance}-group`,
				match: { channel: options.instance, kind: "group" },
				session: { mode: "persistent", per: "conv" },
				profile: current.groupProfile,
				wake: "write",
				reply: "none",
			},
			{
				id: `${options.instance}-batch`,
				match: { type: "social.batch-ready", channel: options.instance },
				session: { mode: "persistent", per: "conv" },
				profile: current.groupProfile,
				reply: "none",
				busy: "steer",
			},
			{
				id: `${options.instance}-parent`,
				match: { channel: "agent", kind: "parent-request", from: `acct:agent:${options.agent}` },
				session: "main",
				profile: current.profile,
				reply: "none",
				busy: "followup",
			},
			...bindings,
		]);
		const authPath = expand(options.home, current.config.toJSON().credentials ?? ".yonder/auth.json");
		await mkdir(dirname(authPath), { recursive: true, mode: 0o700 });
		try {
			await writeFile(authPath, "{}", { flag: "wx", mode: 0o600 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
		const unlockAuth = await lockfile.lock(authPath, { realpath: false, stale: 30000 });
		try {
			const originalAuth = await readFile(authPath, "utf8");
			let auth: unknown;
			try {
				auth = JSON.parse(originalAuth);
			} catch {
				throw new Error("Invalid credential file; refusing to overwrite");
			}
			if (!auth || typeof auth !== "object" || Array.isArray(auth))
				throw new Error("Invalid credential file; refusing to overwrite");
			if (Object.hasOwn(auth, credential))
				throw new Error(`Credential ${credential} already exists; select another --instance`);
			const authFile = await realpath(authPath);
			const changed: Array<{ path: string; original: string }> = [];
			try {
				for (const item of [
					{
						path: authFile,
						original: originalAuth,
						next: JSON.stringify({ ...auth, [credential]: { type: "api_key", key: credentials.appSecret } }, null, 2),
					},
					{ path: current.file, original: originalConfig, next: current.config.toString() },
					{ path: current.agentFile, original: originalAgent, next: current.agent.toString() },
				]) {
					await atomic(item.path, item.next, 0o600);
					changed.push(item);
				}
				await chmod(authFile, 0o600);
			} catch {
				for (const item of changed.reverse()) await atomic(item.path, item.original, 0o600);
				throw new Error("QQ configuration could not be saved; completed writes were restored");
			}
		} finally {
			await unlockAuth();
		}
		return {
			instance: options.instance,
			appId: credentials.appId,
			credential,
			user: `acct:${options.instance}:${credentials.userOpenid}`,
			groupProfile: current.groupProfile,
			home: options.home,
			restartRequired: true,
		};
	} finally {
		await unlockAgent?.();
		await unlock();
	}
}

export async function connect(onLink: (url: string) => void, signal: AbortSignal): Promise<QrConnectCredentials[]> {
	signal.throwIfAborted();
	return new Promise((resolvePromise, reject) => {
		startQrConnect(
			{
				onSuccess: resolvePromise,
				onFailure: () =>
					reject(
						new Error(
							signal.aborted ? "QQ binding cancelled" : "QQ binding failed; retry setup or use the official console",
						),
					),
				onQrDisplayed(url) {
					const parsed = new URL(url);
					if (parsed.protocol !== "https:" || parsed.hostname !== "q.qq.com") {
						reject(new Error("Unexpected QQ binding domain"));
						return;
					}
					onLink(url);
				},
			},
			{ displayQrCodeToConsole: Boolean(process.stdout.isTTY), source: "yonder", signal },
		);
	});
}

/** The exact profile shape `setup` writes; anything else is a user customization and stays untouched. */
function isOfficialGroupProfile(profile: unknown) {
	if (!profile || typeof profile !== "object") return false;
	const value = profile as Record<string, unknown>;
	const instructions = value.instructions;
	if (instructions !== legacyGroupInstructions && instructions !== groupInstructions) return false;
	const tools = value.tools as { offer?: unknown; search?: unknown } | undefined;
	if (!Array.isArray(tools?.offer) || !Array.isArray(tools?.search)) return false;
	if (tools.search.length) return false;
	if (!tools.offer.every((name) => typeof name === "string" && groupTools.includes(name))) return false;
	return ["contexts", "skills", "plugins"].every((key) => value[key] === undefined || Array.isArray(value[key]));
}

/**
 * Migrate only confirmable official QQ group configuration; custom bindings and custom profiles are
 * never overwritten. Preview by default; writes one backup per file and is safe to repeat.
 *
 * - group profile: official instructions/tools/contexts → current instructions + `social` selected.
 * - group binding: `wake: write` + `persistent/per: conv` + `reply: none` already match spec 11 §15.
 * - batch binding: the deprecated `channel-qq.group-batch` run binding becomes `social.batch-ready`.
 */
export async function upgradeGroups(home: string, agentId?: string, options: { apply?: boolean } = {}) {
	const config = await document(join(home, "yonder.yaml"));
	const channels = (config.toJSON().channels ?? {}) as Record<string, { type?: unknown }>;
	const changed: string[] = [],
		skipped: string[] = [],
		preview: Array<{ file: string; binding?: string; profile?: string }> = [];
	for (const entry of config.toJSON().agents ?? []) {
		if (agentId && entry.id !== agentId) continue;
		if (entry.env && entry.env !== "local") {
			skipped.push(entry.id);
			continue;
		}
		const file = join(expand(home, entry.workspace), "agent.yaml");
		const unlock = await lockfile.lock(file);
		try {
			const doc = await document(file);
			let dirty = false;
			const value = doc.toJSON() as Record<string, unknown>;
			const profiles = (value.profiles ?? {}) as Record<string, Record<string, unknown>>;
			const bindings = (value.bindings ?? []) as Array<Record<string, unknown>>;
			const qqInstances = new Set(
				Object.entries(channels)
					.filter(([, item]) => item.type === "qq")
					.map(([id]) => id),
			);
			// 1. official group profiles: current instructions/contexts/tools and a real participation provider.
			for (const [id, profile] of Object.entries(profiles)) {
				if (!isOfficialGroupProfile(profile)) continue;
				const offer = (profile.tools as { offer?: string[] } | undefined)?.offer ?? [];
				const contexts = (profile.contexts ?? []) as string[];
				const plugins = (profile.plugins ?? []) as string[];
				const next = {
					instructions: groupInstructions,
					contexts: [...new Set([...contexts, "peer-workspace"])],
					tools: { ...(profile.tools as object), offer: [...new Set([...offer, ...groupTools])] },
					plugins: [...new Set([...plugins, "social"])],
					skills: (profile.skills ?? []) as string[],
				};
				for (const key of Object.keys(next) as Array<keyof typeof next>) {
					if (JSON.stringify(profile[key]) === JSON.stringify(next[key])) continue;
					doc.setIn(["profiles", id, key], next[key]);
					preview.push({ file, profile: id });
					dirty = true;
				}
			}
			for (const [index, binding] of bindings.entries()) {
				const match = (binding.match ?? {}) as Record<string, unknown>;
				const instances = match.channel === undefined ? [] : [match.channel].flat();
				const qq = instances.some((id) => typeof id === "string" && qqInstances.has(id));
				// 自定义绑定不覆盖：只认引用官方群配置档的绑定。
				const referenced = typeof binding.profile === "string" ? profiles[binding.profile] : undefined;
				if (!qq || !referenced || !isOfficialGroupProfile(referenced)) continue;
				// 2. group write binding: only the exact official shape is accepted as already migrated.
				if (
					match.kind === "group" &&
					typeof binding.session === "object" &&
					binding.session !== null &&
					(binding.session as Record<string, unknown>).mode === "persistent" &&
					(binding.session as Record<string, unknown>).per === "conv" &&
					binding.reply === "none" &&
					binding.wake !== "write"
				) {
					doc.setIn(["bindings", index, "wake"], "write");
					binding.wake = "write";
					preview.push({ file, binding: String(binding.id ?? index) });
					dirty = true;
				}
				// 3. deprecated batch run binding → social.batch-ready, same session/profile/reply.
				if (
					match.type === "channel-qq.group-batch" &&
					binding.reply === "none" &&
					typeof binding.session === "object" &&
					binding.session !== null &&
					(binding.session as Record<string, unknown>).mode === "persistent" &&
					(binding.session as Record<string, unknown>).per === "conv"
				) {
					doc.setIn(["bindings", index, "match", "type"], "social.batch-ready");
					match.type = "social.batch-ready";
					preview.push({ file, binding: String(binding.id ?? index) });
					dirty = true;
				}
			}
			const qqGroups = new Map<string, string>();
			for (const binding of bindings) {
				const match = binding.match as Record<string, unknown> | undefined;
				const channels = match?.channel === undefined ? [] : [match.channel].flat();
				const session = binding.session as Record<string, unknown> | undefined;
				if (
					match?.kind === "group" &&
					(match.type === undefined || match.type === "message.in") &&
					binding.wake === "write" &&
					binding.reply === "none" &&
					session?.mode === "persistent" &&
					session.per === "conv" &&
					typeof binding.profile === "string" &&
					isOfficialGroupProfile(profiles[binding.profile])
				)
					for (const instance of channels)
						if (typeof instance === "string" && qqInstances.has(instance)) qqGroups.set(instance, binding.profile);
			}
			const additions: Array<Record<string, unknown>> = [];
			const parent = parentMigration(entry.id, qqGroups, bindings, String(value.defaultProfile));
			if (parent?.reason)
				skipped.push(`${entry.id}/${parent.instance}: cannot add parent-request binding because ${parent.reason}`);
			if (parent?.binding) {
				additions.push(parent.binding);
				preview.push({ file, binding: String(parent.binding.id) });
				dirty = true;
			}
			if (additions.length) doc.set("bindings", [...bindings, ...additions]);
			if (!dirty) {
				skipped.push(entry.id);
				continue;
			}
			const before = await readFile(file, "utf8");
			const after = doc.toString();
			if (before === after) {
				skipped.push(entry.id);
				continue;
			}
			if (options.apply !== true) continue;
			const backup = `${file}.pre-qq-context-${randomUUID()}`;
			await writeFile(backup, before, { mode: 0o600, flag: "wx" });
			await atomic(file, after, 0o600);
			changed.push(file);
		} finally {
			await unlock();
		}
	}
	return { changed, skipped, preview, applied: options.apply === true };
}

async function main() {
	const { values, positionals } = parseArgs({
		options: {
			home: { type: "string" },
			agent: { type: "string" },
			instance: { type: "string", default: "qq-main" },
			profile: { type: "string" },
			"group-profile": { type: "string" },
			"app-id": { type: "string" },
			open: { type: "boolean" },
			apply: { type: "boolean" },
			help: { type: "boolean" },
		},
		allowPositionals: true,
	});
	if (values.help) {
		console.log(
			"yonder-qq upgrade-groups --home <Yonder home> [--agent <id>] [--apply] | setup --home <Yonder home> --agent <id> [--open] [--instance qq-main] [--profile <private profile>] [--group-profile <existing profile>] [--app-id <selected bot>]",
		);
		return;
	}
	if (positionals[0] === "upgrade-groups" && values.home) {
		console.log(
			JSON.stringify(await upgradeGroups(resolve(values.home), values.agent, { apply: values.apply === true })),
		);
		return;
	}
	if (positionals[0] !== "setup" || !values.home || !values.agent)
		throw new Error("Run yonder-qq setup --home <Yonder home> --agent <id> [--open]");
	const options: SetupOptions = {
		home: resolve(values.home),
		agent: values.agent,
		instance: values.instance,
		...(values.profile ? { profile: values.profile } : {}),
		...(values["group-profile"] ? { groupProfile: values["group-profile"] } : {}),
	};
	await inspect(options);
	const controller = new AbortController();
	const cancel = () => controller.abort();
	process.once("SIGINT", cancel);
	process.once("SIGTERM", cancel);
	try {
		console.log("请用手机 QQ 打开以下官方链接，登录并选择或创建机器人。凭据会直接保存，不会显示。");
		const credentials = await connect((url) => {
			console.log(JSON.stringify({ state: "awaiting-scan", url }));
			if (values.open) {
				const command = process.platform === "darwin" ? "open" : "xdg-open";
				const child = spawn(command, [url], { stdio: "ignore", shell: false });
				child.on("error", () => console.error("浏览器未打开，请直接使用上方链接。"));
			}
		}, controller.signal);
		const selected = values["app-id"]
			? credentials.find((item) => item.appId === values["app-id"])
			: credentials.length === 1
				? credentials[0]
				: undefined;
		if (!selected)
			throw new Error(
				`Choose one bot with --app-id; returned AppIDs: ${credentials.map((item) => item.appId).join(", ")}`,
			);
		controller.signal.throwIfAborted();
		console.log(JSON.stringify({ state: "configured", ...(await configure(options, selected)) }));
		console.log(
			"配置已保存。请重启此 home 的 Yonder 服务，在 QQ 私聊发送消息，再把机器人加入测试群并 @。群聊默认没有工具权限。",
		);
	} finally {
		process.off("SIGINT", cancel);
		process.off("SIGTERM", cancel);
	}
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url)
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : "QQ setup failed");
		process.exitCode = 1;
	});
