import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { loadYonderConfig, type YonderConfig } from "../config/index.js";

/**
 * 升级迁移（VC-1）：d0cb1c5 之前建的 home 没有 card-visitor 绑定，访客私聊被路由丢弃（no-binding）。
 * 启用了 card 渠道、而绑定了 card 的 Agent（没有则 main）里没有任何能接住非主人私聊的 card 绑定时补上。
 * 幂等：补过或已有等价绑定就不动；改写前先留 .bak-<日期>-card-visitor。
 */
export type CardVisitorGap = { agent: string; file: string; instances: string[] };

type Doc = { bindings?: Array<Record<string, unknown>>; profiles?: Record<string, unknown> };
const list = (value: unknown): unknown[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

function cardInstances(config: YonderConfig): string[] {
	return Object.entries(config.channels ?? {})
		.filter(([, value]) => (value as { type?: string; enabled?: boolean }).type === "card")
		.filter(([, value]) => (value as { enabled?: boolean }).enabled !== false)
		.map(([id]) => id);
}

function namesCard(binding: Record<string, unknown>, instances: string[]) {
	const match = (binding.match ?? {}) as Record<string, unknown>;
	return list(match.channel).some((channel) => instances.includes(String(channel)));
}

function coversVisitor(binding: Record<string, unknown>, instances: string[]) {
	const match = (binding.match ?? {}) as Record<string, unknown>;
	if (!namesCard(binding, instances)) return false;
	const kinds = list(match.kind);
	if (kinds.length && !kinds.includes("dm")) return false;
	const from = list(match.from);
	return !(from.length === 1 && from[0] === "owner");
}

/** 只读检查：返回仍缺访客绑定的 Agent。 */
export async function cardVisitorGaps(home: string, config: YonderConfig): Promise<CardVisitorGap[]> {
	const instances = cardInstances(config);
	if (!instances.length) return [];
	const gaps: CardVisitorGap[] = [];
	const entries: Array<{ id: string; workspace?: string; archivedAt?: unknown }> = (config.agents ?? []) as never;
	const loaded: Array<{ id: string; file: string; doc: Doc }> = [];
	for (const entry of entries) {
		if (entry.archivedAt) continue;
		const file = join(resolve(home, entry.workspace ?? `./agents/${entry.id}`), "agent.yaml");
		try {
			loaded.push({ id: entry.id, file, doc: (parseDocument(await readFile(file, "utf8")).toJS() ?? {}) as Doc });
		} catch {}
	}
	let targets = loaded.filter((item) => (item.doc.bindings ?? []).some((b) => namesCard(b, instances)));
	if (!targets.length) targets = loaded.filter((item) => item.id === "main");
	for (const { id, file, doc } of targets) {
		const bindings = doc.bindings ?? [];
		// 同 id 但不接访客的绑定属主人手写，不覆盖，留给人处理。
		if (bindings.some((b) => b.id === "card-visitor") || bindings.some((b) => coversVisitor(b, instances))) continue;
		gaps.push({ agent: id, file, instances });
	}
	return gaps;
}

export function cardVisitorWarning(gap: CardVisitorGap, home: string) {
	return `${gap.agent}: 缺少名片访客绑定（card-visitor）——访客私聊会被丢弃，事件里是 routes[0].dropped="no-binding"。修复：运行 yonder doctor --fix（改写 ${gap.file.replace(`${home}/`, "")} 前先写 .bak），然后运行 yonder doctor 复查。`;
}

/** 补绑定；返回已修改的文件与备份。幂等。 */
export async function migrateCardVisitor(
	home: string,
	config?: YonderConfig,
	now = new Date(),
): Promise<Array<{ agent: string; file: string; backup: string }>> {
	const done: Array<{ agent: string; file: string; backup: string }> = [];
	for (const gap of await cardVisitorGaps(home, config ?? (await loadYonderConfig(home)))) {
		const text = await readFile(gap.file, "utf8");
		const doc = parseDocument(text);
		const backup = `${gap.file}.bak-${now.toISOString().slice(0, 10).replaceAll("-", "")}-card-visitor`;
		await copyFile(gap.file, backup);
		if (!doc.has("profiles")) doc.set("profiles", doc.createNode({}));
		if (!doc.hasIn(["profiles", "readonly"]))
			doc.setIn(["profiles", "readonly"], doc.createNode({ level: "readonly" }));
		const binding = doc.createNode({
			id: "card-visitor",
			match: {
				channel: gap.instances.length === 1 ? gap.instances[0] : gap.instances,
				kind: "dm",
				from: ["known", "stranger"],
			},
			session: { mode: "persistent", per: "conv" },
			profile: "readonly",
		});
		const bindings = doc.get("bindings", true) as { items?: Array<{ get?: (k: string) => unknown }> } | undefined;
		if (!bindings?.items) doc.set("bindings", doc.createNode([binding]));
		else {
			const at = bindings.items.findIndex((item) => item.get?.("id") === "card-owner");
			(bindings as unknown as { items: unknown[] }).items.splice(at < 0 ? bindings.items.length : at + 1, 0, binding);
		}
		await writeFile(gap.file, String(doc));
		done.push({ agent: gap.agent, file: gap.file, backup });
	}
	return done;
}
