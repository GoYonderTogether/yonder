import { mkdirSync, writeFileSync } from "node:fs";
import * as contract from "../dist/schema.js";

const dir = new URL("../schema/", import.meta.url);
mkdirSync(dir, { recursive: true });
const definitions = Object.fromEntries(Object.entries(contract).filter(([name]) => name.endsWith("Schema")));
const documents = {
	"execution-v1.json": {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		...contract.RpcMessageSchema,
		$defs: definitions,
	},
	"relay-v1.json": { $schema: "https://json-schema.org/draft/2020-12/schema", ...contract.RelayFrameSchema },
};
for (const [name, schema] of Object.entries(documents))
	writeFileSync(new URL(name, dir), `${JSON.stringify(schema, null, 2)}\n`);
