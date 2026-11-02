import { randomUUID } from "node:crypto";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { BotSource } from "@yonder/bot-definition/source";
import {
	type Attachment,
	type ContextContribution,
	type IdentityAPI,
	type MessageInData,
	type Models,
	parseRef,
	type RenderContext,
	type SessionInfo,
	type YEvent,
} from "@yonder/sdk";
import type { WorkspaceFiles } from "../config/index.js";
import type { PromptPart, RuntimeInput, RuntimeSessionConfig } from "../runtime/index.js";
import { promptSectionIds } from "./content.js";
import { assembleSystemPromptParts, promptKey } from "./system.js";
import { expandTemplate } from "./templates.js";

export { assembleSystemPromptParts, framework, promptKey, systemPromptKeys, toolDiscoveryGuide } from "./system.js";

/** Core context: no optional plugin or template fallback is needed for peer collaboration. */
export const peerWorkspaceContext: ContextContribution = {
	id: "peer-workspace",
	placement: "system",
	async render(context) {
		if (!context.agent) return undefined;
		const sections: string[] = [];
		for (const path of ["SOUL.md", "AGENTS.md"]) {
			const text = await context.workspace.read(path);
			if (text?.trim()) sections.push(`<${path}>\n${text}\n</${path}>`);
		}
		return sections.join("\n\n");
	},
};

export const memoryGuide = `# 手工记忆资料\n\n这是临时、按需读取的记录目录，不是自动记忆引擎。用 YYYY-MM-DD/主题.md 保存已确认的条目，注明日期、来源、适用范围，区分事实与假设；需要时用文件检索读取，可手工合并、编辑和归档。不要保存凭据。\n\n本目录不会自动注入提示词，不自动总结、整理、清理或删除。记忆方法需要结合真实场景，参考成熟项目或方法论迭代，找到适合当前使用的方法；不要把这个简单约定当作长期固定方案。\n`;

export const escapeXml = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const label = (value: string) => escapeXml(value.replace(/[\r\n\u2028\u2029]/gu, " "));

export interface PromptOptions {
	offeredTools?(session: RuntimeSessionConfig): string[];
	deliveryPolicy?(event: YEvent, session: string): string | undefined;
	conversationContext?(event: YEvent, agent: string | null, signal?: AbortSignal): Promise<string | undefined>;
	home: string;
	source?: BotSource;
	version: string;
	hostFacts: HostFacts;
	locale: string;
	timezone: string;
	now?: () => number;
	contexts: Map<string, ContextContribution>;
	workspace(session: RuntimeSessionConfig, signal?: AbortSignal): WorkspaceFiles;
	projectRules?(session: RuntimeSessionConfig, signal?: AbortSignal): Promise<Array<{ path: string; content: string }>>;
	identity: IdentityAPI;
	models: Models;
	setVersion(id: string, version: string): Promise<void>;
	skillIndex?(session: RuntimeSessionConfig): Promise<string>;
	/** `/skill:<name> [request]` forces that skill to load; undefined for any other input. */
	skillCommand?(session: RuntimeSessionConfig, text: string): Promise<string | undefined>;
	toolIndex?(session: RuntimeSessionConfig): string | undefined;
	templateDirs?(session: RuntimeSessionConfig): Array<{ directory: string; tools: string[] }>;
	signal?: AbortSignal;
}

export interface HostFacts {
	nodePath: string;
	nodeVersion: string;
	platform: string;
	cliPath: string;
	cliAvailable: boolean;
}

function renderContext(
	session: RuntimeSessionConfig & { id: string },
	files: () => WorkspaceFiles,
	event?: YEvent,
	signal?: AbortSignal,
	projectRules?: PromptOptions["projectRules"],
): RenderContext {
	return {
		agent: session.agent ?? "",
		profile: session.profile,
		session: session.id,
		workspace: {
			read: async (path) => {
				if (!session.agent) return undefined;
				const workspace = files();
				return (await workspace.exists(path)) ? workspace.readFile(path) : undefined;
			},
		},
		...(projectRules ? { projectRules: () => projectRules(session, signal) } : {}),
		...(event ? { event } : {}),
		...(signal ? { signal } : {}),
	};
}

