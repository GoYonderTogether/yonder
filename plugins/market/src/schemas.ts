import type { TSchema } from "@yonder/sdk";
import { Type } from "typebox";

/** 契约 contracts §19.7 的工具参数 schema，逐字对应，不额外增删字段。 */

const Kind = Type.Union(["item", "service", "request", "idea", "job"].map((value) => Type.Literal(value)));
const Cat = Type.Union(
	["数码好物", "生活方式", "创意服务", "技能与陪伴", "户外出行"].map((value) => Type.Literal(value)),
);
const Id = Type.String({ minLength: 1, maxLength: 64 });
const Budget = Type.Object(
	{
		text: Type.String({ minLength: 1, maxLength: 500 }),
		category: Type.Union([Cat, Type.Literal("any")]),
		budget: Type.Number({ minimum: 0 }),
		location: Type.String({ maxLength: 32 }),
		priority: Type.Union([Type.Literal("best"), Type.Literal("price"), Type.Literal("local")]),
	},
	{ additionalProperties: false },
);
const Listing = Type.Object(
	{
		kind: Type.Optional(Kind),
		category: Type.Optional(Cat),
		title: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
		description: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
		price: Type.Optional(Type.Number({ minimum: 0 })),
		unit: Type.Optional(Type.String({ maxLength: 16 })),
		images: Type.Optional(Type.Array(Type.String({ maxLength: 500 }), { maxItems: 9 })),
		sellerRole: Type.Optional(Type.String({ maxLength: 32 })),
		location: Type.Optional(Type.String({ maxLength: 32 })),
		tags: Type.Optional(Type.Array(Type.String({ maxLength: 24 }), { maxItems: 10 })),
		facts: Type.Optional(Type.Array(Type.Object({ label: Type.String(), value: Type.String() }), { maxItems: 12 })),
		delivery: Type.Optional(Type.String({ maxLength: 200 })),
		missing: Type.Optional(Type.Array(Type.String(), { maxItems: 10 })),
		discoverable: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);

export const searchParameters: TSchema = Type.Object(
	{
		q: Type.Optional(Type.String({ maxLength: 200 })),
		kind: Type.Optional(Kind),
		category: Type.Optional(Cat),
		city: Type.Optional(Type.String({ maxLength: 32 })),
		min: Type.Optional(Type.Number({ minimum: 0 })),
		max: Type.Optional(Type.Number({ minimum: 0 })),
		sort: Type.Optional(Type.Union(["relevance", "newest", "price_asc", "price_desc"].map((v) => Type.Literal(v)))),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
		cursor: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

export const getParameters: TSchema = Type.Object(
	{ id: Id, includeInquiries: Type.Optional(Type.Boolean()) },
	{ additionalProperties: false },
);

export const publishParameters: TSchema = Type.Object(
	{
		action: Type.Union(["create", "update", "pause", "resume"].map((value) => Type.Literal(value))),
		id: Type.Optional(Id),
		listing: Type.Optional(Listing),
		ownerApproved: Type.Boolean(),
	},
	{ additionalProperties: false },
);

export const inquireParameters: TSchema = Type.Object(
	{
		action: Type.Union(["send", "reply", "list", "read"].map((value) => Type.Literal(value))),
		listingId: Type.Optional(Id),
		inquiryId: Type.Optional(Id),
		body: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
		ownerApproved: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);

export const watchParameters: TSchema = Type.Object(
	{
		action: Type.Union(["create", "list", "update", "delete", "check"].map((value) => Type.Literal(value))),
		id: Type.Optional(Id),
		brief: Type.Optional(Budget),
		frequency: Type.Optional(Type.Union(["hourly", "daily", "manual"].map((value) => Type.Literal(value)))),
		active: Type.Optional(Type.Boolean()),
		title: Type.Optional(Type.String({ maxLength: 22 })),
	},
	{ additionalProperties: false },
);
