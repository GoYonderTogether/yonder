import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

export async function expandTemplate(home: string, agent: string | null, text: string): Promise<string> {
	const match = /^\/([^\s/\\]+)(?:\s+([\s\S]*))?$/.exec(text);
	if (!match || match[1] === "." || match[1] === "..") return text;
	const directories = agent ? [join(home, "agents", agent, "prompts"), join(home, "prompts")] : [join(home, "prompts")];
	for (const directory of directories) {
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
				if (content.slice(4, end)) parse(content.slice(4, end));
				content = content.slice(end + 4).trim();
			}
		}
		return substituteArgs(content, parseCommandArgs(match[2] ?? ""));
	}
	return text;
}

function parseCommandArgs(argsString: string): string[] {
	const args: string[] = [];
	let current = "";
	let hasToken = false;
	let inQuote: string | null = null;

	for (let i = 0; i < argsString.length; i++) {
		const char = argsString[i];

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

function substituteArgs(content: string, args: string[]): string {
	const allArgs = args.join(" ");

	return content.replace(
		/\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
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

			if (simple === "ARGUMENTS" || simple === "@") {
				return allArgs;
			}

			const index = parseInt(simple, 10) - 1;
			return args[index] ?? "";
		},
	);
}
