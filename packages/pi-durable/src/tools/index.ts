import { defineExtension } from "../harness/define.ts";
import { createBashTool } from "./bash.ts";
import { createEditTool } from "./edit.ts";
import { createReadTool, type ReadToolOptions } from "./read.ts";
import { createReplaceMatchTool } from "./replace-match.ts";
import { createReplaceTool } from "./replace.ts";
import { createWriteTool } from "./write.ts";

export {
	type BashExecution,
	type BashPrepare,
	type BashToolInput,
	type BashToolOptions,
	createBashTool,
	createPowerShellTool,
	type PowerShellToolInput,
	type PowerShellToolOptions,
} from "./bash.ts";
export { createEditTool, type EditToolDetails, type EditToolInput } from "./edit.ts";
export {
	DEFAULT_IMAGE_LIMITS,
	type ImageLimits,
	type ImageProcessor,
	type PreparedImage,
} from "./image-processor.ts";
/** The files an anchor was served for: the files an anchor edit may touch. `HASH_SEP` divides a served row's anchor and text. */
export { HASH_SEP, ownersOf as anchorOwners } from "./hashline/anchors.ts";
export { createReadTool, type ReadToolDetails, type ReadToolInput, type ReadToolOptions } from "./read.ts";
export {
	createReplaceMatchTool,
	type ReplaceMatchToolDetails,
	type ReplaceMatchToolInput,
} from "./replace-match.ts";
export { createReplaceTool, type ReplaceToolDetails, type ReplaceToolInput } from "./replace.ts";
export { createWriteTool, type WriteToolInput } from "./write.ts";

/**
 * The `coding-tools` extension: `read`, `write`, `edit`, `replace`, `replace_match`, and `bash`; nothing installs it
 * automatically. `replace` and `replace_match` edit by the anchors `read` serves. `createPowerShellTool()` adds
 * `powershell`. `images` prepares the images `read` returns (see `ReadToolOptions`).
 */
export function createCodingTools(options: ReadToolOptions = {}) {
	return defineExtension({
		name: "coding-tools",
		tools: [
			createReadTool(options),
			createWriteTool(),
			createEditTool(),
			createReplaceTool(),
			createReplaceMatchTool(),
			createBashTool(),
		],
	});
}

/** `createCodingTools()` without an image processor. */
export const CodingTools = createCodingTools();
