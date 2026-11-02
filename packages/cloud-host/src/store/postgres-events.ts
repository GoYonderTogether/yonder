import type { Store } from "@yonder/bot-core/store/contracts";
import { newEvent } from "@yonder/bot-core/store/event";
import { postgresQuota } from "@yonder/cloud-host/store/postgres-quota";
import { postgresTransaction } from "@yonder/cloud-host/store/postgres-schema";
import type { EventInput, EventQuery, Route, YEvent } from "@yonder/sdk";
import type { Pool, PoolClient, QueryResult } from "pg";

type EventRow = YEvent & {
	tenant_id: string;
	bot_id: string;
	parent: string | null;
	from: string | null;
	conv: string | null;
	routes: Route[] | null;
};
function postgresEventRow(row: EventRow): YEvent {
	const { tenant_id: _tenant, bot_id: _bot, ...event } = row;
	return Object.fromEntries(Object.entries(event).filter(([, value]) => value !== null)) as unknown as YEvent;
}

export function postgresEvents(pool: Pool, tenant: string, bot: string, onEvent?: (event: YEvent) => void) {
	async function findInput(db: Pool | PoolClient, input: EventInput): Promise<YEvent | undefined> {
		let result: QueryResult<EventRow>;
		if (["runtime.tool-result", "runtime.continuation", "agent.result"].includes(input.type)) {
			const { session, job } = input.data as { session?: unknown; job?: unknown };
			if (typeof session !== "string" || typeof job !== "string") return;
			result = await db.query<EventRow>(
				"SELECT * FROM bot_events WHERE tenant_id=$1 AND bot_id=$2 AND type=$3 AND data->>'session'=$4 AND data->>'job'=$5 ORDER BY id LIMIT 1",
				[tenant, bot, input.type, session, job],
			);
		} else {
			const msgId = (input.data as { msgId?: unknown }).msgId;
			if (typeof msgId !== "string" || !msgId || !input.conv?.startsWith("conv:")) return;
			const prefix = input.conv.split(":").slice(0, 2).join(":") + ":";
			result = await db.query<EventRow>(
				"SELECT * FROM bot_events WHERE tenant_id=$1 AND bot_id=$2 AND type=$3 AND starts_with(conv,$4) AND data->>'msgId'=$5 AND (CASE WHEN type='message.in' THEN data->>'target' END) IS NOT DISTINCT FROM $6 ORDER BY id LIMIT 1",
				[
					tenant,
					bot,
					input.type,
					prefix,
					msgId,
					input.type === "message.in" ? ((input.data as { target?: string }).target ?? null) : null,
				],
			);
		}
		return result.rows[0] && postgresEventRow(result.rows[0]);
	}
	async function insert(db: Pool | PoolClient, event: YEvent): Promise<YEvent> {
		await db.query("INSERT INTO bot_events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [
			tenant,
			bot,
			event.id,
			event.ts,
			event.type,
			event.parent ?? null,
			event.from ?? null,
			event.conv ?? null,
			JSON.stringify(event.data),
			event.routes ? JSON.stringify(event.routes) : null,
		]);
		if (event.routes && event.from?.startsWith("acct:")) {
			const data = event.data as { name?: string; mentionNames?: Record<string, string> };
			const names = new Map<string, string>();
			if (data.name) names.set(event.from, data.name);
			for (const [ref, name] of Object.entries(data.mentionNames ?? {}))
				if (ref.startsWith("acct:") && name) names.set(ref, name);
			for (const [ref, name] of names)
				await db.query(
					`INSERT INTO bot_accounts(tenant_id,bot_id,ref,name,"firstSeen","lastSeen") VALUES($1,$2,$3,$4,$5,$5)
			ON CONFLICT(tenant_id,bot_id,ref) DO UPDATE SET name=coalesce(excluded.name,bot_accounts.name),"lastSeen"=excluded."lastSeen"`,
					[tenant, bot, ref, name, event.ts],
				);
		}
		return event;
	}
	const rows = async (sql: string, params: unknown[] = []): Promise<YEvent[]> =>
		(await pool.query<EventRow>(sql, [tenant, bot, ...params])).rows.map(postgresEventRow);
	const events: Store["events"] = {
		findInput: (input) => findInput(pool, input),
		async append(event) {
			const result = await postgresTransaction(
				pool,
				tenant,
				bot,
				async (tx) => (await findInput(tx, event)) ?? insert(tx, event),
			);
			if (result.id === event.id) onEvent?.(result);
			return result;
		},
		async appendWithFacts(event, facts) {
			const added: YEvent[] = [];
			const result = await postgresTransaction(pool, tenant, bot, async (tx) => {
				const previous = await findInput(tx, event);
				if (previous) return previous;
				added.push(await insert(tx, event));
				for (const fact of facts) added.push(await insert(tx, newEvent(fact)));
				return event;
			});
			for (const item of added) onEvent?.(item);
			return result;
		},
		record: (input, routes) => events.append(newEvent(input, routes)),
		async firstTaskInputs(sessions) {
			if (!sessions.length) return new Map();
			const result = await pool.query<{ session: string; text: string }>(
				`SELECT session,text FROM (SELECT data->>'session' AS session,data->>'text' AS text,
			ROW_NUMBER() OVER(PARTITION BY data->>'session' ORDER BY id) AS rank FROM bot_events WHERE tenant_id=$1 AND bot_id=$2 AND type='session.input'
			AND ("from" IS NULL OR ("from" LIKE 'agent:%' AND data->>'taskOwned'='true'))
			AND data->>'session'=ANY($3::text[]) AND jsonb_typeof(data->'text')='string' AND length(btrim(data->>'text',E'\\t\\n\\r '))>0) WHERE rank=1`,
				[tenant, bot, sessions],
			);
			return new Map(result.rows.map((row) => [row.session, row.text]));
		},
		async runForInput(session, input) {
			return (
				await rows(
					"SELECT * FROM bot_events WHERE tenant_id=$1 AND bot_id=$2 AND type='run.end' AND data->>'session'=$3 AND data->'inputs' @> $4::jsonb ORDER BY id LIMIT 1",
					[session, JSON.stringify([input])],
				)
			)[0];
		},
		waitingInputs: (session) =>
			rows(
				"SELECT * FROM bot_events WHERE tenant_id=$1 AND bot_id=$2 AND EXISTS(SELECT 1 FROM jsonb_array_elements(routes) r WHERE r->>'session'=$3 AND r->>'waiting'='true') ORDER BY id",
				[session],
			),
		async agentResult(session, input) {
			return (
				await rows(
					"SELECT * FROM bot_events WHERE tenant_id=$1 AND bot_id=$2 AND type='agent.result' AND data->>'session'=$3 AND parent=$4 LIMIT 1",
					[session, input],
				)
			)[0];
		},
		outputSince(session, target, after = "", since = "", account = target) {
			return rows(
				`SELECT e.* FROM bot_events e WHERE tenant_id=$1 AND bot_id=$2 AND e.id>$3 AND e.ts>=$4 AND (
			(data->>'session'=$5 AND (conv=$6 OR data->>'to' IN($6,$7) OR data->>'target' IN($6,$7)) AND (type IN('message.out','message.attempt') OR data#>>'{delivery,ok}'='true'))
			OR (type='message.unknown' AND EXISTS(SELECT 1 FROM bot_events a WHERE a.tenant_id=e.tenant_id AND a.bot_id=e.bot_id AND a.id=e.data->>'attempt' AND a.data->>'session'=$5 AND a.data->>'target' IN($6,$7)))) ORDER BY e.id`,
				[after, since, session, target, account],
			);
		},
		completionNotices: () =>
			rows(
				"SELECT * FROM bot_events WHERE tenant_id=$1 AND bot_id=$2 AND type='run.end' AND jsonb_array_length(data->'completionNotices')>0 ORDER BY id",
			),
		async runEnd(session, runId) {
			return (
				await rows(
					"SELECT * FROM bot_events WHERE tenant_id=$1 AND bot_id=$2 AND type='run.end' AND data->>'session'=$3 AND data->>'runId'=$4 LIMIT 1",
					[session, runId],
				)
			)[0];
		},
		async recordRun(input, settle) {
			const event = newEvent(input);
			const added = await postgresTransaction(pool, tenant, bot, async (tx) => {
				const found = await tx.query(
					"SELECT id FROM bot_events WHERE tenant_id=$1 AND bot_id=$2 AND type='run.end' AND data->>'session'=$3 AND data->>'runId'=$4 LIMIT 1",
					[tenant, bot, input.data.session, input.data.runId],
				);
				if (found.rows.length) return false;
				if (settle) await settle(postgresQuota(tx, tenant, bot));
				await insert(tx, event);
				return true;
			});
			if (added) onEvent?.(event);
			return added;
		},
		async claimAttempt(input) {
			const event = newEvent(input);
			const added = await postgresTransaction(pool, tenant, bot, async (tx) => {
				if (input.data.session && input.data.runId) {
					const found = await tx.query(
						"SELECT id FROM bot_events WHERE tenant_id=$1 AND bot_id=$2 AND type='message.attempt' AND data->>'session'=$3 AND data->>'runId'=$4 AND data->>'target'=$5 AND (data->>'message' IS NULL OR data->>'message'=$6) LIMIT 1",
						[tenant, bot, input.data.session, input.data.runId, input.data.target, input.data.message ?? ""],
					);
					if (found.rows.length) return false;
				}
				await insert(tx, event);
				return true;
			});
			if (added) {
				onEvent?.(event);
				return event.id;
			}
			return undefined;
		},
		async retryableAttempts() {
			const result = await pool.query<EventRow & { receipt: Record<string, unknown>; sender: string | null }>(
				`SELECT a.*,o.data AS receipt,o."from" AS sender FROM bot_events a
			JOIN bot_events o ON o.tenant_id=a.tenant_id AND o.bot_id=a.bot_id AND o.id=(SELECT r.id FROM bot_events r WHERE r.tenant_id=a.tenant_id AND r.bot_id=a.bot_id AND r.type IN('message.out','message.unknown','message.retry') AND r.data->>'attempt'=a.id ORDER BY r.id DESC LIMIT 1)
			WHERE a.tenant_id=$1 AND a.bot_id=$2 AND a.type='message.attempt' AND o.type='message.out' AND o.data#>>'{delivery,retryable}'='true' AND o.data#>>'{delivery,id}' IS NULL AND coalesce(o.data#>>'{delivery,uncertain}','false')='false' ORDER BY a.id`,
				[tenant, bot],
			);
			return result.rows.map(({ receipt, sender, ...row }) => {
				const event = postgresEventRow(row);
				return {
					...event,
					data: {
						...event.data,
						outgoing: (event.data as { outgoing?: object }).outgoing ?? {
							text: receipt.text,
							...(receipt.sourceMessageId ? { sourceMessageId: receipt.sourceMessageId } : {}),
							...(receipt.attachments ? { attachments: receipt.attachments } : {}),
						},
						...(sender ? { from: sender } : {}),
					},
				};
			});
		},
		unresolvedAttempts: () =>
			rows(`SELECT a.* FROM bot_events a WHERE a.tenant_id=$1 AND a.bot_id=$2 AND a.type='message.attempt' AND (
		NOT EXISTS(SELECT 1 FROM bot_events c WHERE c.tenant_id=a.tenant_id AND c.bot_id=a.bot_id AND c.type IN('message.out','message.unknown') AND c.data->>'attempt'=a.id)
		OR EXISTS(SELECT 1 FROM bot_events r WHERE r.tenant_id=a.tenant_id AND r.bot_id=a.bot_id AND r.type='message.retry' AND r.data->>'attempt'=a.id
		AND NOT EXISTS(SELECT 1 FROM bot_events c WHERE c.tenant_id=a.tenant_id AND c.bot_id=a.bot_id AND c.type IN('message.out','message.unknown') AND c.data->>'attempt'=a.id AND c.id>r.id))) ORDER BY a.id`),
		async get(id) {
			return (await rows("SELECT * FROM bot_events WHERE tenant_id=$1 AND bot_id=$2 AND id=$3", [id]))[0];
		},
		async watermark() {
			return (
				(
					await pool.query<{ id: string | null }>(
						"SELECT max(id) AS id FROM bot_events WHERE tenant_id=$1 AND bot_id=$2",
						[tenant, bot],
					)
				).rows[0]?.id ?? undefined
			);
		},
		async query(query: EventQuery = {}) {
			const limit = query.limit ?? 100;
			if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
				throw new Error("event limit must be an integer from 1 to 1000");
			const clauses = ["tenant_id=$1", "bot_id=$2"];
			const values: unknown[] = [tenant, bot];
			const add = (field: string, value: unknown) => {
				values.push(value);
				clauses.push(`${field}$${values.length}`);
			};
			if (query.id !== undefined) add("id=", query.id);
			if (query.type)
				query.type.endsWith(".*") ? add("starts_with(type,", query.type.slice(0, -1)) : add("type=", query.type);
			if (query.type?.endsWith(".*")) clauses[clauses.length - 1] += ")";
			if (query.from) add('"from"=', query.from);
			if (query.conv) add("conv=", query.conv);
			if (query.agent) {
				values.push(query.agent);
				clauses.push(`EXISTS(SELECT 1 FROM jsonb_array_elements(routes) r WHERE r->>'agent'=$${values.length})`);
			}
			if (query.since) add("ts>=", query.since);
			if (query.until) add("ts<", query.until);
			if (query.after) add("id>", query.after);
			values.push(limit + 1);
			const result = (
				await pool.query<EventRow>(
					`SELECT * FROM bot_events WHERE ${clauses.join(" AND ")} ORDER BY id LIMIT $${values.length}`,
					values,
				)
			).rows.map(postgresEventRow);
			return { events: result.slice(0, limit), ...(result.length > limit ? { next: result[limit - 1]!.id } : {}) };
		},
	};
	return { events, insert };
}
