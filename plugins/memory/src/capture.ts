import { randomInt } from "node:crypto";
import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { type Static, Type } from "typebox";
import { stringify } from "yaml";
import { heading, moment, monthTemplate, weekInfo, weekTemplate } from "./calendar.js";
import type { Config } from "./config.js";
import { formatRecord, type Source } from "./records.js";
import type { Store, WriteContext } from "./store.js";

export const captureSchema = Type.Object(
	{
		text: Type.String(),
		kind: Type.Optional(Type.Union([Type.Literal("note"), Type.Literal("material")])),
		by: Type.Optional(Type.Union([Type.Literal("owner"), Type.Literal("agent")])),
		title: Type.Optional(Type.String()),
		when: Type.Optional(Type.String()),
		private: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);
export type Capture = Static<typeof captureSchema>;
let last = 0;
const issued = new Set<string>();
function recordId(): string {
	const time = Date.now();
	if (time !== last) {
		last = time;
		issued.clear();
	}
	let id: string;
	do {
		id = `m${time.toString(36)}${randomInt(1296).toString(36).padStart(2, "0")}`;
	} while (issued.has(id));
	issued.add(id);
	return id;
}
export async function capture(
	config: Config,
	store: Store,
	args: Capture,
	ctx: ToolContext,
	emit: PluginAPI["events"]["emit"],
) {
	if (args.kind === "material" && args.private) throw new Error("material and private cannot be used together");
	if (!ctx.agent) throw new Error("memory_capture requires a calling agent for its source reference");
	const date = moment(config.timezone, args.when),
		info = weekInfo(date),
		id = recordId();
	const ref = `(ref: agent:${ctx.agent}${ctx.event ? `; evt:${ctx.event.id}` : ""})`;
	const meta: WriteContext = {
		op: "memory_capture",
		id,
		by: `agent:${ctx.agent}`,
		session: ctx.session,
		signal: ctx.signal,
	};
	const material = args.kind === "material";
	const source: Source = material ? "material" : args.by === "owner" ? "said" : "capture";
	let body = args.text;
	const paths: string[] = [];
	if (material || args.text.length > (config.capture?.inlineMax ?? 1000)) {
		const raw = `raw/${date.toFormat("yyyy-MM")}/${id}.md`;
		await store.ensure(
			raw,
			`---\n${stringify({ origin: source === "said" ? "human-said" : "agent", ...(args.private ? { private: true } : {}), ...(args.title === undefined ? {} : { title: args.title }) })}---\n${args.text}`,
			meta,
		);
		paths.push(raw);
		body = `${args.text.slice(0, 200)} → ${raw}`;
	}
	const path = args.private ? `private/${date.toFormat("yyyy-MM")}.md` : info.path;
	if (!args.private) {
		await store.ensure(`timeline/${info.month}/month.md`, monthTemplate(), meta);
		await store.ensure(`life/${date.year}.md`, "## 年度目标\n## 提议\n", meta);
	}
	await store.append(
		path,
		args.private ? "---\nprivate: true\n---\n## 记录流\n" : weekTemplate(date),
		(old) => {
			if (!/^## 记录流\r?$/m.test(old) || /^## /m.test(old.slice(old.lastIndexOf("## 记录流") + "## 记录流".length)))
				throw new Error("记录流 must be the last section");
			const day = heading(date),
				tail = [...old.matchAll(/^### .*$/gm)].at(-1)?.[0];
			return `${tail === day ? "" : `${day}\n`}${formatRecord(date.toFormat("HH:mm"), source, body, ref, id)}`;
		},
		meta,
	);
	paths.push(path);
	if (material)
		await emit({
			type: "memory.captured",
			from: "plugin:memory",
			conv: "conv:memory-inbox:default",
			data: { path: paths[0], origin: "agent", source: "material" },
		});
	return { id, path, paths };
}
