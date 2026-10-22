import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { type Static, Type } from "typebox";
import { Errors } from "typebox/value";

const str = Type.String({ minLength: 1 });
const optional = Type.Optional;
const number = (value: number) => optional(Type.Number({ exclusiveMinimum: 0, default: value }));
const object = <T extends Record<string, import("typebox").TSchema>>(fields: T) =>
	Type.Object(fields, { additionalProperties: false });
export const configSchema = object({
	root: str,
	owner: Type.String({ pattern: "^person:.+$" }),
	allowedAgents: optional(Type.Array(str, { default: [] })),
	allowedSourceConversations: optional(Type.Array(str, { default: [] })),
	timezone: str,
	capture: optional(
		object({
			channels: optional(Type.Array(str)),
			attachments: optional(Type.Boolean({ default: true })),
			maxAttachmentBytes: number(26214400),
			inlineMax: number(1000),
		}),
	),
	sources: optional(
		object({
			wechat: optional(
				object({
					cliPath: optional(str),
					chats: optional(Type.Array(object({ chat: str, self: optional(Type.Boolean()) }))),
				}),
			),
		}),
	),
	bootstrap: optional(
		object({
			wechatStaleHours: number(24),
			checkMinutes: number(60),
			cooldownHours: number(24),
			inboxFiles: number(20),
			unorganized: number(100),
			staleDays: number(7),
			model: optional(str),
		}),
	),
	inbox: optional(object({ rescanSeconds: number(60) })),
	converter: optional(object({ command: str, args: optional(Type.Array(Type.String())), timeoutSeconds: number(120) })),
	roots: optional(
		Type.Array(
			object({
				name: str,
				path: str,
				origin: optional(
					Type.Union([Type.Literal("human"), Type.Literal("agent"), Type.Literal("external"), Type.Literal("legacy")]),
				),
			}),
		),
	),
	context: optional(object({ meChars: number(2000) })),
});
export type Config = Static<typeof configSchema>;

export function within(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
// Resolve existing ancestors too: a new root beneath a symlink must not alias a read-only source.
export function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		const parent = dirname(path);
		if (parent === path) throw error;
		return resolve(canonical(parent), relative(parent, path));
	}
}
export function validateConfig(value: unknown): Config {
	const errors = [...Errors(configSchema, value)].map((e) => `${e.instancePath}: ${e.message}`);
	if (errors.length) throw new Error(errors.join("\n"));
	const config = value as Config;
	const paths: Array<[string, string]> = [
		["root", config.root],
		...(config.roots ?? []).map((r, i): [string, string] => [`roots[${i}].path`, r.path]),
	];
	if (config.converter) paths.push(["converter.command", config.converter.command]);
	if (config.sources?.wechat?.cliPath) paths.push(["sources.wechat.cliPath", config.sources.wechat.cliPath]);
	for (const [field, path] of paths) if (!isAbsolute(path)) errors.push(`${field}: must be an absolute path`);
	try {
		new Intl.DateTimeFormat("en", { timeZone: config.timezone });
	} catch {
		errors.push("timezone: invalid IANA timezone");
	}
	if (!errors.length) {
		const root = canonical(config.root);
		for (const [i, source] of (config.roots ?? []).entries()) {
			const path = canonical(source.path);
			if (within(root, path) || within(path, root)) errors.push(`roots[${i}].path: overlaps root`);
		}
	}
	if (errors.length) throw new Error(errors.join("\n"));
	return config;
}
