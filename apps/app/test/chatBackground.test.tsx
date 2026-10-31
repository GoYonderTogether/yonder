import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatBackgroundSettings } from "../src/components/chat/ChatBackgroundSettings";
import {
	backgroundStyle,
	chatBackgroundKey,
	loadChatBackground,
	saveChatBackground,
	useChatBackground,
	validateBackgroundFile,
} from "../src/lib/chatBackground";

/** Controlled native-IDB-shaped test double; production code only uses browser IndexedDB. */
function database() {
	const rows = new Map<string, unknown>();
	let failWrite = false;
	let failRead = false;
	const keys: unknown[] = [];
	const closed = vi.fn();
	const open = vi.fn(() => {
		const request: { result: unknown; onsuccess?: () => void; onerror?: () => void } = {
			result: {
				close: closed,
				objectStoreNames: { contains: () => true },
				transaction: (_name: string, mode: string) => {
					const transaction: {
						oncomplete?: () => void;
						onerror?: () => void;
						onabort?: () => void;
						objectStore: () => unknown;
					} = {
						objectStore: () => ({
							get: (key: unknown) => operation(key, "get"),
							put: (value: unknown, key: unknown) => operation(key, "put", value),
							delete: (key: unknown) => operation(key, "delete"),
						}),
					};
					function operation(key: unknown, kind: string, value?: unknown) {
						keys.push(key);
						const request: { result: unknown } = {
							result:
								kind === "get" ? structuredClone(rows.get(JSON.stringify(key))) : kind === "put" ? key : undefined,
						};
						queueMicrotask(() => {
							if ((mode === "readwrite" && failWrite) || (mode === "readonly" && failRead)) {
								transaction.onabort?.();
								return;
							}
							if (kind === "put") rows.set(JSON.stringify(key), structuredClone(value));
							if (kind === "delete") rows.delete(JSON.stringify(key));
							transaction.oncomplete?.();
						});
						return request;
					}
					return transaction;
				},
			},
		};
		queueMicrotask(() => request.onsuccess?.());
		return request;
	});
	return {
		open,
		blockReads: () => {
			failRead = true;
		},
		resumeReads: () => {
			failRead = false;
		},
		keys,
		closed,
		rows,
		fail: () => {
			failWrite = true;
		},
	};
}
let db: ReturnType<typeof database>, container: HTMLElement, root: Root;
const revoked = vi.fn(),
	created = vi.fn();
