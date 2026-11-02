// Tool capabilities and the lazy-group registry are runtime-level facts (L1): the runtime reads them while
// building a session's tool surface, so they live in runtime/tool-catalog.ts. Kept here as the tools-side entry.
export { coreToolCapabilities, lazyGroupMatchers, lazyGroupOf } from "@yonder/runtime-adapter/runtime/tool-catalog.js";
