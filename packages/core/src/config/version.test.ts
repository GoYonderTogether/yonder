import { expect, test } from "vitest";
import { parseAgentConfig, parsePresetConfig, parseYonderConfig } from "./index.js";

const configs = [
	(version: string) => parseYonderConfig(`schema: 1\n${version}`, "yonder.yaml"),
	(version: string) =>
		parseAgentConfig(
			`schema: 1\nid: main\nname: Main\nowner: person:owner\ndefaultProfile: main\nprofiles: {main: {}}\nbindings: []\n${version}`,
		),
	(version: string) => parsePresetConfig(`schema: 1\ndescription: preset\n${version}`, "preset"),
];

test.each(configs)("supports omitted or explicit version and rejects unsupported versions", (parse) => {
	expect(() => parse("")).not.toThrow();
	expect(() => parse("version: 1\n")).not.toThrow();
	expect(() => parse("version: 2\n")).toThrow("配置版本 2 高于本程序支持的 1，请升级 Yonder");
	expect(() => parse("version: 0\n")).toThrow();
	expect(() => parse("version: '2'\n")).toThrow();
});
