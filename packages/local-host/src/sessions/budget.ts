import { checkBudget as check, budgetState as state } from "@yonder/bot-core/sessions/budget";
import type { YonderConfig } from "@yonder/local-host/config/index";
import type { Db } from "@yonder/runtime-adapter/contracts";
import { createStore } from "../store/index.js";

export * from "@yonder/bot-core/sessions/budget";
export const budgetState = async (db: Db, session: string, now = Date.now()) =>
	state(await createStore(db), session, now);
export const checkBudget = async (
	options: { db: Db; config: YonderConfig },
	session: string,
	usage = { input: 0, output: 0 },
	now = Date.now(),
) => check({ store: await createStore(options.db), config: options.config }, session, usage, now);
