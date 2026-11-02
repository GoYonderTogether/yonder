import { randomUUID } from "node:crypto";
import { createStorageConformance } from "@earendil-works/pi-durable/testing";
import { executionContext } from "@yonder/sdk";
import type { Pool } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";

const { testPostgres } = await import(new URL("../../../cloud-host/src/test-postgres.ts", import.meta.url).href);

import { migratePostgresRuntime, PostgresStorage } from "./storage.js";

let database: { pool: Pool; close(): Promise<void> };
const context = executionContext(new AbortController().signal);
beforeAll(async () => {
	database = await testPostgres();
	await migratePostgresRuntime(database.pool);
}, 60000);
afterAll(async () => {
	await database?.close();
});
for (const entry of createStorageConformance({
	assertions: {
		ok: (value, message) => expect(value, message).toBeTruthy(),
		strictEqual: (actual, expected) => expect(actual).toBe(expected),
		deepEqual: (actual, expected) => expect(actual).toEqual(expected),
		partialDeepEqual: (actual, expected) => expect(actual).toMatchObject(expected as object),
		greaterThan: (actual, expected) => expect(actual).toBeGreaterThan(expected),
		rejects: async (operation, message) => {
			await expect(operation).rejects.toThrow(message);
		},
	},
	async withStorage(use) {
		const storage = await PostgresStorage.open(database.pool, "conformance", randomUUID(), context);
		try {
			await use(storage);
		} finally {
			await storage.close(context);
		}
	},
}))
	test(entry.name, entry.run);
