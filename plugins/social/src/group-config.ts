import type { Ref } from "@yonder/sdk";
import type { ReviewOptions } from "./group-review.js";
import type { OwnRules } from "./group-rules.js";
export interface GroupJudgeConfig {
	preset: string;
	conversations?: Ref[];
	identities?: Record<string, string>;
	rooms?: Ref[][];
	initialRules?: Record<string, OwnRules>;
	review?: ReviewOptions;
}
