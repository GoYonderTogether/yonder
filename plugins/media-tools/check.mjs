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
const tts = tools.find((item) => item.name === "media-tools_audio_speak");
assert.deepEqual(tts.capabilities, ["network", "write"]);
assert.match((await tts.execute({ text: "  " }, ctx)).text, /INVALID_ARGUMENTS/);
assert.match((await tts.execute({ text: "你好", output: "/tmp/overwrite" }, ctx)).text, /INVALID_ARGUMENTS/);
assert.match((await tts.execute({ text: "你好", speed: 9 }, ctx)).text, /INVALID_ARGUMENTS/);
assert.match((await tts.execute({ text: "你好", speed: "fast" }, ctx)).text, /INVALID_ARGUMENTS/);
assert.deepEqual(await tts.execute({ text: "你好" }, ctx), {
	text: "MEDIA_TTS_SERVICE_NOT_CONFIGURED",
	isError: true,
});
assert.match((await tts.execute({ text: "你好" }, { signal: AbortSignal.abort() })).text, /CANCELLED/);
// Any endpoint of another protocol must be rejected before a socket is opened.
const otherTools = [];
plugin.setup({
	id: "media-tools",
	tools: { register: (item) => otherTools.push(item) },
	services: {
		resolve: async (capability) =>
			capability === "tts"
				? {
						id: "x",
						protocol: "siliconflow",
						baseUrl: "https://example.invalid",
						apiKey: "k",
						models: ["m"],
						voices: ["v"],
					}
				: undefined,
	},
});
const wrongProtocol = otherTools.find((item) => item.name === "media-tools_audio_speak");
assert.match((await wrongProtocol.execute({ text: "你好" }, ctx)).text, /UNSUPPORTED_PROTOCOL/);
console.log(
	"media-tools: SDK checkPlugin and 15 argument/configuration/cancellation contracts passed; no generation/transcription/synthesis request made",
);
