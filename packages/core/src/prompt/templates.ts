import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

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

export async function expandTemplate(
	home: string,
	agent: string | null,
	text: string,
	pluginDirs: Array<string | { directory: string; tools: string[] }> = [],
): Promise<string> {
	const match = /^\/([^\s/\\]+)(?:\s+([\s\S]*))?$/.exec(text);
	if (!match || match[1] === "." || match[1] === "..") return text;
	const directories = agent ? [join(home, "agents", agent, "prompts"), join(home, "prompts")] : [join(home, "prompts")];
	for (const entry of [...directories, ...pluginDirs]) {
		const directory = typeof entry === "string" ? entry : entry.directory;
		let content: string;
		try {
			content = await readFile(join(directory, `${match[1]}.md`), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		content = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
		if (content.startsWith("---")) {
			const end = content.indexOf("\n---", 3);
			if (end !== -1) {
				const metadata = content.slice(4, end) ? parse(content.slice(4, end)) : undefined;
				if (typeof entry !== "string" && metadata?.tool && !entry.tools.includes(metadata.tool)) continue;
				content = content.slice(end + 4).trim();
			}
		}
		const rawArgs = match[2] ?? "";
		return substituteArgs(content, parseCommandArgs(rawArgs), rawArgs);
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
