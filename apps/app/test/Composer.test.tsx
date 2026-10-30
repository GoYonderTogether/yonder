import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Composer } from "../src/work/ui/Composer";

test("a running task defaults to steering and retains explicit queue and interrupt choices", () => {
	const html = renderToStaticMarkup(<Composer session="task" running />);
	expect(html).toMatch(/aria-pressed="true"[^>]*>插话/);
	expect(html).toMatch(/aria-pressed="false"[^>]*>排队/);
	expect(html).toMatch(/aria-pressed="false"[^>]*>打断/);
});

test("unconfirmed connection keeps draft editable while disabling submit and abort", () => {
	const html = renderToStaticMarkup(<Composer session="offline-task" running />);
	expect(html).toMatch(/disabled=""[^>]*data-testid="abort"/);
	expect(html).toMatch(/disabled=""[^>]*aria-label="发送"/);
	expect(html).toMatch(/<textarea(?![^>]*disabled)/);
});
