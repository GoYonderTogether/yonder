import { randomUUID } from "node:crypto";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
import type { RuntimeInput, RuntimeSessionConfig } from "../runtime/index.js";
import { cliPrompt, commonPrompt, residentPrompt, runtimePrompt } from "./content.js";

export const memoryGuide = `# 手工记忆资料\n\n这是临时、按需读取的记录目录，不是自动记忆引擎。用 YYYY-MM-DD/主题.md 保存已确认的条目，注明日期、来源、适用范围，区分事实与假设；需要时用文件检索读取，可手工合并、编辑和归档。不要保存凭据。\n\n本目录不会自动注入提示词，不自动总结、整理、清理或删除。记忆方法需要结合真实场景，参考成熟项目或方法论迭代，找到适合当前使用的方法；不要把这个简单约定当作长期固定方案。\n`;

export const escapeXml = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const label = (value: string) => escapeXml(value.replace(/[\r\n\u2028\u2029]/gu, " "));

export function framework(session: RuntimeSessionConfig): string {
	return `You run in Yonder Harness. Your agent ID is ${session.agent ?? "none (preset session)"}; your current profile is ${session.profile}.
Your final response is automatically returned to the caller or delivered according to the input's reply settings; do not send it again. If no reply is needed, output only NO_REPLY.
Use message_send to contact another person or channel, ${session.agent ? "agent_ask to ask another agent, and " : ""}task_run to delegate a specialized task. Read available skills with skill_view.
For unfinished work, keep using tools or use task_continue to durably queue the next step before ending a progress report. A background handle already waits and delivers its result automatically; do not queue polls. A promise in prose does not schedule work. An input of type runtime.continuation is the accepted next step: execute it now.
The notice lines inside <turn> are internal information for you; do not announce them unless relevant.${session.resolved.capabilities.includes("exec") ? " Use the yonder command and yonder docs to understand and maintain your runtime environment." : ""}`;
}

export interface PromptOptions {
	home: string;
	version: string;
	contexts: Map<string, ContextContribution>;
	workspace(session: RuntimeSessionConfig, signal?: AbortSignal): WorkspaceFiles;
	identity: IdentityAPI;
	models: Models;
	setVersion(id: string, version: string): Promise<void>;
	skillIndex?(session: RuntimeSessionConfig): Promise<string>;
	signal?: AbortSignal;
}

function renderContext(
	session: RuntimeSessionConfig & { id: string },
	files: () => WorkspaceFiles,
	event?: YEvent,
	signal?: AbortSignal,
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
		...(event ? { event } : {}),
		...(signal ? { signal } : {}),
	};
}

async function contributions(
	session: RuntimeSessionConfig & { id: string },
	placement: "system" | "turn",
	options: Pick<PromptOptions, "contexts" | "workspace" | "signal">,
	event?: YEvent,
): Promise<string[]> {
	const context = renderContext(session, () => options.workspace(session, options.signal), event, options.signal);
	const sections: string[] = [];
	for (const id of session.resolved.contexts) {
		options.signal?.throwIfAborted();
		const contribution = options.contexts.get(id);
		if (!contribution) throw new Error(`Unknown context: ${id}`);
		if (contribution.placement !== placement) continue;
		const text = await contribution.render(context);
		if (text) sections.push(text);
	}
	return sections;
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
	options: Pick<PromptOptions, "contexts" | "workspace" | "skillIndex" | "signal">,
): Promise<string[]> {
	const sections = [framework(session), commonPrompt];
	if (session.agent) sections.push(residentPrompt);
	sections.push(runtimePrompt);
	if (session.resolved.capabilities.includes("exec")) sections.push(cliPrompt);
	const skills = await options.skillIndex?.(session);
	if (skills) sections.push(skills);
	return [...sections, ...(await contributions(session, "system", options))];
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
		return { ...attachment, uri: pathToFileURL(path).href, bytes: saved.size };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const response = await fetch(attachment.uri, { signal });
	if (!response.ok) throw new Error(`Attachment download failed: HTTP ${response.status}`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	const temporary = join(directory, randomUUID());
	await writeFile(temporary, bytes);
	await rename(temporary, path);
	return { ...attachment, uri: pathToFileURL(path).href, bytes: bytes.length };
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
		lines.push(
			`host: platform=${process.platform} prepared=${new Date().toISOString()} timezone=${label(Intl.DateTimeFormat().resolvedOptions().timeZone)}`,
		);
	}
	if (data.msgId) lines.push(`message: ${label(data.msgId)}`);
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
	const slash = session.resolved.model.indexOf("/");
	const model = options.models.getModel(
		session.resolved.model.slice(0, slash),
		session.resolved.model.slice(slash + 1),
	);
	const attachments = await Promise.all(
		(data.attachments ?? []).map((item, index) => download(item, options.home, signal, event.id, index)),
	);
	const images: Attachment[] = [];
	const limits = model?.inputLimits;
	for (const attachment of attachments) {
		const bytes = attachment.bytes;
		if (
			attachment.kind === "image" &&
			model?.input.includes("image") &&
			images.length < Math.min(limits?.images?.maxPerMessage ?? Infinity, limits?.images?.maxPerRequest ?? Infinity)
		) {
			images.push(attachment);
		} else
			lines.push(
				`attachment: ${label(attachment.name ?? attachment.kind)} (${label(attachment.mime)}${attachment.bytes === undefined ? "" : `, ${Math.ceil((bytes ?? 0) / 1024)} KB`}) ${label(attachment.uri)}`,
			);
	}
	if (wake === "run" && row.version !== options.version) {
		lines.push(
			`notice: yonder harness updated from ${row.version} to ${options.version}; details: yonder changelog --from ${row.version} --to ${options.version}`,
		);
	}
	lines.push("</turn>");
	const preparedEvent = message ? { ...event, data: { ...event.data, attachments } } : event;
	return {
		text: [
			lines.join("\n"),
			event.type === "runtime.continuation"
				? `[Continue the original authorized task now]\n${(event.data as { text?: string }).text ?? ""}`
				: message
					? data.text
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
