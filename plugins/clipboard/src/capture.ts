#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { fail } from "./config.js";
import { readHiddenCredential } from "./hidden-input.js";
import { idCheck, Store, safeRead, type Ticket, writeNew } from "./store.js";

/** Trusted capture port, never a model tool or plaintext argv/stdin endpoint. */
export async function capture(data: string, id: string, read: () => Promise<string> = readHiddenCredential) {
	idCheck(id);
	const store = new Store(data, { maxBytes: 65536, ttlSeconds: 86400 });
	await store.ensure();
	const file = store.path(id, "tickets"),
		ticket = JSON.parse((await safeRead(file, 16384)).toString()) as Ticket;
	if (
		ticket.id !== id ||
		!Number.isFinite(Date.parse(ticket.expiresAt)) ||
		Date.parse(ticket.expiresAt) <= Date.now() ||
		!Number.isSafeInteger(ticket.maxBytes) ||
		ticket.maxBytes < 1 ||
		ticket.maxBytes > 65536
	)
		fail("capture_ticket_expired_or_invalid");
	// O_EXCL claim: a failed/cancelled capture cannot be replayed with this ticket.
	await writeNew(`${file}.claimed`, "");
	await store.journal(ticket, "capture", "intent", id);
	let bytes: Buffer | undefined;
	try {
		let text = await read();
		bytes = Buffer.from(text);
		text = "";
		if (!bytes.length || bytes.length > ticket.maxBytes) fail("capture_too_large_or_empty");
		const remaining = Math.floor((Date.parse(ticket.expiresAt) - Date.now()) / 1000);
		if (remaining < 1) fail("capture_ticket_expired");
		const clip = await store.save(
			bytes,
			"sealed",
			ticket,
			{ type: "tty", ref: id },
			AbortSignal.timeout(60000),
			remaining,
			id,
		);
		await store.journal(ticket, "capture", "completed", id);
		return clip;
	} catch (error) {
		await store.journal(ticket, "capture", "failed", id);
		throw error;
	} finally {
		bytes?.fill(0);
		await rm(file, { force: true });
	}
}
async function main() {
	const [action, ...args] = process.argv.slice(2);
	const allowed = action === "prepare" ? ["--data"] : action === "capture" ? ["--data", "--ticket"] : [];
	if (!allowed.length || args.length !== allowed.length * 2 || allowed.some((key, i) => args[i * 2] !== key))
		fail("usage_prepare_or_capture");
	const data = args[1]!;
	if (!isAbsolute(data)) fail("absolute_data_path_required");
	if (action === "prepare") {
		const store = new Store(data, { maxBytes: 65536, ttlSeconds: 86400 });
		const operator = { agent: null, profile: "operator", session: "local" };
		await store.journal(operator, "prepare", "intent");
		try {
			await store.kernel.prepare(AbortSignal.timeout(60000));
			await store.journal(operator, "prepare", "completed");
		} catch (error) {
			await store.journal(operator, "prepare", "failed");
			throw error;
		}
		process.stdout.write('{"prepared":true}\n');
	} else {
		const result = await capture(data, args[3]!);
		process.stdout.write(`${JSON.stringify(result)}\n`);
	}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(() => {
		process.stderr.write(
			"Clipboard capture/prepare failed or cancelled; no secret output. Inspect ticket/kernel permissions.\n",
		);
		process.exitCode = 1;
	});
}
