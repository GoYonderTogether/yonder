import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { httpApi } from "../src/api/http";
import { Bubble } from "../src/pages/Chat";

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
