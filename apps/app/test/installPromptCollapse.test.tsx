import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { connectionPrompt, Install } from "../src/pages/Install";

afterEach(() => vi.unstubAllGlobals());

it("folds the prompt without changing its contents or copy action", () => {
	vi.stubGlobal("location", { origin: "https://example.com" });
	const html = renderToStaticMarkup(
		<MemoryRouter>
			<Install />
		</MemoryRouter>,
	);
	expect(html).toContain("<details");
	expect(html).toContain("查看提示词");
	expect(html).toContain("复制提示词");
	expect(connectionPrompt("1234567890")).toContain("yonder channels login card --verify-code 1234567890");
});
