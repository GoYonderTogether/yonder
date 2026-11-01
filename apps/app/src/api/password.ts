import { request } from "./http";
import type { CodeSent, CodeVerifyInput, Session, VerifyKind } from "./types";

const json = (body: unknown) => ({
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(body),
});
export async function ensureRegistrationSupported() {
	const capability = await request<{ passwordRegistration?: unknown }>("/auth/password/capabilities");
	if (capability?.passwordRegistration !== true) throw new Error("password_registration_unavailable");
}
export const passwordApi = {
	login: (identifier: string, password: string) =>
		request<Session>("/auth/password/login", json({ identifier, password })),
	async register(input: CodeVerifyInput & { password: string }): Promise<Session> {
		await ensureRegistrationSupported();
		const result = await request<Session & { passwordSet?: unknown }>("/auth/code/verify", json(input));
		if (result?.passwordSet !== true) throw new Error("password_registration_unconfirmed");
		return result;
	},
	sendResetCode: (kind: VerifyKind) => request<CodeSent>("/me/password/code/send", json({ kind })),
	reset: (kind: VerifyKind, code: string, password: string) =>
		request<Session>("/me/password/reset", json({ kind, code, password })),
};
