import {
	type AutocompleteItem,
	type AutocompleteSuggestions,
	CombinedAutocompleteProvider,
	fuzzyFilter,
	type SlashCommand,
} from "@earendil-works/pi-tui";

/** Localized command metadata uses pi's own fuzzy filter, completion and editor UI. */
export class CommandAutocomplete extends CombinedAutocompleteProvider {
	constructor(
		commands: SlashCommand[],
		basePath: string,
		private templates: () => Promise<AutocompleteItem[]> = async () => [],
	) {
		super(commands, basePath);
	}
	override async getSuggestions(
		lines: string[],
		row: number,
		col: number,
		options: { signal: AbortSignal; force?: boolean },
	): Promise<AutocompleteSuggestions | null> {
		const prefix = lines[row]?.slice(0, col) ?? "";
		if (!/^\/[^\s/]*$/.test(prefix)) return super.getSuggestions(lines, row, col, options);
		const all = await super.getSuggestions(["/"], 0, 1, options);
		if (!all) return null;
		return {
			prefix,
			items: fuzzyFilter(
				[
					...all.items,
					...(await this.templates()).filter((item) => !all.items.some((command) => command.value === item.value)),
				],
				prefix.slice(1),
				(item) => `${item.label} ${item.description ?? ""}`,
			),
		};
	}
}
