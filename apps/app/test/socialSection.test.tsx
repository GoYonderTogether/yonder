import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { SocialSection } from "../src/work/features/settings/SocialSection";

const rpc = vi.hoisted(() => vi.fn());
// useBotNames 走 lib/queries，链到 api/stream 的 wsUrl，所以要保留真模块再替换 rpc。
vi.mock("../src/work/api/client", async (importOriginal) => ({ ...(await importOriginal<object>()), rpc }));

const GROUPS = [
	{
		conv: "conv:wx:g1",
		title: "产品群",
		mode: "batch",
		tags: { value: "medium", rhythm: "normal" },
		lastActiveAt: "2026-10-29T04:00:00.000Z",
	},
	{
		conv: "conv:qq:g2",
		mode: "record",
		tags: { value: "low", rhythm: "low" },
		lastActiveAt: "2026-10-28T04:00:00.000Z",
	},
];

const POLICY = {
	policy: { mode: "batch", tags: { value: "medium", rhythm: "normal" }, judge: { preset: "cheap" } },
	sources: { mode: "group", tags: "conversation", judge: "group" },
	revision: "rev-1",
};

/** 走 React 挂在节点上的 onChange prop 输入：linkedom 不派发 React 认的 input 事件。 */
async function type(input: HTMLInputElement, value: string) {
	const key = Object.keys(input).find((k) => k.startsWith("__reactProps$"));
	const props = (input as unknown as Record<string, { onChange?(e: { target: { value: string } }): void }>)[key ?? ""];
	if (!props?.onChange) throw new Error("input has no React onChange prop");
	await act(async () => props.onChange?.({ target: { value } }));
}

function renderSection() {
	const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", window.document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const container = window.document.getElementById("root") as unknown as HTMLElement;
	const root = createRoot(container);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const button = (text: string) =>
		[...container.querySelectorAll("button")].find((el) => el.textContent?.includes(text)) as
			| HTMLButtonElement
			| undefined;
	const click = async (el: HTMLButtonElement | undefined) => {
		if (!el) throw new Error("button missing");
		await act(async () => el.dispatchEvent(new window.Event("click", { bubbles: true })));
	};
	return {
		window,
		container,
		client,
		button,
		click,
		start: async () => {
			await act(async () => {
				root.render(
					<QueryClientProvider client={client}>
						<SocialSection />
					</QueryClientProvider>,
				);
			});
		},
		stop: async () => {
			await act(async () => root.unmount());
			client.clear();
			vi.unstubAllGlobals();
			rpc.mockReset();
		},
	};
}

test("lists the default bot's groups with mode and tags, then edits one after a dry-run preview", async () => {
	const app = renderSection();
	rpc.mockImplementation(async (method: string, params: Record<string, unknown>) => {
		if (method === "bots.list") return { bots: [{ agent: "main", name: "主 Bot" }] };
		if (method === "social.groups") return GROUPS;
		if (method === "social.inspect") return POLICY;
		if (method === "social.update" && params.dryRun === true)
			return {
				before: POLICY.policy,
				after: { ...POLICY.policy, mode: "mention" },
				affected: [params.conv],
				revision: "rev-1",
			};
		if (method === "social.update" && params.dryRun === false)
			return {
				before: POLICY.policy,
				after: { ...POLICY.policy, mode: "mention" },
				affected: [params.conv],
				revision: "rev-2",
			};
		throw new Error(`Unexpected ${method}`);
	});
	try {
		await app.start();
		await vi.waitFor(() => expect(app.container.textContent).toContain("产品群"));
		expect(app.container.textContent).toContain("主 Bot");
		expect(rpc).toHaveBeenCalledWith("social.groups", { agent: "main" });
		// 群列表是默认层：模式与标签都是生效值。
		expect(app.container.textContent).toContain("打包合并");
		expect(app.container.textContent).toContain("价值 中 · 节奏 正常");

		await app.click(app.button("产品群"));
		await vi.waitFor(() => expect(app.container.textContent).toContain("监听模式"));
		expect(rpc).toHaveBeenCalledWith("social.inspect", { agent: "main", conv: "conv:wx:g1" });
		// 覆盖层：mode 来自群默认，tags 来自会话覆盖。
		expect(app.container.textContent).toContain("默认（group）");
		expect(app.container.textContent).toContain("会话覆盖");
		expect(app.container.textContent).toContain("预设 cheap");

		await app.click(app.button("只看 @"));
		const reason = app.container.querySelector("input") as HTMLInputElement;
		await type(reason, "这个群只该在 @ 我时提醒");
		expect(app.button("预览改动")?.disabled).toBe(false);
		await app.click(app.button("预览改动"));
		await vi.waitFor(() => expect(app.container.querySelector("[data-testid='social-preview']")).not.toBeNull());
		expect(app.container.textContent).toContain("打包合并 / 价值 中 · 节奏 正常 → 只看 @ / 价值 中 · 节奏 正常");
		expect(rpc).toHaveBeenCalledWith("social.update", {
			agent: "main",
			conv: "conv:wx:g1",
			expectedRevision: "rev-1",
			patch: { mode: "mention" },
			reason: "这个群只该在 @ 我时提醒",
			dryRun: true,
		});

		await app.click(app.button("确认应用"));
		await vi.waitFor(() =>
			expect(rpc).toHaveBeenCalledWith("social.update", {
				agent: "main",
				conv: "conv:wx:g1",
				expectedRevision: "rev-1",
				patch: { mode: "mention" },
				reason: "这个群只该在 @ 我时提醒",
				dryRun: false,
			}),
		);
		await vi.waitFor(() => expect(app.container.querySelector("[data-testid='social-preview']")).toBeNull());
	} finally {
		await app.stop();
	}
});

test("keeps the other tag dimension when only one is changed, and blocks apply without a reason", async () => {
	const app = renderSection();
	rpc.mockImplementation(async (method: string, params: Record<string, unknown>) => {
		if (method === "bots.list") return { bots: [{ agent: "main", name: "主 Bot" }] };
		if (method === "social.groups") return GROUPS;
		if (method === "social.inspect") return POLICY;
		if (method === "social.update" && params.dryRun === true)
			return {
				before: POLICY.policy,
				after: { ...POLICY.policy, tags: { value: "high", rhythm: "normal" } },
				affected: [params.conv],
				revision: "rev-1",
			};
		throw new Error(`Unexpected ${method}`);
	});
	try {
		await app.start();
		await vi.waitFor(() => expect(app.container.textContent).toContain("产品群"));
		await app.click(app.button("产品群"));
		await vi.waitFor(() => expect(app.container.textContent).toContain("监听模式"));

		// 没有原因时不能预览；没有预览时不能应用。
		await app.click(app.button("价值 高"));
		expect(app.button("预览改动")?.disabled).toBe(true);
		expect(app.button("确认应用")?.disabled).toBe(true);

		const reason = app.container.querySelector("input") as HTMLInputElement;
		await type(reason, "把价值提到高");
		expect(app.button("预览改动")?.disabled).toBe(false);
		await app.click(app.button("预览改动"));
		await vi.waitFor(() =>
			expect(rpc).toHaveBeenCalledWith("social.update", {
				agent: "main",
				conv: "conv:wx:g1",
				expectedRevision: "rev-1",
				patch: { tags: { value: "high", rhythm: "normal" } },
				reason: "把价值提到高",
				dryRun: true,
			}),
		);
		expect(app.button("确认应用")?.disabled).toBe(false);
	} finally {
		await app.stop();
	}
});
