// Run: node export.mjs /path/to/node_modules/lucide-react
// Reads official 1.61.0 __iconData; exports only geometry, without a React runtime.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = resolve(process.argv[2]);
const destination = dirname(fileURLToPath(import.meta.url));
if (JSON.parse(await readFile(join(source, "package.json"), "utf8")).version !== "1.61.0")
	throw new Error("Expected lucide-react 1.61.0");
const icons = {
	pin: "pin",
	close: "x",
	history: "rotate-ccw-clock",
	arrow: "arrow-right",
	back: "arrow-left",
	check: "check",
	board: "panels-top-left",
};
const escapeAttribute = (text) =>
	String(text).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
let symbols =
	'<!-- Generated from lucide-react 1.61.0 official __iconData. ISC + Feather MIT; see assets/lucide/LICENSE. -->\n<svg class="symbols" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>\n';
for (const [id, name] of Object.entries(icons)) {
	const file = await readFile(join(source, `dist/esm/icons/${name}.mjs`), "utf8");
	const data = file.match(/const __iconData = ([\s\S]*?);\n/)[1];
	// Evaluate the upstream literal, not an application module or its React dependency.
	const icon = Function(`"use strict";return (${data});`)();
	symbols +=
		`<symbol id="i-${id}" viewBox="0 0 24 24">` +
		icon.node
			.map(
				([tag, attrs]) =>
					`<${tag} ${Object.entries(attrs)
						.filter(([key]) => key !== "key")
						.map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
						.join(" ")}/>`,
			)
			.join("") +
		"</symbol>\n";
}
symbols += "</defs></svg>";
await writeFile(join(destination, "symbols.svg"), symbols + "\n");
await writeFile(join(destination, "LICENSE"), await readFile(join(source, "LICENSE")));
