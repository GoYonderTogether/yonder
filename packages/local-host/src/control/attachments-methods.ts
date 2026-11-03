import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { guardSession } from "@yonder/local-host/control/guard";
import { type MethodDef, MethodError } from "@yonder/local-host/control/method-types";
import { attachmentFromPath } from "@yonder/runtime-adapter/node/runtime/attachments.js";
import Type from "typebox";

export const ATTACHMENT_MAX_BYTES = 6 * 1024 * 1024;
export const AttachmentSchema = Type.Object({
	kind: Type.Union([Type.Literal("image"), Type.Literal("file"), Type.Literal("audio"), Type.Literal("video")]),
	uri: Type.String({ minLength: 1 }),
	mime: Type.Optional(Type.String()),
	name: Type.Optional(Type.String()),
	bytes: Type.Optional(Type.Number({ minimum: 0 })),
});
export const attachmentsMethods: MethodDef[] = [
	{
		name: "attachments.get",
		scope: "owner",
		since: 1,
		params: Type.Object(
			{ session: Type.String({ minLength: 1 }), uri: Type.String({ minLength: 1 }) },
			{ additionalProperties: false },
		),
		async handler(value, ctx) {
			const { session, uri } = value as { session: string; uri: string };
			await guardSession(ctx, session);
			let from = 0,
				attachment: import("@yonder/sdk").Attachment | undefined;
			while (!attachment) {
				const page = await ctx.kernel.sessions.transcript(session, { from, limit: 100 });
				attachment = page.flatMap((item) => item.attachments ?? []).find((item) => item.uri === uri);
				if (!page.length || page.length < 100) break;
				from = page[page.length - 1]!.id + 1;
			}
			if (!attachment || !uri.startsWith("file:"))
				throw new MethodError("not_found", "Attachment is not part of this session");
			const root = await realpath(join(ctx.home, ".yonder", "uploads")),
				path = await realpath(fileURLToPath(uri));
			const rel = relative(root, path);
			if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
				throw new MethodError("forbidden", "Attachment is outside this Runtime's uploads");
			const info = await stat(path);
			if (!info.isFile() || info.size > ATTACHMENT_MAX_BYTES)
				throw new MethodError("invalid_params", "Attachment exceeds 6 MiB or is not a file");
			const bytes = await readFile(path);
			if (bytes.length > ATTACHMENT_MAX_BYTES) throw new MethodError("invalid_params", "Attachment exceeds 6 MiB");
			return { name: attachment.name ?? basename(path), mime: attachment.mime, dataBase64: bytes.toString("base64") };
		},
	},
	{
		name: "attachments.put",
		scope: "write",
		since: 1,
		params: Type.Object(
			{
				name: Type.String({ minLength: 1, maxLength: 255 }),
				mime: Type.Optional(Type.String({ maxLength: 128 })),
				dataBase64: Type.String({ maxLength: 4 * Math.ceil(ATTACHMENT_MAX_BYTES / 3) }),
			},
			{ additionalProperties: false },
		),
		async handler(p, ctx) {
			const { name, mime, dataBase64 } = p as { name: string; mime?: string; dataBase64: string };
			if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dataBase64))
				throw new MethodError("invalid_params", "Invalid attachment encoding");
			if (name.includes("\0") || name === "." || name === "..")
				throw new MethodError("invalid_params", "Invalid attachment filename");
			const bytes = Buffer.from(dataBase64, "base64");
			if (bytes.length > ATTACHMENT_MAX_BYTES) throw new MethodError("invalid_params", "Attachment exceeds 6 MiB");
			const dir = join(ctx.home, ".yonder", "uploads", randomUUID());
			await mkdir(dir, { recursive: true, mode: 0o700 });
			const path = join(dir, basename(name.replaceAll("\\", "/")));
			await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
			const attachment = await attachmentFromPath(path);
			return {
				...attachment,
				...(attachment.kind === "file" && mime && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime) ? { mime } : {}),
			};
		},
	},
];
