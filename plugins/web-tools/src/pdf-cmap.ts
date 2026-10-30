export type CMap = { map: Map<number, string>; codeBytes: number };

export function utf16(hex: string): string {
	const even = hex.length % 2 === 1 ? `0${hex}` : hex;
	const bytes = Buffer.from(even, "hex");
	if (bytes.length === 1) return String.fromCharCode(bytes[0] as number);
	const units: number[] = [];
	for (let index = 0; index + 1 < bytes.length; index += 2)
		units.push(((bytes[index] as number) << 8) | (bytes[index + 1] as number));
	return String.fromCharCode(...units);
}

function utf16Shift(hex: string, delta: number): string {
	const even = hex.length % 2 === 1 ? `0${hex}` : hex;
	const bytes = Buffer.from(even, "hex");
	const units: number[] = [];
	for (let index = 0; index + 1 < bytes.length; index += 2)
		units.push(((bytes[index] as number) << 8) | (bytes[index + 1] as number));
	if (units.length === 0) units.push(bytes[0] ?? 0);
	units[units.length - 1] = ((units[units.length - 1] as number) + delta) & 0xffff;
	return String.fromCharCode(...units);
}

export function parseCMap(source: string): CMap | undefined {
	const map = new Map<number, string>();
	const codespace = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(source);
	const width = codespace ? /<([0-9A-Fa-f]+)>/.exec(codespace[1] as string)?.[1] : undefined;
	const codeBytes = Math.max(1, width ? width.length / 2 : 1);
	for (const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
		const hex = [...(block[1] ?? "").matchAll(/<([0-9A-Fa-f]+)>/g)].map((item) => item[1] as string);
		for (let index = 0; index + 1 < hex.length; index += 2)
			map.set(Number.parseInt(hex[index] as string, 16), utf16(hex[index + 1] as string));
	}
	for (const block of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
		const tokens = [...(block[1] ?? "").matchAll(/<([0-9A-Fa-f]+)>|\[|\]/g)];
		for (let index = 0; index < tokens.length; ) {
			const low = tokens[index]?.[1];
			const high = tokens[index + 1]?.[1];
			if (!low || !high) {
				index++;
				continue;
			}
			const start = Number.parseInt(low, 16);
			const end = Math.min(Number.parseInt(high, 16), start + 0xffff);
			index += 2;
			const destination = tokens[index];
			if (destination?.[1]) {
				const base = destination[1];
				index++;
				for (let code = start; code <= end; code++) map.set(code, utf16Shift(base, code - start));
			} else if (destination?.[0] === "[") {
				index++;
				let code = start;
				while (index < tokens.length && tokens[index]?.[0] !== "]") {
					const single = tokens[index]?.[1];
					if (single) map.set(code++, utf16(single));
					index++;
				}
				index++;
			} else index++;
		}
	}
	return map.size ? { map, codeBytes } : undefined;
}
