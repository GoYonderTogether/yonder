import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import { pluginStorage } from "@yonder/local-host/plugins/storage";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";

test("binding private storage during setup is inert and actual writes wait for start", async () => {
	const home = await tempHome("plugin-storage-registration-");
	const root = join(home, "private");
	let setup = true;
	const storage = pluginStorage(root, () => {
		if (setup) throw new Error("setup only registers");
	});
	try {
		const files = storage.open();
		expect(storage.open()).toBe(files);
		expect(() => files.write("state.json", "{}")).toThrow("setup only registers");
		await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
		setup = false;
		await files.write("state.json", "{}");
		expect(await files.read("state.json")).toBe("{}");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
