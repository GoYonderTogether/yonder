import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { type OwnerBinding, OwnerTranscript } from "../src/components/chat/OwnerTranscript";

const state = vi.hoisted(() => ({ ready: true }));
vi.mock("../src/work/lib/useSession", () => ({
	useSession: () => ({
		ready: state.ready,
		items: [],
		hasMore: false,
		loadOlder: () => {},
		hasNewer: false,
		loadNewer: () => {},
		loadingOlder: false,
	}),
}));
vi.mock("../src/work/ui/Transcript", () => ({
	Transcript: () => <div className="scroll-y min-h-0 flex-1">完整会话</div>,
}));
const binding: OwnerBinding = { sessionId: "owner-session", target: { deviceId: "device" } };
afterEach(() => {
	state.ready = true;
});
it("applies local photo backgrounds to PA transcript without adding a second scroll owner", () => {
	const html = renderToStaticMarkup(
		<OwnerTranscript
			binding={binding}
			onQuote={() => {}}
			backgroundStyle={{ backgroundImage: "url(blob:local-background)", backgroundSize: "cover" }}
		/>,
	);
	expect(html).toContain("social-owner-transcript flex min-h-0 flex-1 flex-col");
	expect(html).toContain('data-chat-background="image"');
	expect(html).toContain("background-image:url(blob:local-background)");
	expect(html.match(/scroll-y/g)).toHaveLength(1);
});
it("keeps default appearance unset and applies a selected backdrop while the transcript loads", () => {
	expect(renderToStaticMarkup(<OwnerTranscript binding={binding} onQuote={() => {}} />)).not.toContain("style=");
	state.ready = false;
	const html = renderToStaticMarkup(
		<OwnerTranscript binding={binding} onQuote={() => {}} backgroundStyle={{ backgroundColor: "#eaf0e9" }} />,
	);
	expect(html).toContain("background-color:#eaf0e9");
	expect(html).toContain("正在加载完整会话");
});
