import type { PromptOptions as PurePromptOptions } from "@yonder/bot-core/prompt/index";
import { prepareInput as prepare } from "@yonder/bot-core/prompt/index";
import type { RuntimeSessionConfig } from "@yonder/runtime-adapter/types";
import { localSourceDirectory } from "../config/fs-source.js";
import { createFsBotSource } from "../kernel/source-fs.js";
import { downloadAttachment } from "./attachments.js";

export * from "@yonder/bot-core/prompt/index";
export interface PromptOptions extends PurePromptOptions {
	templateDirs?(session: RuntimeSessionConfig): Array<{ directory: string; tools: string[] }>;
}
type PrepareArgs = Parameters<typeof prepare>;
export const prepareInput = (
	row: PrepareArgs[0],
	config: PrepareArgs[1],
	event: PrepareArgs[2],
	wake: PrepareArgs[3],
	options: PromptOptions,
): ReturnType<typeof prepare> =>
	prepare(row, config, event, wake, {
		...options,
		source: options.source ?? createFsBotSource(options.home),
		cacheAttachment:
			options.cacheAttachment ??
			((item, signal, id, index) => downloadAttachment(item, options.home, signal, id, index)),
		templateSources:
			options.templateSources ??
			((session) =>
				(options.templateDirs?.(session) ?? []).map((entry) => ({
					...localSourceDirectory(entry.directory),
					tools: entry.tools,
				}))),
	});
