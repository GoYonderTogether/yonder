import { expect, it } from "vitest";
import { parseGlobal } from "./index.js";

it("parses wrapper login argv with quoted home as global option, not an unknown argument", () => {
	const home = "/tmp/yonder home 'quoted'";
	expect(parseGlobal(["login", "openai", "--home", home])).toEqual({
		json: false,
		help: false,
		home,
		rest: ["login", "openai"],
	});
});
