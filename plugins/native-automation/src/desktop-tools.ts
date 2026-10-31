import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PermissionRequest, PermissionResponse, PluginAPI, ToolContext, ToolResult } from "@yonder/sdk";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { type Automation, check, requireField, result } from "./common.js";
import { desktop } from "./desktop.js";
import { shrinkForModel } from "./image-size.js";
import { requireOwnerOrigin } from "./permission-origin.js";

export const desktopSchema = Type.Object(
	{
		action: Type.Union(
			[
				"status",
				"permissions",
				"permission-request",
				"permission-guide",
				"permission-watch",
				"location-status",
				"location-request",
				"location-collect",
				"file-list",
				"file-export",
				"snapshot",
				"screenshot",
				"move",
				"click",
				"drag",
				"type",
				"key",
			].map((x) => Type.Literal(x)),
		),
		path: Type.Optional(Type.String({ description: "Absolute source file/directory path for file-list/file-export" })),
		kind: Type.Optional(
			Type.Union(
				[
					"accessibility",
					"screen-recording",
					"input-monitoring",
					"camera",
					"microphone",
					"notifications",
					"automation",
					"full-disk-access",
					"files-and-folders",
					"location",
				].map((x) => Type.Literal(x)),
			),
		),
		timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 600 })),
		x: Type.Optional(Type.Integer()),
		y: Type.Optional(Type.Integer()),
		toX: Type.Optional(Type.Integer()),
		toY: Type.Optional(Type.Integer()),
		button: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("right")])),
		text: Type.Optional(Type.String({ maxLength: 10000 })),
		keyCode: Type.Optional(Type.Integer({ minimum: 0, maximum: 127 })),
		modifiers: Type.Optional(
			Type.Array(Type.Union(["command down", "control down", "option down", "shift down"].map((x) => Type.Literal(x)))),
		),
	},
	{ additionalProperties: false },
);

export const permissionKinds = [
	"accessibility",
	"screen-recording",
	"input-monitoring",
	"camera",
	"microphone",
	"notifications",
	"automation",
	"full-disk-access",
	"files-and-folders",
	"location",
];

export function permissionRunner(api: PluginAPI, state: Automation) {
	return async function permissionRun(request: PermissionRequest, ctx: ToolContext): Promise<PermissionResponse> {
		check(state, ctx, ["exec", "read", "write", "message"]);
		if (
			request.provider !== "native-automation" ||
			!permissionKinds.includes(request.kind) ||
			!["status", "request", "guide", "watch"].includes(request.action)
		)
			throw new Error("Invalid native permission request");
		if (
			request.timeout !== undefined &&
			(!["guide", "watch"].includes(request.action) ||
				!Number.isFinite(request.timeout) ||
				request.timeout <= 0 ||
				request.timeout > 600)
		)
			throw new Error("timeout is only supported for permission-guide/permission-watch (0 < seconds <= 600)");
		if (request.kind === "location" && !["status", "request"].includes(request.action))
			throw new Error("Location supports status/request only in the permission provider; collect uses desktop RPC");
		if (request.action !== "status") {
			await requireOwnerOrigin(api, ctx);
			check(state, ctx, ["exec", "read", "write", "message"]);
		}
		if (process.platform !== "darwin")
			return {
				platform: process.platform,
				result: {
					state: "unsupported",
					reason: `No native permission driver for ${process.platform}; this provider implements macOS Yonder Helper only.`,
				},
			};
		const output = await desktop(
			{
				action:
					request.kind === "location"
						? `location-${request.action}`
						: request.action === "status"
							? "permissions"
							: `permission-${request.action}`,
				...(request.kind !== "location" && request.action !== "status" ? { kind: request.kind } : {}),
				...(request.timeout !== undefined ? { timeout: request.timeout } : {}),
			},
			ctx.signal,
			ctx.session,
		);
		ctx.signal.throwIfAborted();
		return { platform: process.platform, result: output };
	};
}

