export type CredentialSlots = Readonly<Record<string, string>>;
export type SlotSource = { kind: "stored" } | { kind: "env-ref"; variable: string };
export interface SlotMetadata {
	provider: string;
	slot: string;
	configured: boolean;
	type?: import("@earendil-works/pi-ai").Credential["type"];
	sourceKind: SlotSource["kind"];
}
export interface LoginTicket {
	provider: string;
	slot: string;
	generation: string;
	replace: boolean;
}

export function validateSlotPart(value: string): void {
	if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) || ["constructor", "prototype", "__proto__"].includes(value))
		throw new Error("Invalid credential provider or slot");
}
