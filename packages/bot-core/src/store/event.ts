import { randomBytes } from "node:crypto";
import type { EventInput, Route, YEvent } from "@yonder/sdk";

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastTime = 0;
let entropy = 0n;
function ulid() {
	const now = Math.max(Date.now(), lastTime);
	entropy = now === lastTime ? entropy + 1n : BigInt(`0x${randomBytes(10).toString("hex")}`);
	lastTime = now;
	let value = (BigInt(now) << 80n) | entropy;
	let id = "";
	for (let i = 0; i < 26; i++, value >>= 5n) id = alphabet[Number(value & 31n)] + id;
	return id;
}

export const newEvent = (input: EventInput, routes?: Route[]): YEvent => ({
	...input,
	id: ulid(),
	ts: new Date().toISOString(),
	...(routes ? { routes } : {}),
});