beforeEach(() => {
	db = database();
	vi.stubGlobal("indexedDB", { open: db.open });
	vi.stubGlobal("fetch", vi.fn());
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	created.mockImplementation(() => `blob:private-${created.mock.calls.length}`);
	vi.spyOn(URL, "createObjectURL").mockImplementation(created);
	vi.spyOn(URL, "revokeObjectURL").mockImplementation(revoked);
});
afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	created.mockReset();
	revoked.mockReset();
});
async function flush() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}
function Background({ account, conv = "c" }: { account?: string; conv?: string }) {
	const bg = useChatBackground(account, conv);
	return <output style={bg.style} data-loading={bg.loading} />;
}
async function show(account: string | undefined, conv = "c") {
	await act(() => root.render(<Background account={account} conv={conv} />));
	await flush();
}
it("isolates preferences using account and conversation composite keys", async () => {
	await saveChatBackground("a", "c", { kind: "preset", preset: "sage" });
	await saveChatBackground("b", "c", { kind: "preset", preset: "sand" });
	await saveChatBackground("a", "other", { kind: "preset", preset: "dusk" });
	expect(await loadChatBackground("a", "c")).toEqual({ kind: "preset", preset: "sage" });
	expect(await loadChatBackground("b", "c")).toEqual({ kind: "preset", preset: "sand" });
	expect(await loadChatBackground("a", "other")).toEqual({ kind: "preset", preset: "dusk" });
	expect(chatBackgroundKey("a:c", "d")).not.toEqual(chatBackgroundKey("a", "c:d"));
	expect(db.keys).toContainEqual(["a", "c"]);
	expect(fetch).not.toHaveBeenCalled();
});
it("stores photos as Blob and resets only this conversation while releasing its stored photo", async () => {
	const image = new Blob(["photo"], { type: "image/png" });
	await saveChatBackground("a", "c", { kind: "image", image });
	await saveChatBackground("b", "c", { kind: "preset", preset: "dusk" });
	const stored = await loadChatBackground("a", "c");
	expect(stored.kind).toBe("image");
	if (stored.kind === "image") expect(stored.image).toBeInstanceOf(Blob);
	await saveChatBackground("a", "c", { kind: "preset", preset: "default" });
	expect(db.rows.has(JSON.stringify(["a", "c"]))).toBe(false);
	expect(await loadChatBackground("a", "c")).toEqual({ kind: "preset", preset: "default" });
	expect(await loadChatBackground("b", "c")).toEqual({ kind: "preset", preset: "dusk" });
	expect(fetch).not.toHaveBeenCalled();
});
it("does not claim success or replace the previous stored preference after a failed transaction", async () => {
	await saveChatBackground("a", "c", { kind: "preset", preset: "sage" });
	db.fail();
	await expect(saveChatBackground("a", "c", { kind: "preset", preset: "sand" })).rejects.toThrow("存储权限");
	expect(await loadChatBackground("a", "c")).toEqual({ kind: "preset", preset: "sage" });
	expect(db.closed).toHaveBeenCalled();
});
it("validates images before opening a database and leaves the default theme untouched", async () => {
	expect(backgroundStyle({ kind: "preset", preset: "default" })).toEqual({});
	expect(validateBackgroundFile(new Blob(["x"], { type: "image/svg+xml" }))).toContain("5 MB");
	await expect(
		saveChatBackground("a", "c", { kind: "image", image: new Blob(["bad"], { type: "text/plain" }) }),
	).rejects.toThrow("JPEG");
	expect(db.open).not.toHaveBeenCalled();
	await expect(saveChatBackground("", "c", { kind: "preset", preset: "sage" })).rejects.toThrow("先登录");
});
it("removes custom object URLs on account switch and never displays another account photo", async () => {
	await saveChatBackground("a", "c", { kind: "image", image: new Blob(["photo"], { type: "image/png" }) });
	await show("a");
	expect(container.querySelector("output")?.getAttribute("style")).toContain("blob:private-");
	const old = created.mock.results[0].value;
	await show("b");
	expect(container.querySelector("output")?.getAttribute("style") ?? "").not.toContain("blob:private-");
	expect(revoked).toHaveBeenCalledWith(old);
	await show(undefined);
	expect(container.querySelector("output")?.getAttribute("style") ?? "").not.toContain("blob:");
});
it("updates live backgrounds only after a successful commit", async () => {
	await saveChatBackground("a", "c", { kind: "preset", preset: "sage" });
	await show("a");
	const old = container.querySelector("output")?.getAttribute("style");
	await act(async () => saveChatBackground("a", "c", { kind: "preset", preset: "sand" }));
	await flush();
	expect(container.querySelector("output")?.getAttribute("style")).not.toBe(old);
	const saved = container.querySelector("output")?.getAttribute("style");
	db.fail();
	await expect(saveChatBackground("a", "c", { kind: "preset", preset: "dusk" })).rejects.toThrow();
	await flush();
	expect(container.querySelector("output")?.getAttribute("style")).toBe(saved);
});
it("requires Apply for previews and shows storage failure without closing the settings", async () => {
	await saveChatBackground("a", "c", { kind: "preset", preset: "sage" });
	const applied = vi.fn(),
		busy = vi.fn();
	await act(() =>
		root.render(
			<ChatBackgroundSettings accountId="a" convId="c" busy={false} onBusyChange={busy} onApplied={applied} />,
		),
	);
	await flush();
	const radio = container.querySelector('input[value="sand"]') as HTMLElement;
	const key = Object.keys(radio).find((k) => k.startsWith("__reactProps$"));
	await act(() => (radio as unknown as Record<string, { onChange(): void }>)[key ?? ""].onChange());
	expect(await loadChatBackground("a", "c")).toEqual({ kind: "preset", preset: "sage" });
	db.fail();
	const apply = [...container.querySelectorAll("button")].find((el) => el.textContent === "应用");
	await act(async () => {
		apply?.dispatchEvent(new window.Event("click", { bubbles: true }));
	});
	expect(applied).not.toHaveBeenCalled();
	expect(container.querySelector('[role="alert"]')?.textContent).toContain("存储权限");
	expect(busy).toHaveBeenLastCalledWith(false);
	expect(await loadChatBackground("a", "c")).toEqual({ kind: "preset", preset: "sage" });
});

it("does not implicitly clear an unread stored background and can retry reading it", async () => {
	await saveChatBackground("a", "c", { kind: "preset", preset: "sage" });
	db.blockReads();
	const applied = vi.fn();
	await act(() =>
		root.render(
			<ChatBackgroundSettings accountId="a" convId="c" busy={false} onBusyChange={() => {}} onApplied={applied} />,
		),
	);
	await flush();
	const apply = [...container.querySelectorAll("button")].find((el) => el.textContent === "应用") as HTMLButtonElement;
	expect(apply.disabled).toBe(true);
	expect(db.rows.has(JSON.stringify(["a", "c"]))).toBe(true);
	db.resumeReads();
	const retry = [...container.querySelectorAll("button")].find((el) => el.textContent === "重新读取");
	await act(async () => {
		retry?.dispatchEvent(new window.Event("click", { bubbles: true }));
	});
	await flush();
	expect((container.querySelector('input[value="sage"]') as HTMLInputElement).checked).toBe(true);
	expect(await loadChatBackground("a", "c")).toEqual({ kind: "preset", preset: "sage" });
	expect(applied).not.toHaveBeenCalled();
});
it("drops an unapplied draft when the account changes even if its parent stays mounted", async () => {
	await saveChatBackground("a", "c", { kind: "preset", preset: "sage" });
	await saveChatBackground("b", "c", { kind: "preset", preset: "dusk" });
	const props = { convId: "c", busy: false, onBusyChange: () => {}, onApplied: () => {} };
	await act(() => root.render(<ChatBackgroundSettings {...props} accountId="a" />));
	await flush();
	const radio = container.querySelector('input[value="sand"]') as HTMLElement;
	const key = Object.keys(radio).find((k) => k.startsWith("__reactProps$"));
	await act(() => (radio as unknown as Record<string, { onChange(): void }>)[key ?? ""].onChange());
	await act(() => root.render(<ChatBackgroundSettings {...props} accountId="b" />));
	await flush();
	expect((container.querySelector('input[value="dusk"]') as HTMLInputElement).checked).toBe(true);
	expect((container.querySelector('input[value="sand"]') as HTMLInputElement).checked).toBe(false);
	expect(await loadChatBackground("a", "c")).toEqual({ kind: "preset", preset: "sage" });
});
