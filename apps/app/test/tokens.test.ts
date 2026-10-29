import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("imports design tokens without redefining them", () => {
	const css = readFileSync(new URL("../src/work/styles.css", import.meta.url), "utf8");
	const tokens = readFileSync(new URL("../../../packages/design/src/tokens.css", import.meta.url), "utf8");
	const tokenNames = new Set(Array.from(tokens.matchAll(/(--[\w-]+):/g), (match) => match[1]));
	const declarations = Array.from(css.matchAll(/(--[\w-]+):\s*([^;]+);/g));

	expect(css).toContain('@import "@yonder/design/tokens.css";');
	expect(declarations.filter(([, name, value]) => tokenNames.has(name) && value.trim() !== `var(${name})`)).toEqual([]);
});
