import { expandTemplate as expand, listTemplates as list } from "@yonder/bot-core/prompt/templates";
import type { BotSource } from "@yonder/bot-definition/source";
import { localSourceDirectory } from "../config/fs-source.js";
import { createFsBotSource } from "../kernel/source-fs.js";

export { pluginTemplateDirs } from "@yonder/bot-core/prompt/templates";

type TemplateDir = string | { directory: string; tools: string[] };
const sources = (dirs: TemplateDir[]) =>
	dirs.map((entry) => ({
		...localSourceDirectory(typeof entry === "string" ? entry : entry.directory),
		...(typeof entry === "string" ? {} : { tools: entry.tools }),
	}));
export const listTemplates = (
	home: string,
	agent: string | null,
	profile: string,
	dirs: TemplateDir[] = [],
	source?: BotSource,
) => list(home, agent, profile, sources(dirs), source ?? createFsBotSource(home));
export const expandTemplate = (
	home: string,
	agent: string | null,
	text: string,
	dirs: TemplateDir[] = [],
	profile = "",
	source?: BotSource,
) => expand(home, agent, text, sources(dirs), profile, source ?? createFsBotSource(home));
