import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { darkTokens, lightTokens } from "../src/index.js";

test("CSS and TypeScript tokens match in both color schemes", () => {
	const css = readFileSync(new URL("../src/tokens.css", import.meta.url), "utf8");
	const [light, dark] = css.split("@media (prefers-color-scheme: dark)");
	const declarations = (text: string) =>
		Object.fromEntries(Array.from(text.matchAll(/(--[\w-]+):\s*([^;]+);/g), (match) => [match[1], match[2]]));
	const lightCss = declarations(light ?? "");
	expect(lightCss).toEqual(lightTokens);
	expect({ ...lightCss, ...declarations(dark ?? "") }).toEqual(darkTokens);
});
