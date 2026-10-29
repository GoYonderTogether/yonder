import type { PluginAPI, ToolContext, ToolResult } from "@yonder/sdk";
import { Check } from "typebox/value";
import type { MarketClient, MarketResult } from "./client.js";
import { getParameters, inquireParameters, publishParameters, searchParameters, watchParameters } from "./schemas.js";
import type { WatchRunner } from "./watch.js";

export interface MarketDeps {
	/** 云端客户端；未配置设备令牌时返回 undefined（工具回 not_signed_in）。 */
	client(): Promise<MarketClient | undefined>;
	watch: WatchRunner;
}

const record = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** 云端实体可能直接返回，也可能包在 `{ <key>: … }` 里；两种都接受。 */
const unwrap = (body: unknown, key: string): Record<string, unknown> => {
	const outer = record(body);
	const inner = record(outer[key]);
	return Object.keys(inner).length ? inner : outer;
};

const items = (body: unknown): unknown[] => {
	const outer = record(body);
	return Array.isArray(outer.items) ? outer.items : [];
};

const json = (value: unknown): ToolResult => ({ text: JSON.stringify(value, null, 2) });

/** 业务错误按契约放在 error 字段，不抛异常。 */
const failure = (error: string, extra: Record<string, unknown> = {}): ToolResult =>
	json({ ok: false, error, ...extra });

function composed(value: MarketResult): ToolResult {
	if (!value.ok) return failure(value.error);
	if (Array.isArray(value.body)) return json({ ok: true, items: value.body });
	return json({ ok: true, ...record(value.body) });
}

