import type { Ref, YEvent } from "@yonder/sdk";
import type { Pool } from "pg";
import type { Store } from "./index.js";
import { postgresEvents } from "./postgres-events.js";
import { postgresIdentity } from "./postgres-identity.js";
import { postgresQuota } from "./postgres-quota.js";
import { postgresSessions } from "./postgres-sessions.js";

export { migratePostgresStore, postgresStoreSchema } from "./postgres-schema.js";

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
	};
}
