import { afterEach, describe, expect, it, vi } from "vitest";
import { httpApi, SocialError } from "../../../src/work/api/social";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("social HTTP client", () => {
	it("uses the configured base, credentials, paths, methods and bodies", async () => {
		vi.stubEnv("VITE_SOCIAL_BASE", "https://social.example");
		const fetchMock = vi.fn().mockImplementation(async () => new Response("{}"));
		vi.stubGlobal("fetch", fetchMock);
		await httpApi.login({ email: "a@example.com", password: "secret" });
		await httpApi.actors(["a", "b"]);
		await httpApi.send("c/d", { type: "text", text: "hello" }, "m");
		await httpApi.joinGroup("token/1");
		await httpApi.saveDraft("card/1", { title: "Title", markdown: "body" });
		await httpApi.deleteCard("card/1");
		await httpApi.addFriend("a");
		await httpApi.resolve("actor", "a/b");
		const calls = fetchMock.mock.calls;
		expect(calls.map(([url, init]) => [url, init.method ?? "GET", init.credentials])).toEqual([
			["https://social.example/api/auth/login", "POST", "include"],
			["https://social.example/api/actors?ids=a%2Cb", "GET", "include"],
			["https://social.example/api/conversations/c%2Fd/messages", "POST", "include"],
			["https://social.example/api/groups/token%2F1/join", "POST", "include"],
			["https://social.example/api/cards/card%2F1/draft", "PUT", "include"],
			["https://social.example/api/cards/card%2F1", "DELETE", "include"],
			["https://social.example/api/friends", "POST", "include"],
			["https://social.example/api/resolve/actor/a%2Fb", "GET", "include"],
		]);
		expect(JSON.parse(calls[2][1].body)).toEqual({ content: { type: "text", text: "hello" }, replyTo: "m" });
	});

	it("uses same origin by default and maps server errors", async () => {
		vi.stubEnv("VITE_SOCIAL_BASE", "");
		const fetchMock = vi.fn().mockImplementation(async () => new Response('{"error":"forbidden"}', { status: 403 }));
		vi.stubGlobal("fetch", fetchMock);
		await expect(httpApi.cards()).rejects.toMatchObject({ name: "SocialError", status: 403, code: "forbidden" });
		await expect(httpApi.cards()).rejects.toBeInstanceOf(SocialError);
		expect(fetchMock).toHaveBeenCalledWith("/api/cards", { credentials: "include" });
	});

	it("preserves nullable 404 results", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(async () => new Response('{"error":"not_found"}', { status: 404 })),
		);
		await expect(httpApi.card("missing")).resolves.toBeNull();
		await expect(httpApi.messages("missing")).rejects.toMatchObject({ status: 404, code: "not_found" });
	});

	it("posts verification codes and account bindings to the code endpoints", async () => {
		vi.stubEnv("VITE_SOCIAL_BASE", "");
		const fetchMock = vi.fn().mockImplementation(async () => new Response('{"sent":true,"retryAfter":60}'));
		vi.stubGlobal("fetch", fetchMock);
		await expect(httpApi.sendCode({ kind: "phone", target: "13800001234", shareToken: "st" })).resolves.toEqual({
			sent: true,
			retryAfter: 60,
		});
		await httpApi.verifyCode({ kind: "email", target: "a@b.co", code: "123456" });
		await httpApi.sendBindCode("phone", "13800001234");
		await httpApi.confirmBindCode("email", "a@b.co", "123456");
		const calls = fetchMock.mock.calls as [string, { method: string; body: string }][];
		expect(calls.map(([url, init]) => [url, init.method])).toEqual([
			["/api/auth/code/send", "POST"],
			["/api/auth/code/verify", "POST"],
			["/api/me/phone/send-code", "POST"],
			["/api/me/email/confirm", "POST"],
		]);
		expect(calls.map(([, init]) => JSON.parse(init.body))).toEqual([
			{ kind: "phone", target: "13800001234", shareToken: "st" },
			{ kind: "email", target: "a@b.co", code: "123456" },
			{ phone: "13800001234" },
			{ email: "a@b.co", code: "123456" },
		]);
	});
});
