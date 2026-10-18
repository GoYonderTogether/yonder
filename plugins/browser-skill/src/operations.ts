// Action semantics adapted from Tencent BrowserSkill f9b180b (MIT).
import type { TSchema } from "@yonder/sdk";

export type Args = Record<string, unknown>;
type Field = {
	type: string;
	description?: string;
	enum?: readonly string[];
	minimum?: number;
	maximum?: number;
	items?: Field;
	minItems?: number;
};
const string: Field = { type: "string" };
const integer: Field = { type: "integer", minimum: 0 };
const positive: Field = { type: "integer", minimum: 1 };
const boolean: Field = { type: "boolean" };
const strings: Field = { type: "array", items: string, minItems: 1 };
const choice = (...values: string[]): Field => ({ type: "string", enum: values });
const common = { session: string, tabId: positive };
const wait = { waitUntil: choice("load", "domcontentloaded", "networkidle", "commit"), timeoutMs: positive };
const dimensions = {
	width: { ...integer, minimum: 100, maximum: 7680 },
	height: { ...integer, minimum: 100, maximum: 7680 },
};
const modifiers: Field = { type: "array", items: choice("alt", "ctrl", "meta", "shift") };
const devices = choice(
	"iphone-14",
	"iphone-14-pro-max",
	"iphone-se",
	"pixel-7",
	"galaxy-s23",
	"ipad-mini",
	"galaxy-tab-s8",
);
interface Operation {
	command: string[];
	fields: Record<string, Field>;
	required: string[];
}
const op = (command: string, fields: Record<string, Field> = {}, required: string[] = []): Operation => ({
	command: command.split(" "),
	fields,
	required,
});
export const operations = {
	setup: {
		status: op("status"),
		"start-daemon": op("daemon start"),
		guide: op("", { browser: choice("chrome", "edge"), openInstallPage: boolean }),
	},
	session: {
		start: op("session start", { browser: string, ...dimensions, noFocus: boolean }),
		stop: op("session request", { session: string, requestId: string }),
		list: op(""),
	},
	page: {
		navigate: op("navigate", { ...common, ...wait, url: string }, ["url"]),
		back: op("navigate-back", { ...common, ...wait }),
		forward: op("navigate-forward", { ...common, ...wait }),
		reload: op("reload", { ...common, ...wait, hard: boolean }),
		wait: op("wait-for-navigation", { ...common, ...wait }),
		"wait-for-element": op(
			"wait-for-element",
			{
				...common,
				target: string,
				state: choice("visible", "hidden", "attached", "detached"),
				timeoutMs: { ...positive, maximum: 300000 },
				pollMs: { ...integer, minimum: 16, maximum: 2000 },
			},
			["target"],
		),
	},
	inspect: {
		observe: op("observe", { ...common, cursor: string, maxDepth: positive, maxTokens: positive }),
		snapshot: op("snapshot", { ...common, maxDepth: positive, maxTokens: positive }),
		html: op("get-html", { ...common, ref: string, maxBytes: positive }),
		screenshot: op("screenshot", {
			...common,
			ref: string,
			fullPage: boolean,
			scope: choice("follow", "current"),
			timeoutMs: positive,
		}),
		console: op("console", {
			...common,
			since: integer,
			limit: positive,
			maxTextChars: positive,
			includeStack: boolean,
		}),
		network: op("network", { ...common, since: integer, limit: positive, maxTextChars: positive }),
	},
	interact: {
		click: op(
			"click",
			{
				...common,
				target: string,
				button: choice("left", "middle", "right"),
				clickCount: positive,
				captureId: string,
				imageX: { type: "number", minimum: 0 },
				imageY: { type: "number", minimum: 0 },
				modifiers,
			},
			["target"],
		),
		fill: op("fill", { ...common, target: string, value: string, noClear: boolean }, ["target", "value"]),
		select: op("select", { ...common, target: string, values: strings, timeoutMs: positive }, ["target", "values"]),
		press: op("press", { ...common, key: string, target: string, holdMs: integer }, ["key"]),
		hover: op("hover", { ...common, target: string, modifiers, settleMs: positive, timeoutMs: positive }, ["target"]),
		wheel: op("wheel", {
			...common,
			target: string,
			deltaX: { type: "number" },
			deltaY: { type: "number" },
			modifiers,
			timeoutMs: positive,
		}),
		"scroll-to": op("scroll-to", { ...common, target: string, timeoutMs: positive }, ["target"]),
		focus: op("focus", { ...common, target: string, timeoutMs: positive }, ["target"]),
		blur: op("blur", { ...common, target: string, timeoutMs: positive }, ["target"]),
		resize: op("window resize", { session: string, ...dimensions }, ["width", "height"]),
		emulate: op("emulate", { ...common, device: devices, ...dimensions, mobile: boolean, off: boolean }),
		"request-help": op(
			"request-help",
			{ ...common, prompt: string, title: string, targets: strings, timeoutMs: positive },
			["prompt"],
		),
	},
	tabs: {
		list: op("tab list", { session: string, scope: choice("user", "agent", "all") }),
		create: op("tab create", { session: string, url: string, active: boolean, index: integer }),
		select: op("tab select", common, ["tabId"]),
		close: op("tab close", common, ["tabId"]),
		borrow: op("tab borrow", { ...common, timeoutMs: positive }, ["tabId"]),
		return: op("tab return", common, ["tabId"]),
	},
	file: {
		upload: op(
			"upload",
			{ ...common, target: string, files: strings, mode: choice("input", "drop"), timeoutMs: positive },
			["target", "files"],
		),
		download: op("download", { ...common, target: string, out: string, overwrite: boolean, timeoutMs: positive }, [
			"target",
			"out",
		]),
	},
} satisfies Record<string, Record<string, Operation>>;
export type Group = keyof typeof operations;

