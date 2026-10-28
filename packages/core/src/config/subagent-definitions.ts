import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Preset } from "@yonder/sdk";
import { parse } from "yaml";

/** Pi-style Markdown definitions use their body as the child instructions. */
export async function loadSubagentDefinitions(home: string): Promise<Map<string, Preset>> {
	const result = new Map<string, Preset>();
	async function visit(directory: string, root = false): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
		if (!root && entries.some((entry) => entry.isFile() && entry.name === "agent.yaml")) return;
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			const file = join(directory, entry.name);
			if (entry.isDirectory()) {
				await visit(file);
			} else if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.endsWith(".chain.md")) {
				const text = await readFile(file, "utf8");
				const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
				if (!match) continue;
				const frontmatter: unknown = parse(match[1] ?? "");
				if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) continue;
				const value = frontmatter as Record<string, unknown>;
				if (
					typeof value.name !== "string" ||
					!value.name.trim() ||
					typeof value.description !== "string" ||
					!value.description.trim()
				)
					continue;
				if (value.model !== undefined && typeof value.model !== "string") throw new Error(`${file}: invalid model`);
				const tools =
					typeof value.tools === "string"
						? value.tools
								.split(",")
								.map((tool) => tool.trim())
								.filter(Boolean)
						: value.tools;
				if (tools !== undefined && (!Array.isArray(tools) || tools.some((tool) => typeof tool !== "string")))
					throw new Error(`${file}: invalid tools`);
				result.set(value.name, {
					id: value.name,
					description: value.description,
					...(value.model !== undefined ? { model: value.model as string } : {}),
					...(tools !== undefined ? { tools: { offer: tools as string[] } } : {}),
					instructions: text.slice(match[0].length).trim(),
				});
			}
		}
	}
	await visit(join(home, "agents"), true);
	return result;
}
