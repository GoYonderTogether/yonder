// Deterministic OAuth-handler/real file-lock probe. No model streams, network, or real credentials.
import assert from "node:assert/strict";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { createModels } from "@earendil-works/pi-ai";
import { CredentialSlotStore } from "../../packages/core/dist/runtime/credential-slots.js";

const [path, slot, gate, marker, cancelled] = process.argv.slice(2);
const slots = new CredentialSlotStore(path);
const controller = new AbortController();
const models = createModels({
	credentials: slots.bind({ openai: slot }),
	authContext: { credentialMode: "explicit", env: async () => undefined, fileExists: async () => false },
});
models.setProvider({
	id: "openai",
	name: "lock probe",
	getModels: () => [],
	auth: {
		oauth: {
			name: "lock probe",
			refresh: async (credential) => {
				appendFileSync(marker, "refresh\n");
				writeFileSync(`${marker}.${slot}.entered`, "entered");
				if (cancelled === "cancel") controller.abort();
				while (!existsSync(gate)) await setTimeout(5);
				return { ...credential, access: "fixture-new", refresh: "fixture-rotated", expires: Date.now() + 3600000 };
			},
			toAuth: async (credential) => ({ apiKey: credential.access }),
		},
	},
	stream: () => {
		throw new Error("No model requests allowed");
	},
	streamSimple: () => {
		throw new Error("No model requests allowed");
	},
});
if (cancelled === "cancel")
	await assert.rejects(models.getAuth("openai", { signal: controller.signal }), { name: "AbortError" });
else assert.equal((await models.getAuth("openai"))?.auth.apiKey, "fixture-new");
// Waiting for the real store lock also waits for cancelled refresh persistence.
assert.equal((await slots.bind({ openai: slot }).read("openai"))?.refresh, "fixture-rotated");
console.log("persisted");