export function parameters(group: Group): TSchema {
	return {
		type: "object",
		properties: {
			...Object.assign({}, ...Object.values(operations[group]).map((spec) => spec.fields)),
			action: { type: "string", enum: Object.keys(operations[group]) },
		},
		required: ["action"],
		additionalProperties: false,
		anyOf: Object.entries(operations[group]).map(([action, spec]) => ({
			type: "object",
			additionalProperties: false,
			properties: { action: { type: "string", const: action }, ...spec.fields },
			required: ["action", ...spec.required],
		})),
	} as TSchema;
}

export function validate(group: Group, value: unknown): Args {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an action object");
	const args = value as Args;
	const spec = (operations[group] as Record<string, Operation>)[String(args.action)];
	if (!spec) throw new Error(`Unsupported ${group} action`);
	for (const key of spec.required) if (args[key] === undefined) throw new Error(`${key} is required`);
	for (const [key, val] of Object.entries(args)) {
		if (key === "action") continue;
		const field = spec.fields[key];
		if (!field) throw new Error(`Unexpected ${key} for ${group}.${String(args.action)}`);
		validateField(field, val, key);
	}
	if ((args.width === undefined) !== (args.height === undefined))
		throw new Error("width and height must be given together");
	if (args.session !== undefined && args.requestId !== undefined)
		throw new Error("Specify session or requestId, not both");
	if (args.action === "wheel" && !(args.deltaX || args.deltaY))
		throw new Error("At least one wheel delta must be nonzero");
	if (
		[args.captureId, args.imageX, args.imageY].some((v) => v !== undefined) &&
		[args.captureId, args.imageX, args.imageY].some((v) => v === undefined)
	)
		throw new Error("Canvas click requires captureId, imageX and imageY");
	if (args.ref !== undefined && !/^@?e\d+$/.test(String(args.ref)))
		throw new Error("ref must be a fresh snapshot ref such as @e3");
	if (args.ref && args.fullPage) throw new Error("ref and fullPage are mutually exclusive");
	if (
		group === "inspect" &&
		args.action === "screenshot" &&
		!args.fullPage &&
		(args.scope !== undefined || args.timeoutMs !== undefined)
	)
		throw new Error("scope/timeoutMs require fullPage");
	if (args.action === "emulate") {
		if (args.off === true && [args.device, args.width, args.height, args.mobile].some((v) => v !== undefined))
			throw new Error("off must be used alone");
		if (!args.off && !args.device && args.width === undefined) throw new Error("Pass device or width+height, or off");
		if (args.mobile !== undefined && args.width === undefined) throw new Error("mobile requires width+height");
	}
	return args;
}
function validateField(field: Field, value: unknown, key: string): void {
	if (field.type === "array") {
		if (!Array.isArray(value) || value.length < (field.minItems ?? 0))
			throw new Error(`${key} must be an array with enough values`);
		for (const item of value) validateField(field.items ?? string, item, key);
	} else if (field.type === "integer" || field.type === "number") {
		if (
			typeof value !== "number" ||
			!Number.isFinite(value) ||
			(field.type === "integer" && !Number.isSafeInteger(value)) ||
			(field.minimum !== undefined && value < field.minimum) ||
			(field.maximum !== undefined && value > field.maximum)
		)
			throw new Error(`Invalid numeric ${key}`);
	} else if (typeof value !== field.type || (field.type === "string" && key !== "value" && !String(value).trim()))
		throw new Error(`Invalid ${key}`);
	if (field.enum && !field.enum.includes(String(value))) throw new Error(`Invalid ${key}`);
}
const flags: Record<string, string> = {
	waitUntil: "wait-until",
	timeoutMs: "timeout",
	pollMs: "poll-ms",
	maxDepth: "max-depth",
	maxTokens: "max-tokens",
	maxBytes: "max-bytes",
	maxTextChars: "max-text-chars",
	clickCount: "click-count",
	captureId: "capture",
	imageX: "image-x",
	imageY: "image-y",
	holdMs: "hold-ms",
	settleMs: "settle",
	deltaX: "delta-x",
	deltaY: "delta-y",
};
const boolFlags: Record<string, string> = {
	hard: "hard",
	noClear: "no-clear",
	includeStack: "include-stack",
	fullPage: "full-page",
	mobile: "mobile",
	off: "off",
	overwrite: "overwrite",
};

