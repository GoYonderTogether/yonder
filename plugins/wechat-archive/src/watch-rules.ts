export interface WatchRules {
	keywords: string[];
	exclude?: string[];
}
export function watchMatches(text: string, rules: WatchRules): boolean {
	const value = text.normalize("NFC");
	return (
		!rules.exclude?.some((word) => value.includes(word.normalize("NFC"))) &&
		rules.keywords.some((word) => value.includes(word.normalize("NFC")))
	);
}
