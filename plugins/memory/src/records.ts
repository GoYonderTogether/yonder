export const sourceOrigins = {
	chat: "human-said",
	said: "human-said",
	capture: "agent",
	material: "agent",
	inbox: "external",
	"wechat-self": "human-written",
	wechat: "external",
} as const;
export type Source = keyof typeof sourceOrigins;
export type Origin = (typeof sourceOrigins)[Source] | "derived" | "legacy";
export interface RecordEntry {
	start: number;
	end: number;
	source: Source;
	id: string;
	done: boolean;
	text: string;
	date?: string;
	time: string;
}
export function records(text: string, startDate?: string): RecordEntry[] {
	const lines = text.split("\n"),
		result: RecordEntry[] = [];
	let day: string | undefined;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "",
			h = /^### (\d{2}-\d{2}) 周[一二三四五六日]\r?$/.exec(line);
		if (h)
			day =
				startDate === undefined
					? undefined
					: `${Number(startDate.slice(0, 4)) + (h[1]! < startDate.slice(5) ? 1 : 0)}-${h[1]}`;
		const match = /^- \[([ x])\] (\d{2}:\d{2}) \{([^}]+)\} /.exec(line);
		if (!match || !Object.hasOwn(sourceOrigins, match[3]!)) continue;
		let end = i + 1;
		while (end < lines.length && lines[end]?.startsWith("  ")) end++;
		const block = lines.slice(i, end).join("\n"),
			id = /\(ref: [^\r\n]*\) \^(m[a-z0-9]+)(?: → [^\r\n]*)?$/.exec(block)?.[1];
		if (id)
			result.push({
				start: i,
				end,
				source: match[3] as Source,
				id,
				done: match[1] === "x",
				text: block,
				time: match[2]!,
				...(day ? { date: day } : {}),
			});
		i = end - 1;
	}
	return result;
}
export function formatRecord(time: string, source: Source, body: string, ref: string, id: string): string {
	// The ref/id suffix is appended to the final physical line, preserving body newlines and empty lines.
	return `- [ ] ${time} {${source}} ${body.replace(/\n/g, "\n  ")} ${ref} ^${id}\n`;
}
export function organizeText(text: string, id: string, to: string): string {
	const entry = records(text).find((e) => e.id === id);
	if (!entry) throw new Error(`Record not found: ${id}`);
	if (entry.done) return text;
	const lines = text.split("\n");
	lines[entry.start] = lines[entry.start]!.replace("- [ ]", "- [x]");
	lines[entry.end - 1] += ` → ${to}`;
	return lines.join("\n");
}
export function writeSection(text: string, name: string, body: string, mode: "append" | "replace"): string {
	const lines = text.split("\n"),
		start = lines.findIndex((l) => l.replace(/\r$/, "") === `## ${name}`);
	if (start < 0) throw new Error(`Section not found: ${name}`);
	let end = start + 1;
	while (end < lines.length && !/^## /.test(lines[end]!)) end++;
	const old = lines.slice(start + 1, end).join("\n");
	const content = mode === "replace" ? body : `${old}${old && !old.endsWith("\n") ? "\n" : ""}${body}`;
	const suffix = lines.slice(end).join("\n");
	return `${lines.slice(0, start + 1).join("\n")}\n${content}${content.endsWith("\n") ? "" : "\n"}${suffix}`;
}
