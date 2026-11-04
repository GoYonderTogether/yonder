import type { Store } from "@yonder/bot-core/store/contracts";
import { postgresEvents } from "@yonder/cloud-host/store/postgres-events";
import { postgresIdentity } from "@yonder/cloud-host/store/postgres-identity";
import { postgresQuota } from "@yonder/cloud-host/store/postgres-quota";
import { postgresSessions } from "@yonder/cloud-host/store/postgres-sessions";
import type { Ref, YEvent } from "@yonder/sdk";
import type { Pool } from "pg";
import { budgetStore, notificationStore } from "./state.js";

export { migratePostgresStore, postgresStoreSchema } from "@yonder/cloud-host/store/postgres-schema";

/** A Bot's domain state uses the same Store contract as the local SQLite host. */
export function createPostgresStore(
	pool: Pool,
	tenant: string,
	bot: string,
	owner: (agent: string) => Ref | undefined = () => undefined,
	onEvent?: (event: YEvent) => void,
): Store {
	const { events, insert } = postgresEvents(pool, tenant, bot, onEvent);
	return {
		events,
		sessions: postgresSessions(pool, tenant, bot),
		identity: postgresIdentity(pool, tenant, bot, owner, insert, onEvent),
		quota: postgresQuota(pool, tenant, bot),
		notifications: notificationStore(pool, tenant, bot),
		budget: budgetStore(pool, tenant, bot),
	};
}
