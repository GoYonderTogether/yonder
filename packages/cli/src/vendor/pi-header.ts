// MIT Copyright (c) 2025 Mario Zechner. pi-coding-agent 1.3.0.
// ThemedText and ExpandableText copied without layout/interaction changes.
import { Text } from "@earendil-works/pi-tui";

/**
 * Text whose content applies theme colors. Plain `Text` keeps the colors its string was built with, so
 * a theme change, or the system theme receiving the terminal's colors, would leave it stale. This
 * rebuilds the string from `build` after every invalidation, which the UI performs on theme changes.
 *
 * `build` must return the same content each time, apart from colors. Snapshot changing data before
 * creating the component, or call `invalidate()` after changing state that `build` reads.
 */
export class ThemedText extends Text {
	private readonly build: () => string;
	private stale = true;

	constructor(build: () => string, paddingX = 1, paddingY = 1) {
		super("", paddingX, paddingY);
		this.build = build;
	}

	override invalidate(): void {
		super.invalidate();
		this.stale = true;
	}

	override render(width: number): string[] {
		if (this.stale) {
			this.stale = false;
			this.setText(this.build());
		}
		return super.render(width);
	}
}

export class ExpandableText extends ThemedText {
	private readonly state: { expanded: boolean };

	constructor(
		getCollapsedText: () => string,
		getExpandedText: () => string,
		expanded = false,
		paddingX = 0,
		paddingY = 0,
	) {
		const state = { expanded };
		super(() => (state.expanded ? getExpandedText() : getCollapsedText()), paddingX, paddingY);
		this.state = state;
	}

	setExpanded(expanded: boolean): void {
		this.state.expanded = expanded;
		this.invalidate();
	}
}
