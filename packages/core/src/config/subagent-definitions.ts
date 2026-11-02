import { loadSubagentDefinitionsFrom } from "@yonder/bot-definition/subagents";
import { localSourceDirectory } from "./fs-source.js";

export { loadSubagentDefinitionsFrom } from "@yonder/bot-definition/subagents";
export const loadSubagentDefinitions = (home: string) => loadSubagentDefinitionsFrom(localSourceDirectory(home));
