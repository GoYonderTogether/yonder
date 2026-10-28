import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppInventory } from "@yonder/protocol";

/** Installed launchers, never inferred from running processes or accessibility nodes. */
export async function linuxApps(deviceId: string, targetId: string): Promise<AppInventory> {
	const roots = [
		process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"),
		...(process.env.XDG_DATA_DIRS ?? "/usr/local/share:/usr/share").split(":"),
	];
	const seen = new Set<string>();
	const items: AppInventory["items"] = [];
	let complete = true;
	async function scan(root: string, relative = "") {
		let entries: Dirent[];
		try {
			entries = await readdir(join(root, relative), { withFileTypes: true });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") complete = false;
			return;
		}
		for (const entry of entries) {
			const path = join(relative, entry.name);
			if (entry.isDirectory()) {
				await scan(root, path);
				continue;
			}
			if (!entry.name.endsWith(".desktop")) continue;
			const id = path.replaceAll("/", "-");
			if (seen.has(id)) continue;
			seen.add(id); // A higher-precedence Hidden=true entry masks the system entry.
			try {
				const text = await readFile(join(root, path), "utf8");
				const fields = desktopEntry(text);
				if (
					fields.Type !== "Application" ||
					fields.Hidden === "true" ||
					!fields.Name ||
					(!fields.Exec && fields.DBusActivatable !== "true")
				)
					continue;
				if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,254}\.desktop$/.test(id)) continue;
				if (fields.TryExec && !(await executableExists(fields.TryExec))) continue;
				items.push({ id, name: fields.Name.slice(0, 4096) });
			} catch {
				complete = false;
			}
		}
	}
	for (const root of roots)
		if (root.startsWith("/")) await scan(join(root, "applications"));
		else complete = false;
	return {
		deviceId,
		targetId,
		observedAt: new Date().toISOString(),
		status: "available",
		complete,
		items: items.sort((a, b) => a.id.localeCompare(b.id)),
	};
}

export function desktopEntry(text: string): Record<string, string> {
	const fields: Record<string, string> = Object.create(null);
	let active = false;
	for (const line of text.split(/\r?\n/)) {
		if (line.startsWith("[")) {
			active = line === "[Desktop Entry]";
			continue;
		}
		if (!active || line.startsWith("#")) continue;
		const match = /^([A-Za-z]+)=(.*)$/.exec(line);
		if (match)
			fields[match[1] as string] = (match[2] as string).replace(
				/\\([sntr\\])/g,
				(_, c: string) => ({ s: " ", n: "\n", t: "\t", r: "\r", "\\": "\\" })[c] ?? c,
			);
	}
	return fields;
}

export async function executableExists(name: string): Promise<boolean> {
	const { access, constants } = await import("node:fs/promises");
	const candidates = name.startsWith("/")
		? [name]
		: name.includes("/")
			? []
			: (process.env.PATH ?? "")
					.split(":")
					.filter((p) => p.startsWith("/"))
					.map((p) => join(p, name));
	for (const candidate of candidates) {
		try {
			await access(candidate, constants.X_OK);
			return true;
		} catch {}
	}
	return false;
}
