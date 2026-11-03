import { loadSubagentDefinitionsFrom } from "@yonder/bot-definition/subagents";
import { localSourceDirectory } from "@yonder/local-host/config/fs-source";

export { loadSubagentDefinitionsFrom } from "@yonder/bot-definition/subagents";
export const loadSubagentDefinitions = (home: string) => loadSubagentDefinitionsFrom(localSourceDirectory(home));
