import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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

export const systemTemplate =
	"# 身份\n\n<!-- 我是谁。 -->\n\n# 职责\n\n<!-- 我负责什么。 -->\n\n# 边界\n\n<!-- 我遵守哪些边界。 -->\n";
export const escapeXml = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function framework(session: RuntimeSessionConfig): string {
	return `You run in Yonder Harness. Your agent ID is ${session.agent ?? "none (preset session)"}; your current profile is ${session.profile}.
Your final response is automatically delivered to the source of the input. If no reply is needed, output only NO_REPLY.
Use message_send to contact another person or channel, agent_ask to ask another agent, and task_run to delegate a specialized task. Read available skills with skill_view.
The notice lines inside <turn> are internal information for you; do not announce them unless relevant.${session.resolved.capabilities.includes("exec") ? " Use the yonder command and yonder docs to understand and maintain your runtime environment." : ""}`;
}

export interface PromptOptions {
	home: string;
	version: string;
	contexts: Map<string, ContextContribution>;
	workspace(session: RuntimeSessionConfig): WorkspaceFiles;
	identity: IdentityAPI;
	models: Models;
	setVersion(id: string, version: string): Promise<void>;
	skillIndex?(session: RuntimeSessionConfig): Promise<string>;
}

function renderContext(
	session: RuntimeSessionConfig & { id: string },
	files: WorkspaceFiles,
	event?: YEvent,
): RenderContext {
	return {
		agent: session.agent ?? "",
		profile: session.profile,
		session: session.id,
		workspace: { read: async (path) => ((await files.exists(path)) ? files.readFile(path) : undefined) },
		...(event ? { event } : {}),
	};
}

async function contributions(
	session: RuntimeSessionConfig & { id: string },
	placement: "system" | "turn",
	options: Pick<PromptOptions, "contexts" | "workspace">,
	event?: YEvent,
): Promise<string[]> {
	if (!session.agent) return [];
	const context = renderContext(session, options.workspace(session), event);
	const sections: string[] = [];
	for (const id of session.resolved.contexts) {
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
	if (!(await files.exists("SYSTEM.md"))) await files.writeFile("SYSTEM.md", systemTemplate);
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
	options: Pick<PromptOptions, "contexts" | "workspace" | "skillIndex">,
): Promise<string[]> {
	const sections = [framework(session)];
	if (session.agent) sections.push(await options.workspace(session).readFile("SYSTEM.md"));
	const skills = await options.skillIndex?.(session);
	if (skills) sections.push(skills);
	return [...sections, ...(await contributions(session, "system", options))];
}

async function download(attachment: Attachment, home: string): Promise<Attachment> {
	if (!/^https?:\/\//u.test(attachment.uri)) return attachment;
	const response = await fetch(attachment.uri);
	if (!response.ok) throw new Error(`Attachment download failed: HTTP ${response.status}`);
	const directory = join(home, ".yonder/attachments");
	await mkdir(directory, { recursive: true });
	const path = join(directory, randomUUID());
	const bytes = new Uint8Array(await response.arrayBuffer());
	await writeFile(path, bytes);
	return { ...attachment, uri: pathToFileURL(path).href, bytes: bytes.length };
}

export async function prepareInput(
	row: SessionInfo,
	session: RuntimeSessionConfig,
	event: YEvent,
	wake: "run" | "write",
	options: PromptOptions,
): Promise<RuntimeInput> {
	const data = event.data as MessageInData;
	const lines: string[] = [];
	let environment = "";
	if (wake === "run") {
		const conv = event.conv ? parseRef(event.conv) : undefined;
		environment = `${conv?.kind === "conv" ? ` channel="${escapeXml(conv.channel)}"` : ""}${data.kind ? ` kind="${escapeXml(data.kind)}"` : ""}${event.conv ? ` conv="${escapeXml(event.conv)}"` : ""}`;
	}
	lines.push(`<turn time="${escapeXml(event.ts)}"${environment}>`);
	if (event.from) {
		const ref = parseRef(event.from);
		const account = ref.kind === "acct" ? await options.identity.account(event.from) : undefined;
		const relation =
			session.agent && ref.kind === "acct" ? await options.identity.relation(session.agent, event.from) : undefined;
		lines.push(
			`from: ${data.name ?? account?.name ?? event.from} (${event.from}${relation ? `, ${relation}${account?.person ? `: ${account.person}` : ""}` : ""})`,
		);
	}
	const slash = session.resolved.model.indexOf("/");
	const model = options.models.getModel(
		session.resolved.model.slice(0, slash),
		session.resolved.model.slice(slash + 1),
	);
	const attachments = await Promise.all((data.attachments ?? []).map((item) => download(item, options.home)));
	const images: Attachment[] = [];
	const limits = model?.inputLimits;
	let imageBytes = 0;
	for (const attachment of attachments) {
		const bytes = attachment.bytes ?? 0;
		if (
			attachment.kind === "image" &&
			model?.input.includes("image") &&
			images.length < Math.min(limits?.images?.maxPerMessage ?? Infinity, limits?.images?.maxPerRequest ?? Infinity) &&
			bytes <= (limits?.images?.resize?.maxBytes ?? Infinity) &&
			imageBytes + (bytes * 4) / 3 <= (limits?.maxRequestBytes ?? Infinity)
		) {
			images.push(attachment);
			imageBytes += (bytes * 4) / 3;
		} else
			lines.push(
				`attachment: ${attachment.name ?? attachment.kind} (${attachment.mime}${attachment.bytes === undefined ? "" : `, ${Math.ceil(bytes / 1024)} KB`}) ${attachment.uri}`,
			);
	}
	if (wake === "run" && row.version !== options.version) {
		lines.push(
			`notice: yonder harness updated from ${row.version} to ${options.version}; details: yonder changelog --from ${row.version} --to ${options.version}`,
		);
		await options.setVersion(row.id, options.version);
	}
	lines.push("</turn>");
	const preparedEvent = { ...event, data: { ...data, attachments } };
	return {
		text: [
			lines.join("\n"),
			...(await contributions({ ...session, id: row.id }, "turn", options, preparedEvent)),
			data.text,
		]
			.filter(Boolean)
			.join("\n\n"),
		event: preparedEvent,
		attachments: images,
		wake,
	};
}
