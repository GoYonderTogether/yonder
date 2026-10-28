import { expect, it } from "vitest";
import { breakpointOf } from "../src/shell/useBreakpoint";

it("uses the specified breakpoint boundaries", () => {
	expect([639, 640, 1024, 1025].map(breakpointOf)).toEqual(["phone", "tablet", "tablet", "desktop"]);
});