export function registerMarketTools(api: PluginAPI, deps: MarketDeps): void {
	const register = (
		name: string,
		description: string,
		parameters: Parameters<typeof api.tools.register>[0]["parameters"],
		execute: (args: Record<string, unknown>, ctx: ToolContext, client: MarketClient) => Promise<ToolResult>,
	) =>
		api.tools.register({
			name: `${api.id}_${name}`,
			description,
			parameters,
			capabilities: ["network"],
			execute: async (args, ctx) => {
				if (!Check(parameters, args)) throw new Error(`Invalid ${name} arguments`);
				ctx.signal.throwIfAborted();
				const client = await deps.client();
				if (!client) return failure("not_signed_in");
				return execute(record(args), ctx, client);
			},
		});

	register(
		"search",
		"Search public market listings on the configured social cloud.",
		searchParameters,
		async (args, ctx, client) =>
			composed(
				await client.call(
					{
						method: "GET",
						path: "/listings",
						query: {
							q: args.q as string | undefined,
							kind: args.kind as string | undefined,
							category: args.category as string | undefined,
							city: args.city as string | undefined,
							min: args.min as number | undefined,
							max: args.max as number | undefined,
							sort: args.sort as string | undefined,
							limit: (args.limit as number | undefined) ?? 10,
							cursor: args.cursor as string | undefined,
						},
					},
					ctx.signal,
				),
			),
	);

	register(
		"get",
		"Read one market listing by id; counts as one agent view.",
		getParameters,
		async (args, ctx, client) => {
			const id = args.id as string;
			const result = await client.call({ method: "GET", path: `/listings/${encodeURIComponent(id)}` }, ctx.signal);
			if (!result.ok) return failure(result.error);
			const listing = unwrap(result.body, "listing");
			if (args.includeInquiries !== true || listing.mine !== true) return json({ ok: true, listing });
			const inquiries = await client.call(
				{ method: "GET", path: "/inquiries", query: { listingId: id, role: "seller" } },
				ctx.signal,
			);
			if (!inquiries.ok) return failure(inquiries.error);
			return json({ ok: true, listing, inquiries: items(inquiries.body) });
		},
	);

	register(
		"publish",
		"Create, update, pause or resume your own market listing; requires owner approval.",
		publishParameters,
		async (args, ctx, client) => {
			if (args.ownerApproved !== true) return failure("approval_required");
			const action = args.action as string;
			const id = args.id as string | undefined;
			const listing = args.listing === undefined ? undefined : record(args.listing);
			if (action === "create") {
				if (!listing) return failure("invalid_request", { missing: ["listing"] });
				const missing = ["kind", "category", "title", "description", "price", "location"].filter(
					(key) => listing[key] === undefined,
				);
				if (missing.length) return failure("invalid_request", { missing });
				return composed(await client.call({ method: "POST", path: "/listings", body: listing }, ctx.signal));
			}
			if (!id) return failure("invalid_request", { missing: ["id"] });
			if (action === "update") {
				if (!listing || !Object.keys(listing).length) return failure("invalid_request", { missing: ["listing"] });
				return composed(
					await client.call(
						{ method: "PATCH", path: `/listings/${encodeURIComponent(id)}`, body: listing },
						ctx.signal,
					),
				);
			}
			if (action === "pause" || action === "resume")
				return composed(
					await client.call({ method: "POST", path: `/listings/${encodeURIComponent(id)}/${action}` }, ctx.signal),
				);
			return failure("invalid_request");
		},
	);

	register(
		"inquire",
		"List, read, open or answer market inquiries; sending requires owner approval.",
		inquireParameters,
		async (args, ctx, client) => {
			const action = args.action as string;
			const body = args.body as string | undefined;
			const listingId = args.listingId as string | undefined;
			const inquiryId = args.inquiryId as string | undefined;
			if (action === "list")
				return composed(
					await client.call(
						{
							method: "GET",
							path: "/inquiries",
							query: listingId === undefined ? {} : { listingId },
						},
						ctx.signal,
					),
				);
			if (action === "read") {
				if (!inquiryId) return failure("invalid_request", { missing: ["inquiryId"] });
				return composed(
					await client.call({ method: "GET", path: `/inquiries/${encodeURIComponent(inquiryId)}` }, ctx.signal),
				);
			}
			if (action !== "send" && action !== "reply") return failure("invalid_request");
			if (args.ownerApproved !== true) return failure("approval_required");
			if (!body) return failure("invalid_request", { missing: ["body"] });
			if (action === "send") {
				if (!listingId) return failure("invalid_request", { missing: ["listingId"] });
				return composed(
					await client.call(
						{ method: "POST", path: `/listings/${encodeURIComponent(listingId)}/inquiries`, body: { body } },
						ctx.signal,
					),
				);
			}
			if (!inquiryId) return failure("invalid_request", { missing: ["inquiryId"] });
			return composed(
				await client.call(
					{ method: "POST", path: `/inquiries/${encodeURIComponent(inquiryId)}/messages`, body: { body } },
					ctx.signal,
				),
			);
		},
	);

	register(
		"watch",
		"Manage market watch tasks; the cloud owns which results were already reported.",
		watchParameters,
		async (args, ctx, client) => {
			const action = args.action as string;
			const id = args.id as string | undefined;
			if (action === "create") {
				const brief = args.brief === undefined ? undefined : record(args.brief);
				if (!brief) return failure("invalid_request", { missing: ["brief"] });
				const created = await client.call(
					{
						method: "POST",
						path: "/watch-tasks",
						body: {
							brief,
							frequency: (args.frequency as string | undefined) ?? "daily",
							active: args.active ?? true,
							...(args.title === undefined ? {} : { title: args.title }),
						},
					},
					ctx.signal,
				);
				if (!created.ok) return failure(created.error);
				await deps.watch.apply(unwrap(created.body, "task"), ctx.agent);
				return composed(created);
			}
			if (action === "list") {
				const listed = await client.call({ method: "GET", path: "/watch-tasks" }, ctx.signal);
				if (!listed.ok) return failure(listed.error);
				await deps.watch.reconcile(items(listed.body), ctx.agent);
				return composed(listed);
			}
			if (!id) return failure("invalid_request", { missing: ["id"] });
			const path = `/watch-tasks/${encodeURIComponent(id)}`;
			if (action === "delete") {
				const removed = await client.call({ method: "DELETE", path }, ctx.signal);
				if (!removed.ok) return failure(removed.error);
				await deps.watch.remove(id);
				return json({ ok: true, id, deleted: true });
			}
			if (action === "check") {
				const checked = await client.call({ method: "POST", path: `${path}/check` }, ctx.signal);
				if (!checked.ok) return failure(checked.error);
				await deps.watch.checked(id);
				return json({ ok: true, items: items(checked.body) });
			}
			if (action !== "update") return failure("invalid_request");
			const patch: Record<string, unknown> = {
				...(args.brief === undefined ? {} : { brief: args.brief }),
				...(args.frequency === undefined ? {} : { frequency: args.frequency }),
				...(args.active === undefined ? {} : { active: args.active }),
				...(args.title === undefined ? {} : { title: args.title }),
			};
			if (!Object.keys(patch).length)
				return failure("invalid_request", { missing: ["brief", "frequency", "active", "title"] });
			const updated = await client.call({ method: "PATCH", path, body: patch }, ctx.signal);
			if (!updated.ok) return failure(updated.error);
			await deps.watch.apply(unwrap(updated.body, "task"), ctx.agent);
			return composed(updated);
		},
	);
}
