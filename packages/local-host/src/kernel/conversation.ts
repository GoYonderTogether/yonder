import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { kernelPromptOptions as create } from "@yonder/bot-core/kernel/conversation";
import { pluginTemplateDirs } from "@yonder/bot-core/prompt/templates";
import type { BotSource } from "@yonder/bot-definition/source";
import { localSourceDirectory } from "../config/fs-source.js";
import { downloadAttachment } from "../prompt/attachments.js";
import { projectRulesFor, sourceFor } from "./workspace.js";

export { conversationPromptOptions, kernelTools } from "@yonder/bot-core/kernel/conversation";

type Args = Parameters<typeof create>;
export function kernelPromptOptions(
	home: Args[0],
	config: Args[1],
	loaded: Args[2],
	store: Args[3],
	agents: Args[4],
	runtime: Args[5],
	services: Args[6],
	skills: Args[7],
	version: Args[8],
	source?: BotSource,
) {
	const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../cli/dist/index.js");
	return create(
		home,
		config,
		loaded,
		store,
		agents,
		runtime,
		services,
		skills,
		version,
		source ?? sourceFor(home, config, loaded),
		{
			hostFacts: {
				nodePath: process.execPath,
				nodeVersion: process.version,
				platform: process.platform,
				cliPath,
				cliAvailable: existsSync(cliPath),
			},
			cacheAttachment: (item, signal, event, index) => downloadAttachment(item, home, signal, event, index),
			projectRules: (session, signal) =>
				projectRulesFor(home, config, loaded, session, signal, runtime().environment(session)),
			templateSources: (session) =>
				pluginTemplateDirs(loaded.info ?? [], runtime().describeTools(session)).map((entry) => ({
					...localSourceDirectory(entry.directory),
					tools: entry.tools,
				})),
		},
	);
}
