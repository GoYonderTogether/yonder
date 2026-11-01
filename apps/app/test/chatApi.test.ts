import { afterEach, expect, it, vi } from "vitest";
import { chatApi, chatError, uploadGroupAvatar } from "../src/api/chat";

afterEach(() => vi.unstubAllGlobals());
function server(body: unknown = {}, status = 200) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(status === 204 ? null : JSON.stringify(body), { status })),
	);
	vi.stubGlobal("window", { dispatchEvent: vi.fn() });
}
it("encodes conversation and member IDs and sends mute duration only", async () => {
	server({ mutedUntil: 3600000 });
	await chatApi.mute("g/a", "u/b", 3600);
	expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/conversations/g%2Fa/members/u%2Fb/mute");
	expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ durationSeconds: 3600 });
});
it("sends independent explicit dissolve and owner leave actions", async () => {
	server(undefined, 204);
	await chatApi.dissolve("g");
	await chatApi.leave("g");
	expect(vi.mocked(fetch).mock.calls.map((call) => call[0])).toEqual([
		"/api/conversations/g/dissolve",
		"/api/conversations/g/leave",
	]);
	expect(vi.mocked(fetch).mock.calls.every((call) => call[1]?.method === "POST")).toBe(true);
});
it("encodes history keywords, inclusive/exclusive dates and sequence cursor", async () => {
	server({ items: [], hasMore: false });
	await chatApi.history("g", { q: "a & b", from: 100, to: 200, before: 37, kind: "image", limit: 40 });
	const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]), "https://host.test");
	expect(Object.fromEntries(url.searchParams)).toEqual({
		q: "a & b",
		from: "100",
		to: "200",
		before: "37",
		kind: "image",
		limit: "40",
	});
});
it("pins and announcements refer only to an existing message ID", async () => {
	server(undefined, 204);
	await chatApi.pinMessage("g", "m/2");
	await chatApi.unpinMessage("g", "m/2");
	await chatApi.setAnnouncement("g", null);
	expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/conversations/g/pins/m%2F2");
	expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe("PUT");
	expect(vi.mocked(fetch).mock.calls[1][1]?.method).toBe("DELETE");
	expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body))).toEqual({ messageId: null });
});
it("rejects invalid avatar files before asking for upload authorization", async () => {
	server();
	await expect(
		uploadGroupAvatar("g", new File(["data"], "x.svg", { type: "image/svg+xml" }), () => {}),
	).rejects.toThrow("5 MB");
	expect(fetch).not.toHaveBeenCalled();
});
it("uploads using the signed OSS form, bounds network time and returns the uploaded URL only after success", async () => {
	server({
		uploadUrl: "https://uploads.test/",
		imageUrl: "https://images.test/group.png",
		fields: { key: "group/object", policy: "signed" },
	});
	let data: FormData | undefined,
		timeout = 0;
	class Upload {
		status = 204;
		timeout = 0;
		upload: { onprogress?: (e: unknown) => void } = {};
		onload?: () => void;
		onerror?: () => void;
		ontimeout?: () => void;
		onabort?: () => void;
		open = vi.fn();
		send(form: FormData) {
			data = form;
			timeout = this.timeout;
			queueMicrotask(() => {
				this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 });
				this.onload?.();
			});
		}
	}
	vi.stubGlobal("XMLHttpRequest", Upload);
	const progress = vi.fn();
	await expect(uploadGroupAvatar("g", new File(["data"], "x.png", { type: "image/png" }), progress)).resolves.toBe(
		"https://images.test/group.png",
	);
	expect(data?.get("key")).toBe("group/object");
	expect(data?.get("file")).toBeInstanceOf(File);
	expect(timeout).toBe(60000);
	expect(progress).toHaveBeenCalledWith(50);
	expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ contentType: "image/png", size: 4 });
});
it("never reports a URL if the OSS upload fails or times out", async () => {
	server({
		uploadUrl: "https://uploads.test/",
		imageUrl: "https://images.test/group.png",
		fields: { key: "group/object" },
	});
	class Upload {
		status = 0;
		timeout = 0;
		upload = {};
		onload?: () => void;
		onerror?: () => void;
		ontimeout?: () => void;
		onabort?: () => void;
		open = vi.fn();
		send() {
			queueMicrotask(() => this.ontimeout?.());
		}
	}
	vi.stubGlobal("XMLHttpRequest", Upload);
	await expect(uploadGroupAvatar("g", new File(["data"], "x.png", { type: "image/png" }), () => {})).rejects.toThrow(
		"上传超时",
	);
});
it("shows localized backend errors without exposing internal codes", () => {
	expect(chatError(Object.assign(new Error("muted"), { status: 403 }))).toContain("禁言");
	expect(chatError(new Error("pin_limit"))).toContain("10");
	expect(chatError(new Error("invalid_request"))).toContain("检查");
	expect(chatError(Object.assign(new Error("not_found"), { status: 404 }))).toContain("尚未启用");
	expect(chatError(new Error("new_internal_error"))).toBe("操作失败，请重试");
});

it("updates only the current membership nickname and resets it with null", async () => {
	server({ nickname: "自己的群昵称" });
	await chatApi.setNickname("g", "自己的群昵称");
	await chatApi.setNickname("g", null);
	expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/conversations/g/me");
	expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe("PATCH");
	expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ nickname: "自己的群昵称" });
	expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toEqual({ nickname: null });
});
