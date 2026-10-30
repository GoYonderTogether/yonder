import { expect, it } from "vitest";
import { guardedWorkStream, verifyWorkOwner } from "./work-stream.js";

it("rechecks owner before each frame and event and aborts when ownership changes", async () => {
	let allowed = true;
	let emit!: (frame: unknown) => void;
	let inner!: AbortSignal;
	const seen: unknown[] = [],
		sent: unknown[] = [];
	const stream = await guardedWorkStream(
		async () => {
			if (!allowed) throw Error("forbidden");
		},
		async (send, signal) => {
			emit = send;
			inner = signal;
			return { frame: (frame) => seen.push(frame) };
		},
		(frame) => sent.push(frame),
		new AbortController().signal,
	);
	stream.frame({ t: "sub", sub: "x" });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(seen).toEqual([{ t: "sub", sub: "x" }]);
	allowed = false;
	emit({ t: "ev", sub: "x", data: "private" });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(inner.aborted).toBe(true);
	expect(sent).toEqual([{ t: "end", sub: "x", reason: "forbidden" }]);
	stream.frame({ t: "unsub", sub: "x" });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(seen).toHaveLength(1);
});

it("requires every agent to have the same linked owner", async () => {
	const account = async () => ({ person: "person:owner" });
	await verifyWorkOwner("card", "actor", [{ id: "main", owner: "person:owner" }], account);
	await expect(verifyWorkOwner("card", "actor", [{ id: "main" }], async () => undefined)).rejects.toThrow("forbidden");
	await expect(
		verifyWorkOwner(
			"card",
			"actor",
			[
				{ id: "main", owner: "person:owner" },
				{ id: "other", owner: "person:other" },
			],
			account,
		),
	).rejects.toThrow("forbidden");
});
