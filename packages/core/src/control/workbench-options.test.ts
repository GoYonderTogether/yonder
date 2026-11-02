import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { testModel } from "../config/test-support.js";
import { initHome, openKernel } from "../kernel/index.js";
import { type HostCtx, registry, socketPrincipal } from "./methods.js";

test("owner options persist, child cannot expand resources/permissions, uploaded bytes survive transcript projection", async () => {
	const home = await tempHome("ya-workbench-");
	await initHome(home, "owner", { model: testModel });
	await writeFile(
		join(home, "presets/default.yaml"),
		`schema: 1\ndescription: 工作任务\nlevel: bypass\nmodel: ${testModel}\n`,
	);
	const root = join(home, "selected"),
		other = join(home, "other");
	await mkdir(root);
	await mkdir(other);
	const kernel = await openKernel(home);
	const ctx = { home, kernel, principal: socketPrincipal } as HostCtx;
	const signal = new AbortController().signal;
	const call = (method: string, params: unknown) => registry.call(method, params, ctx, signal);
	try {
		const parent = await kernel.workbench.open(
			{ preset: "default", close: "manual" },
			{ permission: "readonly", resources: [{ deviceId: "local", paths: [root] }] },
			signal,
		);
		const child = await kernel.workbench.open(
			{ preset: "default", close: "manual", parent: parent.id },
			{ permission: "bypass", resources: [] },
			signal,
		);
		const value = await kernel.workbench.get(child.id);
		expect(value.capabilities).not.toContain("exec");
		expect(value.resources[0]?.paths[0]).toContain("selected");
		await expect(
			kernel.workbench.set(child.id, { resources: [{ deviceId: "local", paths: [other] }] }, signal),
		).rejects.toThrow("outside");
		await expect(
			registry.call(
				"sessions.options.set",
				{ id: parent.id, permission: "bypass" },
				{ ...ctx, principal: { id: "guest", transport: "gateway", kind: "remote", scopes: ["read", "write"] } },
				signal,
			),
		).rejects.toThrow();
		const attachment = (await call("attachments.put", {
			name: "actual-package.json",
			dataBase64: (await readFile(join(process.cwd(), "package.json"))).toString("base64"),
		})) as { uri: string; bytes: number; kind: string; mime: string };
		expect(await readFile(new URL(attachment.uri), "utf8")).toContain('"name": "yonder"');
		await expect(call("attachments.get", { session: parent.id, uri: attachment.uri })).rejects.toThrow("not part");
		await call("sessions.submit", { id: parent.id, text: "", attachments: [attachment] });
		await expect
			.poll(
				async () =>
					(await kernel.sessions.transcript(parent.id)).some((item) =>
						item.attachments?.some((file) => file.uri === attachment.uri),
					),
				{ timeout: 5000 },
			)
			.toBe(true);
		const downloaded = (await call("attachments.get", { session: parent.id, uri: attachment.uri })) as {
			dataBase64: string;
		};
		expect(Buffer.from(downloaded.dataBase64, "base64")).toEqual(await readFile(new URL(attachment.uri)));
		await expect(call("attachments.get", { session: child.id, uri: attachment.uri })).rejects.toThrow("not part");
		await expect(call("attachments.put", { name: "bad", dataBase64: "@invalid" })).rejects.toThrow();
		expect(await call("workspaces.list", { id: child.id })).toMatchObject({
			devices: [{ deviceId: "local", paths: value.resources[0]?.paths }],
		});
	} finally {
		await kernel.close();
		await rm(home, { recursive: true, force: true });
	}
});
