import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { httpApi } from "../src/api/http";
import { Bubble, Composer, previewMessage } from "../src/pages/Chat";

afterEach(() => vi.unstubAllGlobals());

test("social history requests bounded latest, older and newer pages while preserving legacy sync", async () => {
	const fetch = vi.fn(async () => new Response("[]"));
	vi.stubGlobal("fetch", fetch);
	await httpApi.messages("c/d", { limit: 80 });
	await httpApi.messages("c/d", { before: 40, limit: 40 });
	await httpApi.messages("c/d", { since: 80, limit: 40 });
	await httpApi.messages("c/d");
	expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
		"/api/conversations/c%2Fd/messages?limit=80",
		"/api/conversations/c%2Fd/messages?before=40&limit=40",
		"/api/conversations/c%2Fd/messages?since=80&limit=40",
		"/api/conversations/c%2Fd/messages?since=0",
	]);
});

test("bubble exposes a keyboard context menu and a row-hover timestamp without a permanent quote button", () => {
	const html = renderToStaticMarkup(
		<MemoryRouter>
			<Bubble
				m={{ id: "m1", convId: "c1", seq: 1, senderId: "u1", content: { type: "text", text: "正文" }, createdAt: 1000 }}
				actors={new Map()}
				onReply={() => {}}
				mine
				group={false}
				first
				last
			/>
		</MemoryRouter>,
	);
	expect(html).toContain('aria-label="消息操作，右键或长按也可打开"');
	expect(html).toContain("sr-only focus:not-sr-only");
	expect(html).toContain("group-hover/message:opacity-100");
	expect(html).toContain('dateTime="1970-01-01T00:00:01.000Z"');
	expect(html).not.toContain("引用这条消息");
	expect(html).not.toContain(">引用</button>");
});

test("cloud error messages render as accessible red notices outside a normal bubble", () => {
	const html = renderToStaticMarkup(
		<MemoryRouter>
			<Bubble
				m={{
					id: "m2",
					convId: "c1",
					seq: 2,
					senderId: "bot",
					content: { type: "error", text: "云端 Bot 当前不可用" },
					createdAt: 2000,
				}}
				actors={new Map()}
				onReply={() => {}}
				mine={false}
				group={false}
				first
				last
			/>
		</MemoryRouter>,
	);
	expect(html).toContain('role="alert"');
	expect(html).toContain("text-danger");
	expect(html).toContain("云端 Bot 当前不可用");
	expect(html).not.toContain("rounded-bubble");
	expect(html).not.toContain("bg-tone");
	expect(
		previewMessage({
			id: "m2",
			convId: "c1",
			seq: 2,
			senderId: "bot",
			content: { type: "error", text: "云端 Bot 当前不可用" },
			createdAt: 2000,
		}),
	).toBe("云端 Bot 当前不可用");
});

test("interactive actions use their own links and fall back to the legacy card link", () => {
	const html = renderToStaticMarkup(
		<MemoryRouter>
			<Bubble
				m={{
					id: "m3",
					convId: "c1",
					seq: 3,
					senderId: "bot",
					content: {
						type: "interactive",
						title: "下一步",
						body: "选择操作",
						actions: [
							{ id: "connect", label: "连接", link: "/connect" },
							{ id: "download", label: "下载" },
						],
						state: "pending",
						link: "/get",
					},
					createdAt: 3000,
				}}
				actors={new Map()}
				onReply={() => {}}
				mine={false}
				group={false}
				first
				last
			/>
		</MemoryRouter>,
	);
	expect(html).toContain('href="/connect"');
	expect(html).toContain('href="/get"');
});

test("cloud Composer reflects actual offline state while a device Bot keeps its delivery hint", () => {
	vi.stubGlobal("location", { search: "" });
	const renderComposer = (cloudBot: boolean, offline: boolean) =>
		renderToStaticMarkup(
			<QueryClientProvider client={new QueryClient()}>
				<MemoryRouter>
					<Composer convId="c1" cloudBot={cloudBot} offline={offline} onSend={() => {}} />
				</MemoryRouter>
			</QueryClientProvider>,
		);
	const cloudOffline = renderComposer(true, true);
	const cloudOnline = renderComposer(true, false);
	const deviceOffline = renderComposer(false, true);
	expect(cloudOffline).toContain('placeholder="云端 Bot 当前不可用"');
	expect(cloudOffline).not.toContain("上线后送达");
	expect(cloudOnline).toContain('placeholder="输入消息"');
	expect(deviceOffline).toContain('placeholder="Bot 离线，消息会在上线后送达"');
});