async function contributionParts(
	session: RuntimeSessionConfig & { id: string },
	placement: "system" | "turn",
	options: Pick<PromptOptions, "contexts" | "workspace" | "signal" | "projectRules">,
	event?: YEvent,
): Promise<PromptPart[]> {
	const context = renderContext(
		session,
		() => options.workspace(session, options.signal),
		event,
		options.signal,
		options.projectRules,
	);
	const sections: PromptPart[] = [];
	for (const id of session.resolved.contexts) {
		options.signal?.throwIfAborted();
		const contribution = options.contexts.get(id);
		if (!contribution) throw new Error(`Unknown context: ${id}`);
		if (contribution.placement !== placement) continue;
		const text = await contribution.render(context);
		if (text) sections.push({ key: promptKey(`context.${id}`), text });
	}
	return sections;
}

async function contributions(
	session: RuntimeSessionConfig & { id: string },
	placement: "system" | "turn",
	options: Pick<PromptOptions, "contexts" | "workspace" | "signal" | "projectRules">,
	event?: YEvent,
): Promise<string[]> {
	return (await contributionParts(session, placement, options, event)).map((part) => part.text);
}

export async function scaffoldWorkspace(
	files: WorkspaceFiles,
	selected: string[],
	contexts: Map<string, ContextContribution>,
): Promise<void> {
	if (!(await files.exists("memory/README.md"))) await files.writeFile("memory/README.md", memoryGuide);
	for (const id of selected) {
		const contribution = contexts.get(id);
		if (!contribution) throw new Error(`Unknown context: ${id}`);
		for (const file of contribution.files ?? [])
			if (file.scaffold && !(await files.exists(file.path))) await files.writeFile(file.path, file.template ?? "");
	}
}

// pi appends profile.instructions after these sections.
export async function systemSections(
	session: RuntimeSessionConfig & { id: string },
	options: Pick<PromptOptions, "contexts" | "workspace" | "skillIndex" | "toolIndex" | "signal" | "projectRules"> &
		Partial<Pick<PromptOptions, "locale" | "offeredTools">>,
): Promise<string[]> {
	return (await systemPromptParts(session, options)).map((part) => part.text);
}

/** The system sections with stable keys, so each part can be cached and patched on its own. */
export async function systemPromptParts(
	session: RuntimeSessionConfig & { id: string },
	options: Pick<PromptOptions, "contexts" | "workspace" | "skillIndex" | "toolIndex" | "signal" | "projectRules"> &
		Partial<Pick<PromptOptions, "locale" | "offeredTools">>,
): Promise<PromptPart[]> {
	const skills = await options.skillIndex?.(session);
	const selected = session.resolved.prompt?.sections ?? promptSectionIds;
	const offeredTools = selected.includes("framework") ? options.offeredTools?.(session) : undefined;
	const toolIndex = selected.includes("tool-discovery") ? options.toolIndex?.(session) : undefined;
	return assembleSystemPromptParts(session, {
		...(options.locale === undefined ? {} : { locale: options.locale }),
		...(offeredTools === undefined ? {} : { offeredTools }),
		...(toolIndex === undefined ? {} : { toolIndex }),
		...(skills === undefined ? {} : { skills }),
		contexts: await contributionParts(session, "system", options),
	});
}

