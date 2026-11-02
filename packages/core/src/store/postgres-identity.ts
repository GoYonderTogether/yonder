import type { AccountInfo, IdentityAPI, Ref, YEvent } from "@yonder/sdk";
import { parseRef, person } from "@yonder/sdk";
import type { Pool, PoolClient } from "pg";
import { newEvent } from "./event.js";
import { postgresTransaction } from "./postgres-schema.js";

export function postgresIdentity(
	pool: Pool,
	tenant: string,
	bot: string,
	owner: (agent: string) => Ref | undefined,
	insert: (tx: PoolClient, event: YEvent) => Promise<YEvent>,
	onEvent?: (event: YEvent) => void,
) {
	const defined = <T extends object>(row: T): T =>
		Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) as T;
	return (actor?: Ref): IdentityAPI => {
		const api: IdentityAPI = {
			async account(ref) {
				if (parseRef(ref).kind !== "acct") throw new Error("Expected acct reference");
				const row = (
					await pool.query<AccountInfo>(
						'SELECT ref,person,name,"firstSeen","lastSeen" FROM bot_accounts WHERE tenant_id=$1 AND bot_id=$2 AND ref=$3',
						[tenant, bot, ref],
					)
				).rows[0];
				return row && defined(row);
			},
			async person(ref) {
				const parsed = parseRef(ref);
				if (parsed.kind !== "person") throw new Error("Expected person reference");
				const row = (
					await pool.query<{ name: string; note: string | null }>(
						"SELECT name,note FROM bot_persons WHERE tenant_id=$1 AND bot_id=$2 AND id=$3",
						[tenant, bot, parsed.id],
					)
				).rows[0];
				if (!row) return;
				return {
					ref,
					name: row.name,
					...(row.note !== null ? { note: row.note } : {}),
					accounts: (
						await pool.query<{ ref: Ref }>(
							"SELECT ref FROM bot_accounts WHERE tenant_id=$1 AND bot_id=$2 AND person=$3 ORDER BY ref",
							[tenant, bot, ref],
						)
					).rows.map((row) => row.ref),
				};
			},
			async createPerson(p) {
				const ref = person(p.id);
				await pool.query(
					"INSERT INTO bot_persons VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,bot_id,id) DO UPDATE SET name=excluded.name,note=excluded.note",
					[tenant, bot, p.id, p.name, p.note ?? null],
				);
				return (await api.person(ref))!;
			},
			async link(account, ref) {
				if (parseRef(account).kind !== "acct") throw new Error("Expected acct reference");
				if (!(await api.person(ref))) throw new Error(`Unknown person: ${ref}`);
				const event = newEvent({
					type: "identity.link",
					...(actor ? { from: actor } : {}),
					data: { account, person: ref, linked: true },
				});
				await postgresTransaction(pool, tenant, bot, async (tx) => {
					await tx.query(
						`INSERT INTO bot_accounts(tenant_id,bot_id,ref,person,"firstSeen","lastSeen") VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT(tenant_id,bot_id,ref) DO UPDATE SET person=excluded.person`,
						[tenant, bot, account, ref, event.ts],
					);
					await insert(tx, event);
				});
				onEvent?.(event);
			},
			async unlink(account) {
				const row = await api.account(account);
				if (!row) throw new Error(`Unknown account: ${account}`);
				if (!row.person) return;
				const event = newEvent({
					type: "identity.link",
					...(actor ? { from: actor } : {}),
					data: { account, person: row.person, linked: false },
				});
				await postgresTransaction(pool, tenant, bot, async (tx) => {
					await tx.query("UPDATE bot_accounts SET person=NULL WHERE tenant_id=$1 AND bot_id=$2 AND ref=$3", [
						tenant,
						bot,
						account,
					]);
					await insert(tx, event);
				});
				onEvent?.(event);
			},
			async relation(agent, account) {
				const linked = (await api.account(account))?.person;
				return !linked ? "stranger" : linked === owner(agent) ? "owner" : "known";
			},
			async lookup(ref) {
				const parsed = parseRef(ref);
				if (parsed.kind !== "acct" && parsed.kind !== "person") throw new Error("lookup expects acct or person");
				const account = parsed.kind === "acct" ? await api.account(ref) : undefined;
				const personRef = parsed.kind === "person" ? ref : account?.person;
				const accounts = personRef
					? (
							await pool.query<AccountInfo>(
								'SELECT ref,person,name,"firstSeen","lastSeen" FROM bot_accounts WHERE tenant_id=$1 AND bot_id=$2 AND person=$3 ORDER BY ref',
								[tenant, bot, personRef],
							)
						).rows.map(defined)
					: account
						? [account]
						: [];
				if (!accounts.length) return { accounts, convs: [], agents: [] };
				const refs = accounts.map((account) => account.ref);
				const convs = await pool.query<{ conv: Ref }>(
					'SELECT DISTINCT conv FROM bot_events WHERE tenant_id=$1 AND bot_id=$2 AND "from"=ANY($3::text[]) AND conv IS NOT NULL ORDER BY conv',
					[tenant, bot, refs],
				);
				const agents = await pool.query<{ agent: string }>(
					`SELECT DISTINCT s.agent FROM bot_events e CROSS JOIN LATERAL jsonb_array_elements(e.routes) r
				JOIN bot_sessions s ON s.tenant_id=e.tenant_id AND s.bot_id=e.bot_id AND s.id::text=r->>'session'
				WHERE e.tenant_id=$1 AND e.bot_id=$2 AND e."from"=ANY($3::text[]) AND s.agent IS NOT NULL ORDER BY s.agent`,
					[tenant, bot, refs],
				);
				return { accounts, convs: convs.rows.map((row) => row.conv), agents: agents.rows.map((row) => row.agent) };
			},
		};
		return api;
	};
}
