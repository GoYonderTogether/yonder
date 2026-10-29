import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { Actor } from "../src/api/types";
import { IdentityDetail } from "../src/components/IdentityDetail";

const bot = { id: "b1", kind: "agent", name: "E2E-J02-1", online: true } as Actor;
const render = (card?: { id: string; code: string; markdown: string; title?: string }) =>
	renderToStaticMarkup(
		<MemoryRouter>
			<IdentityDetail actor={bot} card={card} publicView />
		</MemoryRouter>,
	);

describe("名片页标题（JV2-J03-11）", () => {
	it("大标题显示名片标题，Bot 名退到副标题", () => {
		const html = render({ id: "c1", code: "3W0LX3", markdown: "r3 测试", title: "E2E r3 店" });
		expect(html).toMatch(/<h1[^>]*>E2E r3 店<\/h1>/);
		expect(html).toContain("E2E-J02-1");
	});
	it("没有名片标题时仍用账号名", () => {
		const html = render({ id: "c1", code: "3W0LX3", markdown: "x" });
		expect(html).toMatch(/<h1[^>]*>E2E-J02-1<\/h1>/);
	});
});