/** Builds only known business commands. Targets use explicit flags, never option-like positionals. */
export function command(group: Group, args: Args, session: string): string[] {
	const spec = (operations[group] as Record<string, Operation>)[String(args.action)];
	if (!spec || ["setup", "session"].includes(group)) throw new Error("Not a browser business command");
	const argv = [...spec.command, "--session", session];
	const tabPositional = group === "tabs" && ["select", "close", "borrow", "return"].includes(String(args.action));
	if (args.tabId !== undefined) argv.push(...(tabPositional ? [String(args.tabId)] : ["--tab-id", String(args.tabId)]));
	for (const [key, value] of Object.entries(args)) {
		if (["action", "session", "tabId", "target", "url", "key", "files", "values", "targets", "active"].includes(key))
			continue;
		if (key in boolFlags) {
			if (value === true) argv.push(`--${boolFlags[key]}`);
			continue;
		}
		const flag = flags[key] ?? key;
		const text = ["timeoutMs", "settleMs"].includes(key)
			? `${value}ms`
			: Array.isArray(value)
				? value.join(",")
				: String(value);
		argv.push(`--${flag}=${text}`);
	}
	if (args.target !== undefined)
		argv.push(`--${/^@?e\d+$/.test(String(args.target)) ? "ref" : "selector"}=${String(args.target)}`);
	for (const [key, flag] of [
		["files", "file"],
		["values", "value"],
		["targets", "target"],
	]) {
		for (const value of (args[key ?? ""] as string[] | undefined) ?? []) argv.push(`--${flag}=${value}`);
	}
	if (group === "tabs" && args.active === false) argv.push("--no-active");
	if (args.url !== undefined) {
		if (group === "tabs") argv.push(`--url=${String(args.url)}`);
		else argv.push("--", String(args.url));
	}
	if (args.key !== undefined) argv.push("--", String(args.key));
	return argv;
}
