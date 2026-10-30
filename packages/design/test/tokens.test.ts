import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { darkTokens, lightTokens } from "../src/index.js";

/** 多行的值（弹簧曲线、聚焦阴影）在 CSS 里换行只为可读，比较时按空白归一。 */
const collapse = (value: string) => value.replace(/\s+/g, " ").trim();

test("CSS and TypeScript tokens match in both color schemes", () => {
	const css = readFileSync(new URL("../src/tokens.css", import.meta.url), "utf8");
	const [light, dark] = css.split("@media (prefers-color-scheme: dark)");
	const declarations = (text: string) =>
		Object.fromEntries(
			Array.from(text.matchAll(/(--[\w-]+):\s*([^;]+);/g), (match) => [match[1], collapse(match[2] ?? "")]),
		);
	const normalized = (tokens: Record<string, string>) =>
		Object.fromEntries(Object.entries(tokens).map(([name, value]) => [name, collapse(value)]));
	const lightCss = declarations(light ?? "");
	expect(lightCss).toEqual(normalized(lightTokens));
	expect({ ...lightCss, ...declarations(dark ?? "") }).toEqual(normalized(darkTokens));
});
