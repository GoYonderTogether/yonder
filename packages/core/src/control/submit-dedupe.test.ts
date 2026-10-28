import { expect, it } from "vitest";
import { dedupe } from "./submit-dedupe.js";

it("retains concurrent requests until rejection and permits retry", async () => {
	let reject!: (error: Error) => void;
	let calls = 0;
	const first = dedupe(
		"session-pending",
		"request",
		() =>
			new Promise((_, fail) => {
				reject = fail;
			}),
	);
	const failure = expect(first).rejects.toThrow("failed");
	const run = async () => {
		calls++;
		return { event: "second", session: "session-pending" };
	};
	const duplicate = dedupe("session-pending", "request", run);
	const duplicateFailure = expect(duplicate).rejects.toThrow("failed");
	expect(calls).toBe(0);
	reject(new Error("failed"));
	await Promise.all([failure, duplicateFailure]);
	await expect(dedupe("session-pending", "request", run)).resolves.toEqual({
		event: "second",
		session: "session-pending",
	});
	await expect(dedupe("session-pending", "request", run)).resolves.toEqual({
		event: "second",
		session: "session-pending",
		deduped: true,
	});
	expect(calls).toBe(1);
});
