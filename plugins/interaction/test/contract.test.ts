import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPlugin } from "@yonder/sdk/testing";
import { expect, it } from "vitest";
import { CompanionService } from "../src/interaction-store.js";

it("satisfies the actual SDK plugin contract", async () => {
	expect(await checkPlugin(fileURLToPath(new URL("..", import.meta.url)))).toEqual([]);
});
it("serves cards, returns actual answers only to their owner, and recovers persisted history", async () => {
	const directory = await mkdtemp(join(tmpdir(), "yonder-ui-"));
	const service = new CompanionService(directory);
	const owner = { agent: "ui-test", session: "ui-test-session", profile: "default" };
	const signal = new AbortController().signal;
	await service.start();
	try {
		const first = await service.present(
			{
				id: "check",
				title: "交互验收",
				prompt: "选择下一步",
				kind: "choice",
				options: [{ id: "continue", label: "继续" }],
				next: { id: "note", title: "交互验收", prompt: "验收反馈", kind: "form" },
			},
			owner,
		);
		const second = await service.present(
			{ id: "second", title: "第二张", prompt: "填写反馈", kind: "form", autoClose: false },
			{ ...owner, session: "other" },
		);
		await expect(service.result(first.id, { ...owner, session: "other" }, false, signal)).rejects.toThrow("belong");
		const waiting = service.result(first.id, owner, true, signal);
		await expect(service.answer(second.id, "wrong current card", 0)).rejects.toThrow();
		await service.answer(first.id, "continue", 0);
		await expect(service.answer(first.id, "continue", 0)).rejects.toThrow();
		expect((await service.result(first.id, owner, false, signal)).status).toBe("pending");
		await service.answer(first.id, "浏览器到工具回传闭环", 1);
		const completed = await waiting;
		expect(completed.status).toBe("completed");
		expect(completed.steps.map((s) => s.answer)).toEqual(["继续", "浏览器到工具回传闭环"]);
		expect(service.view("other").interaction?.id).toBe(second.id);
		const controller = new AbortController();
		const cancelledWait = service.result(second.id, { ...owner, session: "other" }, true, controller.signal);
		controller.abort(new Error("test cancellation"));
		await expect(cancelledWait).rejects.toThrow("test cancellation");
		expect((await service.result(second.id, { ...owner, session: "other" }, false, signal)).status).toBe("pending");
		await service.closeSession("other");
		expect((await service.result(second.id, { ...owner, session: "other" }, false, signal)).status).toBe("cancelled");
		expect(JSON.parse(await readFile(join(directory, "interactions.json"), "utf8"))).toHaveLength(2);
		await service.stop();
		const restored = new CompanionService(directory);
		await restored.start();
		try {
			expect(await restored.result(first.id, owner, false, signal)).toEqual(completed);
			expect(restored.view("other").interaction).toBeUndefined();
		} finally {
			await restored.stop();
		}
	} finally {
		await service.stop();
	}
});

it("exposes the current session card, answers it and invalidates the view", async () => {
	const { createRegistrationCollector } = await import("@yonder/sdk/testing");
	const { registerViews } = await import("../src/views.js");
	const directory = await mkdtemp(join(tmpdir(), "yonder-ui-view-"));
	const service = new CompanionService(directory);
	const { api, registrations } = createRegistrationCollector();
	const invalidations: string[][] = [];
	api.invalidate = (ids) => invalidations.push(ids ?? []);
	registerViews(api, service);
	const view = registrations.views[0];
	if (!view?.provider.act) throw new Error("View action missing");
	const act = view.provider.act;
	expect(view.decl).toMatchObject({
		id: "interaction.card",
		placement: "floating",
		scope: "session",
		actScope: "owner",
	});
	await service.start();
	try {
		const owner = { agent: "agent", session: "session", profile: "default" };
		const presented = await service.present(
			{ id: "question", title: "Question", prompt: "Choose", kind: "choice", options: [{ id: "yes", label: "Yes" }] },
			owner,
		);
		expect(invalidations).toEqual([["interaction.card"]]);
		const data = await view.provider.data(owner.session);
		expect(data.content).toEqual({ type: "choice", prompt: "Choose", options: [{ id: "yes", label: "Yes" }] });
		expect((await view.provider.data("other")).content).toEqual({ type: "list", items: [] });
		await expect(act("answer", { rev: data.rev - 1, answer: "yes" }, owner.session)).rejects.toMatchObject({
			code: "invalid_params",
		});
		await act("answer", { rev: data.rev, answer: "yes" }, owner.session);
		expect(invalidations).toEqual([["interaction.card"], ["interaction.card"]]);
		expect((await service.result(presented.id, owner, false, new AbortController().signal)).status).toBe("completed");
		expect((await view.provider.data(owner.session)).content).toEqual({ type: "list", items: [] });
	} finally {
		await service.stop();
	}
});
