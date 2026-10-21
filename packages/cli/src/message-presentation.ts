import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import {
	backgroundAnsi,
	type Component,
	colorToRgb,
	mixColors,
	rgbColor,
	stripTerminalSequences,
	type TuiMouseEvent,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { nativeTheme } from "./pi-native.js";

// Codex rust-v0.160.1 history_cell/messages.rs: subdued inline gutter, continuation indent.
// Content and wrapping remain the native pi component's responsibility.
const zoneStart = "\x1b]133;A\x07";
const zoneEnd = "\x1b]133;B\x07\x1b]133;C\x07";
const zones = [zoneStart, "\x1b]133;B\x07", "\x1b]133;C\x07"];
const empty = (line: string) => !stripTerminalSequences(line).trim();

export class MessagePresentation implements Component {
	private leading = 0;
	private inset = 0;
	constructor(
		private content: Component,
		private marker: string,
		private user = false,
	) {}
	invalidate(): void {
		this.content.invalidate?.();
	}
	render(width: number): string[] {
		const theme = nativeTheme.theme;
		const marker = truncateToWidth(this.marker, Math.max(1, width - 3), "…");
		this.inset = visibleWidth(marker) + 2;
		const raw = this.content.render(Math.max(1, width - this.inset - 1));
		const hasZone = raw.some((line) => line.includes(zoneStart));
		const lines = raw.map((line) => zones.reduce((text, zone) => text.replaceAll(zone, ""), line));
		this.leading = 0;
		while (lines.length && empty(lines[0] ?? "")) {
			lines.shift();
			this.leading++;
		}
		while (lines.length && empty(lines[lines.length - 1] ?? "")) lines.pop();
		if (!lines.length) return [];
		const bgColor = theme.colors.userMessageBg;
		const { r, g, b } = colorToRgb(bgColor);
		const light = (r + g + b) / 3 > 127;
		// Codex style.rs blends submitted prompts with the terminal background; keep a visible gray fill.
		const gray = mixColors(bgColor, light ? rgbColor(0, 0, 0) : rgbColor(255, 255, 255), light ? 0.08 : 0.16, "srgb");
		const bg = backgroundAnsi(gray, theme.getColorMode());
		const rows = lines.map((line, index) => {
			const prefix = this.user || index === 0 ? ` ${theme.fg("dim", marker)} ` : " ".repeat(this.inset);
			let row = truncateToWidth(prefix + line, width, "");
			if (this.user) {
				row = row
					.replaceAll(theme.getBgAnsi("userMessageBg"), bg)
					.replaceAll("\x1b[49m", `\x1b[49m${bg}`)
					.replaceAll("\x1b[0m", `\x1b[0m${bg}`);
				row = `${bg}${row}${" ".repeat(Math.max(0, width - visibleWidth(row)))}\x1b[49m`;
			}
			return row;
		});
		if (hasZone) {
			rows[0] = zoneStart + rows[0];
			rows[rows.length - 1] += zoneEnd;
		}
		return ["", ...rows]; // Exactly one unshaded separator between messages.
	}
	handleMouse(event: TuiMouseEvent) {
		if (event.y < 1 || event.x < this.inset) return undefined;
		return this.content.handleMouse?.({
			...event,
			x: event.x - this.inset,
			y: event.y - 1 + this.leading,
			width: Math.max(1, event.width - this.inset - 1),
		});
	}
}

/** Keep pi's real call/result renderer; collapse execution output to one factual summary. */
export class CompactToolExecution extends ToolExecutionComponent {
	private detailsVisible = false;
	private state = "等待";
	private failed = false;
	onToggle?: () => void;
	override setExpanded(expanded: boolean): void {
		super.setExpanded(expanded);
		this.detailsVisible = expanded;
	}
	override markExecutionStarted(): void {
		super.markExecutionStarted();
		this.state = "执行中";
	}
	override updateResult(result: Parameters<ToolExecutionComponent["updateResult"]>[0], partial = false): void {
		super.updateResult(result, partial);
		this.failed = result.isError;
		this.state = result.isError ? "失败" : partial ? "执行中" : "完成";
	}
	override render(width: number): string[] {
		const lines = super.render(width);
		if (this.detailsVisible) return lines;
		const call = lines.find((line) => !empty(line));
		if (!call) return [];
		return [
			"",
			nativeTheme.theme.fg(
				this.failed ? "error" : "dim",
				truncateToWidth(` ↳ ${stripTerminalSequences(call).trim()} · ${this.state}`, width, "…"),
			),
		];
	}
	override handleMouse(event: TuiMouseEvent): ReturnType<ToolExecutionComponent["handleMouse"]> {
		if (!this.detailsVisible && event.type === "click" && event.button === "left" && event.y > 0) {
			this.setExpanded(true);
			this.onToggle?.();
			return {
				handled: true,
				target: {
					component: this,
					originX: event.screenX - event.x,
					originY: event.screenY - event.y,
					width: event.width,
					height: event.height,
				},
			};
		}
		return super.handleMouse(event);
	}
}
