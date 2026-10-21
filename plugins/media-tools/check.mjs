import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkPlugin } from "@yonder/sdk/testing";
import plugin from "./dist/index.js";

assert.deepEqual(await checkPlugin(fileURLToPath(new URL(".", import.meta.url))), []);

const manifest = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
const tools = [];
plugin.setup({
	id: "media-tools",
	tools: { register: (tool) => tools.push(tool) },
	services: { resolve: async () => undefined },
});
assert.deepEqual(
	tools.map((tool) => tool.name),
	manifest.yonder.contributes.tools,
);
const tool = tools[0];
assert.deepEqual(tool.capabilities, ["network", "write"]);
const ctx = { signal: new AbortController().signal };
assert.match((await tool.execute({ prompt: "  " }, ctx)).text, /INVALID_ARGUMENTS/);
assert.match((await tool.execute({ prompt: "检查", output: "/tmp/overwrite" }, ctx)).text, /INVALID_ARGUMENTS/);
assert.match((await tool.execute({ prompt: "检查", image_size: "1x1" }, ctx)).text, /INVALID_ARGUMENTS/);
assert.deepEqual(await tool.execute({ prompt: "检查" }, ctx), {
	text: "MEDIA_IMAGE_SERVICE_NOT_CONFIGURED",
	isError: true,
});
assert.match((await tool.execute({ prompt: "检查" }, { signal: AbortSignal.abort() })).text, /CANCELLED/);
const asr = tools.find((item) => item.name === "media-tools_audio_transcribe");
assert.deepEqual(asr.capabilities, ["read", "network"]);
assert.match((await asr.execute({ file: " " }, ctx)).text, /INVALID_ARGUMENTS/);
assert.match((await asr.execute({ file: "audio.wav", output: "/tmp/overwrite" }, ctx)).text, /INVALID_ARGUMENTS/);
assert.deepEqual(await asr.execute({ file: "audio.wav" }, ctx), {
	text: "MEDIA_ASR_SERVICE_NOT_CONFIGURED",
	isError: true,
});
assert.match((await asr.execute({ file: "audio.wav" }, { signal: AbortSignal.abort() })).text, /CANCELLED/);
console.log(
	"media-tools: SDK checkPlugin and 9 argument/configuration/cancellation contracts passed; no generation/transcription request made",
);
