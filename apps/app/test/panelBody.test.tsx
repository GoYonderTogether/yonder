import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { PanelKind } from "../src/work/lib/layout";
import type { SessionView } from "../src/work/lib/useSession";
import { PanelBody } from "../src/work/ui/PanelBody";

const empty = { todos: [], subtasks: [] } as unknown as SessionView;

test.each(["todos", "goal", "attachments", "context", "wake"] as PanelKind[])("%s 空状态不露出开发说明", (kind) => {
	const html = renderToStaticMarkup(<PanelBody kind={kind} v={empty} session="s" />);
	expect(html).not.toMatch(/需要 |\.updated|views\.list|events\.query|attachments\.put|契约/);
	expect(html.length).toBeGreaterThan(0);
});
