import { loadPresetsFrom, loadYonderConfigFrom, presetFilesFrom } from "@yonder/bot-definition/load";
import { localSourceDirectory } from "@yonder/local-host/config/fs-source";

export { loadAgentConfig, loadPresetsFrom, loadYonderConfigFrom, presetFilesFrom } from "@yonder/bot-definition/load";

export const loadYonderConfig = (home: string, onRead?: (file: string, text: string) => void, onFailure?: () => void) =>
	loadYonderConfigFrom(localSourceDirectory(home), onRead, onFailure);
export const presetFiles = (home: string) => presetFilesFrom(localSourceDirectory(home));
export const loadPresets = (home: string, onRead?: (file: string, text: string) => void) =>
	loadPresetsFrom(localSourceDirectory(home), onRead);