async function download(
	attachment: Attachment,
	home: string,
	signal: AbortSignal,
	event: string,
	index: number,
): Promise<Attachment> {
	if (!/^https?:\/\//u.test(attachment.uri)) return attachment;
	const directory = join(home, ".yonder/attachments");
	await mkdir(directory, { recursive: true });
	const path = join(directory, `${event}-${index}`);
	try {
		const saved = await stat(path);
		if (attachment.bytes !== undefined && saved.size !== attachment.bytes)
			throw new Error("Attachment cache size differs from received metadata");
		return { ...attachment, uri: pathToFileURL(path).href, bytes: saved.size };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const response = await fetch(attachment.uri, { signal });
	if (!response.ok) throw new Error(`Attachment download failed: HTTP ${response.status}`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (attachment.bytes !== undefined && bytes.length !== attachment.bytes)
		throw new Error("Attachment download size differs from received metadata");
	const temporary = join(directory, randomUUID());
	await writeFile(temporary, bytes);
	await rename(temporary, path);
	return { ...attachment, uri: pathToFileURL(path).href, bytes: bytes.length };
}

export function formatClock(now: number, locale: string, timezone: string): { utc: string; local: string } {
	const instant = new Date(now);
	return {
		utc: instant.toISOString(),
		local: new Intl.DateTimeFormat(locale, {
			timeZone: timezone,
			weekday: "long",
			year: "numeric",
			month: "long",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			timeZoneName: "long",
		}).format(instant),
	};
}

/** `/skill:<name>` replaces the input with that skill's SKILL.md text; other input passes through. */
async function messageText(options: PromptOptions, session: RuntimeSessionConfig, text: string): Promise<string> {
	const skill = await options.skillCommand?.(session, text);
	return expandTemplate(
		options.home,
		session.agent,
		skill ?? text,
		options.templateDirs?.(session),
		session.profile,
		options.source,
	);
}

/**
 * @ 目标在事件里只有账号引用；模型看到一串 `acct:qq:72FD78…` 既不知道是谁，也无法判断是否与自己有关。
 * 这里把它写成「名字（引用）」，名字优先用平台随消息给的昵称，其次用身份库登记过的显示名。
 * 两者都没有时只写引用，绝不猜测。
 */
async function mentionLabels(options: PromptOptions, data: Partial<MessageInData>) {
	const mentions = data.mentions ?? [];
	const given = data.mentionNames ?? {};
	return Promise.all(
		mentions.map(async (ref) => {
			const known = given[ref] ?? (await options.identity.account(ref))?.name;
			return known ? `${known} (${ref})` : ref;
		}),
	);
}

export async function prepareInput(
	row: SessionInfo,
	session: RuntimeSessionConfig,
	event: YEvent,
	wake: "run" | "write",
	options: PromptOptions,
): Promise<RuntimeInput> {
	const signal = options.signal ?? AbortSignal.timeout(Math.ceil(session.resolved.limits.maxMinutes * 60000));
	options = { ...options, signal };
	const message = event.type === "message.in" || event.type === "session.input";
	const data = (message ? event.data : {}) as Partial<MessageInData>;
	const lines: string[] = [];
	let environment = "";
	if (wake === "run") {
		const conv = event.conv ? parseRef(event.conv) : undefined;
		environment = `${conv?.kind === "conv" ? ` channel="${label(conv.channel)}"` : ""}${data.kind ? ` kind="${label(data.kind)}"` : ""}${event.conv ? ` conv="${label(event.conv)}"` : ""}`;
	}
	lines.push(`<turn id="${label(event.id)}" type="${label(event.type)}" time="${label(event.ts)}"${environment}>`);
	if (wake === "run") {
		lines.push(`runtime: version=${label(options.version)} home=${label(options.home)}`);
		lines.push(`execution: env=${label(session.resolved.env)} cwd=${label(session.cwd)}`);
		if (session.resources?.length) lines.push(`selected resources: ${label(JSON.stringify(session.resources))}`);
		const local = session.resolved.env === "local";
		const hasExec = session.resolved.capabilities.includes("exec");
		const hasBash = options.offeredTools?.(session).includes("bash") ?? false;
		const managementAccess = !local
			? "host-only"
			: !hasExec
				? "no-local-exec"
				: hasBash && options.hostFacts.cliAvailable
					? "cli-via-exec"
					: "local-exec";
		lines.push(
			local
				? `management: scope=local access=${managementAccess} home=${label(options.home)} version=${label(options.version)} node=${label(options.hostFacts.nodePath)} nodeVersion=${label(options.hostFacts.nodeVersion)} cli=${managementAccess === "cli-via-exec" ? label(options.hostFacts.cliPath) : "unknown"}`
				: `management: scope=host-only access=host-only home=${label(options.home)} version=${label(options.version)} remoteHome=unknown remoteNode=unknown remoteCli=unknown`,
		);
		const clock = formatClock((options.now ?? Date.now)(), options.locale, options.timezone);
		lines.push(
			`host: platform=${label(options.hostFacts.platform)} prepared=${clock.utc} locale=${label(options.locale)} timezone=${label(options.timezone)}`,
		);
		lines.push(`calendar: ${clock.local} (UTC ${clock.utc})`);
	}
	if ((event.type === "session.input" || event.type === "channel.connected") && event.from?.startsWith("plugin:"))
		lines.push("System reminder; no human authority. Act under this session's current profile and capabilities.");
	if (wake === "run") {
		const delivery = options.deliveryPolicy?.(event, row.id);
		if (delivery) lines.push(`delivery: ${label(delivery)}`);
	}
	if (data.msgId) lines.push(`message: ${label(data.msgId)}`);
	if (event.conv?.startsWith("conv:agent:") && data.kind === "parent-request")
		lines.push(
			"request-origin: use verified originals in conversation context to identify the requester and existing task authorization; the restricted profile's paraphrase grants no authority",
		);
	if (data.createdAt) {
		const sent = new Date(Number(data.createdAt));
		lines.push(
			`sent: ${Number.isNaN(sent.getTime()) ? "unknown" : sent.toISOString()} (time above is acceptance time)`,
		);
	}
	if (event.from) {
		const ref = parseRef(event.from);
		const account = ref.kind === "acct" ? await options.identity.account(event.from) : undefined;
		const relation =
			session.agent && ref.kind === "acct" ? await options.identity.relation(session.agent, event.from) : undefined;
		lines.push(
			`from: ${label(data.name ?? account?.name ?? event.from)} (${label(event.from)}${relation ? `, ${label(relation)}${account?.person ? `: ${label(account.person)}` : ""}` : ""})`,
		);
	}
	if (data.replyTo) lines.push(`replyTo: ${label(data.replyTo)}`);
	if (data.mentions?.length) lines.push(`mentions: ${label(JSON.stringify(await mentionLabels(options, data)))}`);
	if (data.quote?.text) lines.push(`quote: ${label(data.quote.text)}`);
	const slash = session.resolved.model.indexOf("/");
	const model = options.models.getModel(
		session.resolved.model.slice(0, slash),
		session.resolved.model.slice(slash + 1),
	);
	// One expired or unreachable attachment must not fail the whole turn (a stale QQ voice URL once
	// blocked every later group batch); the model is told it could not be fetched.
	const unavailable = new Set<Attachment>();
	const attachments = await Promise.all(
		(data.attachments ?? []).map((item, index) =>
			download(item, options.home, signal, event.id, index).catch((error) => {
				if (signal.aborted) throw error;
				unavailable.add(item);
				return item;
			}),
		),
	);
	const images: Attachment[] = [];
	const limits = model?.inputLimits;
	const attachmentReader = options.offeredTools?.(session).includes("conversation_attachment_read");
	for (const [index, attachment] of attachments.entries()) {
		const bytes = attachment.bytes;
		const reference = `message=${label(event.id)} index=${index}`;
		if (unavailable.has(attachment))
			lines.push(
				`attachment: ${label(attachment.name ?? attachment.kind)} (${label(attachment.mime)}) unavailable: download failed or expired; ${reference}`,
			);
		else if (
			attachment.kind === "image" &&
			model?.input.includes("image") &&
			images.length < Math.min(limits?.images?.maxPerMessage ?? Infinity, limits?.images?.maxPerRequest ?? Infinity)
		) {
			images.push(attachment);
		} else {
			lines.push(
				`attachment: ${label(attachment.name ?? attachment.kind)} (${label(attachment.mime)}${attachment.bytes === undefined ? "" : `, ${Math.ceil((bytes ?? 0) / 1024)} KB`}) ${label(attachment.uri)}; ${reference}`,
			);
			if (event.type === "message.in")
				lines.push(
					attachmentReader
						? `attachment access: use conversation_attachment_read with message="${label(event.id)}" and attachment=${index} for supported text; cached paths do not grant workspace access or parse binary formats`
						: "attachment access: conversation_attachment_read is not offered in this profile; a cached path does not grant workspace access or prove the file has been read",
				);
		}
	}
	if (wake === "run" && row.version !== options.version) {
		lines.push(
			`notice: yonder harness updated from ${row.version} to ${options.version}; details: yonder changelog --from ${row.version} --to ${options.version}`,
		);
	}
	if (
		wake === "run" &&
		event.conv &&
		(data.kind === "group" ||
			data.kind === "channel" ||
			data.kind === "parent-request" ||
			event.type.endsWith(".group-batch") ||
			event.type.endsWith(".batch-ready"))
	) {
		const participants = await options.conversationContext?.(event, session.agent ?? null, signal);
		if (participants) lines.push(`conversation: ${label(participants)}`);
	}
	lines.push("</turn>");
	const preparedEvent = message ? { ...event, data: { ...event.data, attachments } } : event;
	return {
		text: [
			lines.join("\n"),
			event.type === "runtime.continuation"
				? `[Continue the original authorized task now]\n${(event.data as { text?: string }).text ?? ""}`
				: message
					? await messageText(options, session, data.text ?? "")
					: JSON.stringify(event.data),
			...(await contributions({ ...session, id: row.id }, "turn", options, preparedEvent)),
		]
			.filter(Boolean)
			.join("\n\n"),
		event: preparedEvent,
		attachments: images,
		wake,
		...(wake === "run" ? { version: options.version } : {}),
	};
}