export function desktopRunner(api: PluginAPI, state: Automation) {
	const permissionRun = permissionRunner(api, state);
	return async function desktopRun(input: unknown, ctx: ToolContext): Promise<ToolResult> {
		try {
			check(state, ctx, ["exec", "read", "write", "message"]);
			if (!Value.Check(desktopSchema, input)) throw new Error("Invalid native-automation_desktop arguments");
			const args = input as Record<string, unknown>;
			if (["location-status", "location-request", "location-collect"].includes(String(args.action))) {
				if (
					Object.keys(args).some((key) => !["action", "timeout"].includes(key)) ||
					(args.timeout !== undefined &&
						(typeof args.timeout !== "number" ||
							!Number.isFinite(args.timeout) ||
							args.timeout <= 0 ||
							args.timeout > 60))
				)
					throw new Error("Location accepts action and optional 0 < timeout <= 60 seconds only");
				if (args.action === "location-request") await requireOwnerOrigin(api, ctx);
				check(state, ctx, ["exec", "read", "write", "message"]);
				const output = await desktop(args, ctx.signal, ctx.session);
				ctx.signal.throwIfAborted();
				return {
					...result({ source: "Yonder Helper CoreLocation", result: output }),
					...((output as { ok?: boolean })?.ok === false ? { isError: true } : {}),
				};
			}
			if (
				["status", "permissions", "permission-request", "permission-guide", "permission-watch"].includes(
					String(args.action),
				)
			) {
				if (!["status", "permissions"].includes(String(args.action))) requireField(args.kind, "kind");
				const action = ["status", "permissions"].includes(String(args.action))
					? "status"
					: String(args.action).slice("permission-".length);
				const response = await permissionRun(
					{
						provider: "native-automation",
						action,
						kind: args.kind ?? "accessibility",
						...(args.timeout !== undefined ? { timeout: args.timeout } : {}),
					} as PermissionRequest,
					ctx,
				);
				return result({ source: "Yonder Helper CoreGraphics/AX", result: response.result });
			}

			if (["file-list", "file-export"].includes(String(args.action))) {
				if (
					typeof args.path !== "string" ||
					!isAbsolute(args.path) ||
					args.path.includes("\0") ||
					args.path.split(/[\\/]/).includes("..")
				)
					throw new Error("Expected absolute path without NUL or ..");
				await requireOwnerOrigin(api, ctx);
				check(state, ctx, ["exec", "read", "write", "message"]);
				if (args.action === "file-list")
					return result({ source: "Yonder Helper file host", result: await desktop(args, ctx.signal, ctx.session) });
				await mkdir(state.artifacts, { recursive: true, mode: 0o700 });
				const directory = await mkdtemp(join(state.artifacts, "file-"));
				const path = join(directory, "export");
				try {
					ctx.signal.throwIfAborted();
					const exported = (await desktop(
						{ action: "file-export", path: args.path, destination: path },
						ctx.signal,
						ctx.session,
					)) as { path: string; size: number; metadata: unknown };
					ctx.signal.throwIfAborted();
					if (exported.path !== path || (await stat(path)).size !== exported.size)
						throw new Error("Invalid Helper artifact path or size");
					return {
						text: JSON.stringify({ source: "Yonder Helper file host", ...exported }),
						attachments: [
							{
								kind: "file",
								mime: "application/octet-stream",
								uri: pathToFileURL(path).href,
								name: basename(args.path),
								bytes: exported.size,
							},
						],
					};
				} catch (error) {
					await rm(directory, { recursive: true, force: true });
					throw error;
				}
			}

			if (["move", "click", "drag"].includes(String(args.action))) {
				requireField(args.x, "x");
				requireField(args.y, "y");
			}
			if (args.action === "drag") {
				requireField(args.toX, "toX");
				requireField(args.toY, "toY");
			}
			if (args.action === "type") requireField(args.text, "text");
			if (args.action === "key") requireField(args.keyCode, "keyCode");
			if (args.action === "screenshot") {
				await mkdir(state.artifacts, { recursive: true });
				const path = join(state.artifacts, `${randomUUID()}.png`);
				await desktop({ action: "screenshot", path }, ctx.signal, ctx.session);
				if ((await stat(path)).size > 20 * 1024 * 1024) throw new Error("Desktop image exceeds 20MB");
				// Retina 全屏截图常有 6–8 MB；先在插件侧缩到 1600 长边，原图仍留在 artifact 目录。
				const shrunk = await shrinkForModel(path);
				return {
					text: JSON.stringify({
						source: "Yonder Helper CoreGraphics (main display)",
						path: shrunk.path,
						bytes: shrunk.bytes.byteLength,
						mime: shrunk.mime,
						originalPath: shrunk.path === path ? undefined : path,
						originalBytes: shrunk.original,
					}),
					images: [{ mime: shrunk.mime, data: shrunk.bytes.toString("base64") }],
				};
			}
			return result({
				source: "Yonder Helper CoreGraphics/AX",
				result: await desktop(args, ctx.signal, ctx.session),
			});
		} catch (error) {
			return {
				...result({
					error: String(error).slice(0, 10000),
					hint: "Use desktop permissions for Yonder Helper identity, state and exact owner commands. No automatic permission request or frontmost app activation. Permission actions require a direct owner-origin run and an explicit action; OS approval is still human.",
				}),
				isError: true,
			};
		}
	};
}
