import { definePlugin, type PluginAPI, type ToolContext } from "@yonder/sdk";
import { Type } from "typebox";
import { recommend, type Policy } from "./advisory.js";

const schema = Type.Object({
 enabled: Type.Optional(Type.Boolean({ default: false })),
 adminApproved: Type.Optional(Type.Boolean({ default: false })),
 classifier: Type.Optional(Type.Object({ provider: Type.String(), id: Type.String() })),
 allowedClassifierModels: Type.Optional(Type.Array(Type.String(), { default: [] })),
 allowedClassifierOrigins: Type.Optional(Type.Array(Type.String({ format: "uri" }), { default: [] })),
 allowedAgents: Type.Optional(Type.Array(Type.String(), { default: [] })),
 allowedConversations: Type.Optional(Type.Array(Type.String(), { default: [] })),
 targetModels: Type.Optional(Type.Array(Type.String(), { default: [] })),
 budgetUsd: Type.Optional(Type.Number({ minimum: 0 })),
 classifierCostBoundUsd: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
 routeCostBoundsUsd: Type.Optional(Type.Record(Type.String(), Type.Number({ exclusiveMinimum: 0 }))),
 summaryMaxBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 4096, default: 1024 })),
 timeoutMs: Type.Optional(Type.Integer({ minimum: 50, maximum: 30000, default: 3000 })),
}, { additionalProperties: false });
type Config = { enabled?: boolean; adminApproved?: boolean; classifier?: {provider:string;id:string}; allowedClassifierModels?: string[]; allowedClassifierOrigins?: string[]; allowedAgents?: string[]; allowedConversations?: string[]; targetModels?: string[]; budgetUsd?:number; classifierCostBoundUsd?:number; routeCostBoundsUsd?:Record<string,number>; summaryMaxBytes?: number; timeoutMs?: number };
const inputSchema = Type.Object({
 summary: Type.String({ minLength: 1, maxLength: 4096, description: "Explicitly approved short task summary only; never include conversation history." }),
 routes: Type.Array(Type.Object({ id: Type.String({pattern:"^[a-z][a-z0-9_-]*$"}), model: Type.String(), effort: Type.String(), description: Type.String() }), { minItems: 1, maxItems: 12 }),
 defaultRoute: Type.String(), ownerChoice: Type.Optional(Type.String()),
}, { additionalProperties: false });

export default definePlugin({
 configSchema: schema,
 setup(api: PluginAPI) {
  const c = (api.config ?? {}) as Config;
  if (c.enabled !== true || c.adminApproved !== true || !c.classifier || !c.allowedClassifierModels?.length || !c.allowedClassifierOrigins?.length) api.log.info("decision routing remains disabled until explicitly admin-approved and configured");
  api.tools.register({
   name: "decision-routing_recommend", description: "Return an advisory model/effort recommendation. Never applies it or submits a target request.",
   parameters: inputSchema, capabilities: ["admin", "network"],
   async execute(raw: unknown, ctx: ToolContext) {
    if (c.enabled !== true || c.adminApproved !== true || !c.classifier || !c.allowedClassifierModels?.length || !c.allowedClassifierOrigins?.length) return {text:"decision_routing_disabled_or_unapproved",isError:true};
    if (!ctx.capabilities.includes("admin") || !ctx.capabilities.includes("network")) return {text:"permission_denied",isError:true};
    if (!c.allowedAgents?.includes(ctx.agent ?? "") || !c.allowedConversations?.includes(ctx.event?.conv ?? "")) return {text:"caller_not_allowlisted",isError:true};
    const a = raw as {summary:string;routes:Policy["routes"];defaultRoute:string;ownerChoice?:string};
    try {
     const routes = a.routes;
     const targetModels = c.targetModels ?? [];
     if (routes.some(r => !targetModels.includes(r.model))) return {text:"target_model_not_allowlisted",isError:true};
     const resolutions = new Map<string,{requested:string;effective:string;reason:string}>();
     const catalog = routes.map(r => {
      const [provider,id] = r.model.split("/",2);
      if (!provider || !id || r.model.split("/").length !== 2) throw new Error("invalid_target_model");
      const model = api.models.getModelOfType("chat", provider, id);
      if (!model) throw new Error("target_model_not_in_catalog");
      const requested = r.effort;
      // SDK catalogs expose reasoning support, not each vendor's full effort enum. Do not claim provider-level application.
      const effective = model.reasoning ? requested : "off";
      resolutions.set(r.id,{requested,effective,reason:model.reasoning ? "catalog_reasoning_supported_not_applied" : "target_model_does_not_support_reasoning"});
      return { ...r, effort: effective as typeof r.effort };
     });
     const now=Date.now(), expiry=now+60000;
     if (!Number.isFinite(c.budgetUsd) || !Number.isFinite(c.classifierCostBoundUsd) || !c.routeCostBoundsUsd) return {text:"cost_bounds_not_admin_configured",isError:true};
     const policy: Policy = { routes: catalog, defaultRoute:a.defaultRoute, allowedModels:targetModels, allowedEfforts:["off","minimal","low","medium","high","xhigh","max"], allowedClassifierModels:c.allowedClassifierModels!, allowedClassifierOrigins:c.allowedClassifierOrigins!, maxInputBytes:c.summaryMaxBytes??1024, timeoutMs:c.timeoutMs??3000, minConfidence:0.7, budgetUsd:c.budgetUsd!, routeCostBounds:Object.fromEntries(catalog.map(r=>[r.id,{usd:c.routeCostBoundsUsd?.[r.id] ?? NaN,expires:expiry}])), classifierCostBound:{usd:c.classifierCostBoundUsd!,expires:expiry} };
     const result=await recommend(api.models,c.classifier!,policy,{summary:a.summary,...(a.ownerChoice ? {ownerChoice:a.ownerChoice} : {}),capabilities:ctx.capabilities,signal:ctx.signal});
     const route = "route" in result ? resolutions.get(result.route.id) : undefined;
     return {text:JSON.stringify({recommendation:result,...route,applied:false})};
    } catch(e) { return {text:e instanceof Error ? e.message : "recommendation_failed",isError:true}; }
   }
  });
 }
});
