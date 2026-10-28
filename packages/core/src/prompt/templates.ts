import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { loadSubagentDefinitions } from "../config/subagent-definitions.js";

export function pluginTemplateDirs(
	plugins: Array<{ id: string; directory: string }>,
	tools: Array<{ name: string; plugin?: string; exposure: string }>,
): Array<{ directory: string; tools: string[] }> {
	return plugins.flatMap((plugin) => {
		const selected = tools.filter(
			(tool) => tool.plugin === plugin.id && (tool.exposure === "offer" || tool.exposure === "search"),
		);
		return selected.length
			? [{ directory: join(plugin.directory, "prompts"), tools: selected.map((tool) => tool.name) }]
			: [];
	});
}

type TemplateDir = string | { directory: string; tools: string[] };

async function templateDirs(
	home: string,
	agent: string | null,
	profile: string,
	plugins: TemplateDir[],
): Promise<TemplateDir[]> {
	const safe = (value: string) =>
		value && value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\");
	return [
		...(agent && safe(agent) ? [join(home, "agents", agent, "prompts")] : []),
		...(!agent && safe(profile) && (await loadSubagentDefinitions(home)).has(profile)
			? [join(home, "agents", profile, "prompts")]
			: []),
		...(!agent && safe(profile) ? [join(home, "presets", profile, "prompts")] : []),
		join(home, "prompts"),
		...plugins,
	];
}

async function readTemplate(
	entry: TemplateDir,
	name: string,
): Promise<{ text: string; description: string } | undefined> {
	const directory = typeof entry === "string" ? entry : entry.directory;
	let content: string;
	try {
		content = await readFile(join(directory, `${name}.md`), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	content = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
	let description = "";
	if (content.startsWith("---")) {
		const end = content.indexOf("\n---", 3);
		if (end !== -1) {
			const metadata = content.slice(4, end) ? parse(content.slice(4, end)) : undefined;
			if (typeof entry !== "string" && metadata?.tool && !entry.tools.includes(metadata.tool)) return undefined;
			if (typeof metadata?.description === "string") description = metadata.description;
			content = content.slice(end + 4).trim();
		}
	}
	return { text: content, description };
}

export async function listTemplates(
	home: string,
	agent: string | null,
	profile: string,
	pluginDirs: TemplateDir[] = [],
): Promise<Array<{ name: string; description: string }>> {
	const result = new Map<string, { name: string; description: string }>();
	for (const entry of await templateDirs(home, agent, profile, pluginDirs)) {
		let names: string[];
		try {
			names = await readdir(typeof entry === "string" ? entry : entry.directory);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		for (const file of names.sort()) {
			if (!file.endsWith(".md")) continue;
			const name = file.slice(0, -3);
			if (result.has(name)) continue;
			const template = await readTemplate(entry, name);
			if (template) result.set(name, { name, description: template.description });
		}
	}
	return [...result.values()];
}

export async function expandTemplate(
	home: string,
	agent: string | null,
	text: string,
	pluginDirs: TemplateDir[] = [],
	profile = "",
): Promise<string> {
	const match = /^\/([^\s/\\]+)(?:\s+([\s\S]*))?$/.exec(text);
	if (!match || match[1] === "." || match[1] === "..") return text;
	for (const entry of await templateDirs(home, agent, profile, pluginDirs)) {
		const template = await readTemplate(entry, match[1] as string);
		if (!template) continue;
		const rawArgs = match[2] ?? "";
		return substituteArgs(template.text, parseCommandArgs(rawArgs), rawArgs);
	}
	return text;
}

function parseCommandArgs(argsString: string): string[] {
	const args: string[] = [];
	let current = "";
	let hasToken = false;
	let inQuote: string | null = null;

	for (let i = 0; i < argsString.length; i++) {
		const char = argsString.charAt(i);

		if (inQuote) {
			if (char === inQuote) {
				inQuote = null;
			} else {
				current += char;
			}
		} else if (char === '"' || char === "'") {
			inQuote = char;
			hasToken = true;
		} else if (/\s/.test(char)) {
			if (hasToken) {
				args.push(current);
				current = "";
				hasToken = false;
			}
		} else {
			current += char;
			hasToken = true;
		}
	}

	if (hasToken) {
		args.push(current);
	}

	return args;
}

function substituteArgs(content: string, args: string[], rawArgs: string): string {
	const allArgs = args.join(" ");

	return content.replace(
		/\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(RAW_ARGUMENTS|ARGUMENTS|@|\d+)/g,
		(_match, defaultTarget, defaultValue, sliceStart, sliceLength, simple) => {
			if (defaultTarget) {
				const value =
					defaultTarget === "@" || defaultTarget === "ARGUMENTS" ? allArgs : args[parseInt(defaultTarget, 10) - 1];
				return value ? value : defaultValue;
			}

			if (sliceStart) {
				let start = parseInt(sliceStart, 10) - 1;
				if (start < 0) start = 0;

				if (sliceLength) {
					const length = parseInt(sliceLength, 10);
					return args.slice(start, start + length).join(" ");
				}
				return args.slice(start).join(" ");
			}

			if (simple === "RAW_ARGUMENTS") return rawArgs;
			if (simple === "ARGUMENTS" || simple === "@") {
				return allArgs;
			}

			const index = parseInt(simple, 10) - 1;
			return args[index] ?? "";
		},
	);
}
