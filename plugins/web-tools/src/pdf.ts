import { inflateSync } from "node:zlib";

/** Dependency-free PDF text extraction: object streams are inflated and text operators replayed in page order. */
const MAX_OBJECTS = 50_000;
const MAX_STREAM = 8 * 1024 * 1024;
const MAX_DECODED = 48 * 1024 * 1024;
const MAX_PAGES = 400;
const MAX_CHARS = 200_000;

export interface PdfText {
	text: string;
	pages: number;
	truncated: boolean;
	title?: string;
}

type PdfObject = { dict: string; text?: string };
type CMap = { map: Map<number, string>; codeBytes: number };
type Font = { cmap: CMap | null; widths: Map<number, number>; fallback: number };
type Shown = { text: string; width: number };
type Token =
	| { kind: "string"; bytes: number[] }
	| { kind: "number"; value: number }
	| { kind: "name"; value: string }
	| { kind: "array"; items: Token[] }
	| { kind: "op"; value: string };

const WHITESPACE = new Set([" ", "\n", "\r", "\t", "\f", "\v", "\0"]);
const DELIMITERS = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"]);
const SKIPPED_STREAM = /\/(?:Image|DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode)\b/;
const DEFAULT_WIDTH = 0.5;

export function isPdf(bytes: Uint8Array): boolean {
	return bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
}

function readObjects(raw: string): Map<number, PdfObject> {
	const objects = new Map<number, PdfObject>();
	const pattern = /(\d+)\s+\d+\s+obj\b/g;
	let budget = MAX_DECODED;
	for (let match = pattern.exec(raw); match && objects.size < MAX_OBJECTS; match = pattern.exec(raw)) {
		const number = Number(match[1]);
		const start = match.index + match[0].length;
		const endobj = raw.indexOf("endobj", start);
		const limit = endobj === -1 ? raw.length : endobj;
		const chunk = raw.slice(start, limit);
		const streamAt = /\bstream\r?\n/.exec(chunk);
		if (!streamAt) {
			objects.set(number, { dict: chunk });
			continue;
		}
		const dict = chunk.slice(0, streamAt.index);
		const dataStart = start + streamAt.index + streamAt[0].length;
		const declared = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
		const endstream = raw.indexOf("endstream", dataStart);
		const dataEnd = declared
			? Math.min(raw.length, dataStart + Number(declared[1]))
			: endstream === -1
				? limit
				: endstream;
		const body = raw.slice(dataStart, dataEnd);
		if (SKIPPED_STREAM.test(dict) || budget <= 0) {
			objects.set(number, { dict });
			continue;
		}
		const text = inflate(dict, body);
		if (text !== undefined) budget -= text.length;
		objects.set(number, text === undefined ? { dict } : { dict, text });
	}
	expandObjectStreams(objects);
	return objects;
}

function inflate(dict: string, body: string): string | undefined {
	if (!/\/Filter\b/.test(dict)) return body;
	if (!/\/FlateDecode\b/.test(dict)) return undefined;
	try {
		return inflateSync(Buffer.from(body, "latin1"), { maxOutputLength: MAX_STREAM }).toString("latin1");
	} catch {
		return undefined;
	}
}

function expandObjectStreams(objects: Map<number, PdfObject>) {
	for (const object of [...objects.values()]) {
		if (!/\/Type\s*\/ObjStm\b/.test(object.dict) || object.text === undefined) continue;
		const count = Number(/\/N\s+(\d+)/.exec(object.dict)?.[1] ?? 0);
		const first = Number(/\/First\s+(\d+)/.exec(object.dict)?.[1] ?? 0);
		if (!count || !first || first > object.text.length) continue;
		const pairs = [...object.text.slice(0, first).matchAll(/(\d+)\s+(\d+)/g)].slice(0, count);
		for (const [index, pair] of pairs.entries()) {
			const child = Number(pair[1]);
			if (objects.has(child)) continue;
			const offset = Number(pair[2]);
			const next = pairs[index + 1];
			const end = next ? first + Number(next[2]) : object.text.length;
			objects.set(child, { dict: object.text.slice(first + offset, end) });
		}
	}
}

function utf16(hex: string): string {
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

function parseCMap(source: string): CMap | undefined {
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

function fontCMaps(objects: Map<number, PdfObject>): Map<number, CMap> {
	const cmaps = new Map<number, CMap>();
	for (const [number, object] of objects) {
		const reference = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(object.dict);
		if (!reference) continue;
		const source = objects.get(Number(reference[1]))?.text;
		if (source === undefined) continue;
		const cmap = parseCMap(source);
		if (cmap) cmaps.set(number, cmap);
	}
	return cmaps;
}

function widthsOf(dict: string, objects: Map<number, PdfObject>): Map<number, number> {
	const widths = new Map<number, number>();
	const first = Number(/\/FirstChar\s+(\d+)/.exec(dict)?.[1] ?? 0);
	const indirect = /\/Widths\s+(\d+)\s+\d+\s+R/.exec(dict);
	const block =
		/\/Widths\s*\[([\s\S]*?)\]/.exec(dict)?.[1] ??
		(indirect ? /\[([\s\S]*?)\]/.exec(objects.get(Number(indirect[1]))?.dict ?? "")?.[1] : undefined);
	if (block === undefined) return widths;
	const values = block
		.trim()
		.split(/\s+/)
		.map(Number)
		.filter((value) => Number.isFinite(value));
	for (const [index, value] of values.entries()) widths.set(first + index, value / 1000);
	return widths;
}

function fontMetrics(objects: Map<number, PdfObject>, cmaps: Map<number, CMap>): Map<number, Font> {
	const fonts = new Map<number, Font>();
	for (const [number, object] of objects) {
		if (!/\/(?:Type\s*\/Font|ToUnicode|Widths)\b/.test(object.dict)) continue;
		fonts.set(number, {
			cmap: cmaps.get(number) ?? null,
			widths: widthsOf(object.dict, objects),
			fallback: DEFAULT_WIDTH,
		});
	}
	return fonts;
}

function resourcesOf(dict: string, objects: Map<number, PdfObject>): string {
	const indirect = /\/Resources\s+(\d+)\s+\d+\s+R/.exec(dict);
	return indirect ? (objects.get(Number(indirect[1]))?.dict ?? "") : dict;
}

function fontsOf(resources: string, objects: Map<number, PdfObject>): Map<string, number> {
	const fonts = new Map<string, number>();
	const indirect = /\/Font\s+(\d+)\s+\d+\s+R/.exec(resources);
	const block =
		/\/Font\s*<<([\s\S]*?)>>/.exec(resources)?.[1] ?? (indirect ? objects.get(Number(indirect[1]))?.dict : "");
	if (!block) return fonts;
	for (const entry of block.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g))
		fonts.set(entry[1] as string, Number(entry[2]));
	return fonts;
}

function contentsOf(dict: string): number[] {
	const array = /\/Contents\s*\[([\s\S]*?)\]/.exec(dict)?.[1];
	if (array !== undefined) return [...array.matchAll(/(\d+)\s+\d+\s+R/g)].map((item) => Number(item[1]));
	const single = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(dict);
	return single?.[1] ? [Number(single[1])] : [];
}

type Page = { number: number; contents: number[]; fonts: Map<string, Font | null> };

function pagesOf(objects: Map<number, PdfObject>, metrics: Map<number, Font>): Page[] {
	const pages: Page[] = [];
	for (const [number, object] of objects) {
		if (!/\/Type\s*\/Page\b(?!s)/.test(object.dict)) continue;
		const fonts = new Map<string, Font | null>();
		for (const [name, reference] of fontsOf(resourcesOf(object.dict, objects), objects))
			fonts.set(name, metrics.get(reference) ?? null);
		pages.push({ number, contents: contentsOf(object.dict), fonts });
	}
	return pages.sort((left, right) => left.number - right.number);
}

function globalFonts(objects: Map<number, PdfObject>, metrics: Map<number, Font>): Map<string, Font | null> {
	const fonts = new Map<string, Font | null>();
	for (const object of objects.values())
		for (const [name, reference] of fontsOf(resourcesOf(object.dict, objects), objects)) {
			if (fonts.get(name)) continue;
			fonts.set(name, metrics.get(reference) ?? null);
		}
	return fonts;
}

function literalBytes(source: string, start: number): { bytes: number[]; end: number } {
	const bytes: number[] = [];
	let depth = 1;
	let index = start + 1;
	while (index < source.length) {
		const character = source[index] as string;
		if (character === "\\") {
			const next = source[index + 1] as string | undefined;
			const escaped: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
			if (next !== undefined && escaped[next] !== undefined) {
				bytes.push(escaped[next] as number);
				index += 2;
				continue;
			}
			const octal = /^[0-7]{1,3}/.exec(source.slice(index + 1, index + 4));
			if (octal) {
				bytes.push(Number.parseInt(octal[0], 8) & 0xff);
				index += 1 + octal[0].length;
				continue;
			}
			index += next === "\r" && source[index + 2] === "\n" ? 3 : 2;
			continue;
		}
		if (character === "(") depth++;
		if (character === ")") {
			depth--;
			if (depth === 0) return { bytes, end: index + 1 };
		}
		bytes.push(character.charCodeAt(0) & 0xff);
		index++;
	}
	return { bytes, end: source.length };
}

function tokenize(source: string): Token[] {
	const tokens: Token[] = [];
	const arrays: Token[][] = [];
	const push = (token: Token) => {
		const top = arrays.at(-1);
		if (top) top.push(token);
		else tokens.push(token);
	};
	for (let index = 0; index < source.length; ) {
		const character = source[index] as string;
		if (WHITESPACE.has(character)) {
			index++;
			continue;
		}
		if (character === "%") {
			while (index < source.length && !"\r\n".includes(source[index] as string)) index++;
			continue;
		}
		if (character === "(") {
			const literal = literalBytes(source, index);
			push({ kind: "string", bytes: literal.bytes });
			index = literal.end;
			continue;
		}
		if (character === "<" && source[index + 1] === "<") {
			index += 2;
			continue;
		}
		if (character === ">" && source[index + 1] === ">") {
			index += 2;
			continue;
		}
		if (character === "<") {
			const close = source.indexOf(">", index);
			const end = close === -1 ? source.length : close;
			const hex = source.slice(index + 1, end).replace(/[^0-9A-Fa-f]/g, "");
			const bytes: number[] = [];
			for (let at = 0; at < hex.length; at += 2) bytes.push(Number.parseInt(hex.slice(at, at + 2).padEnd(2, "0"), 16));
			push({ kind: "string", bytes });
			index = end + 1;
			continue;
		}
		if (character === "[") {
			arrays.push([]);
			index++;
			continue;
		}
		if (character === "]") {
			push({ kind: "array", items: arrays.pop() ?? [] });
			index++;
			continue;
		}
		if (character === "/") {
			let end = index + 1;
			while (end < source.length) {
				const next = source[end] as string;
				if (WHITESPACE.has(next) || DELIMITERS.has(next)) break;
				end++;
			}
			push({ kind: "name", value: source.slice(index + 1, end) });
			index = end;
			continue;
		}
		if (character === "{" || character === "}") {
			index++;
			continue;
		}
		let end = index;
		while (end < source.length) {
			const next = source[end] as string;
			if (WHITESPACE.has(next) || DELIMITERS.has(next)) break;
			end++;
		}
		const word = source.slice(index, end);
		index = Math.max(end, index + 1);
		if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(word)) push({ kind: "number", value: Number(word) });
		else if (word) push({ kind: "op", value: word });
	}
	return tokens;
}

function decode(token: Token | undefined, font: Font | null): Shown {
	if (token?.kind !== "string") return { text: "", width: 0 };
	const widths = font?.widths;
	const fallback = font?.fallback ?? DEFAULT_WIDTH;
	let text = "";
	let width = 0;
	const cmap = font?.cmap ?? null;
	if (cmap) {
		const step = cmap.codeBytes;
		for (let index = 0; index + step <= token.bytes.length; index += step) {
			let code = 0;
			for (let offset = 0; offset < step; offset++) code = code * 256 + (token.bytes[index + offset] as number);
			text += cmap.map.get(code) ?? "";
			width += widths?.get(code) ?? fallback;
		}
		return { text, width };
	}
	for (const byte of token.bytes) {
		if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte !== 127)) text += String.fromCharCode(byte);
		width += widths?.get(byte) ?? fallback;
	}
	return { text, width };
}

function showText(tokens: Token[], fonts: Map<string, Font | null>): string {
	let text = "";
	let font: Font | null = null;
	let size = 12;
	let pen = 0;
	let origin = 0;
	let lineY: number | undefined;
	const operands: Token[] = [];
	const number = (token: Token | undefined) => (token?.kind === "number" ? token.value : 0);
	const gap = (advance: number) => (advance > 0.2 * size ? " " : "");
	const show = (token: Token | undefined) => {
		const shown = decode(token, font);
		text += shown.text;
		pen += shown.width * size;
	};
	for (const token of tokens) {
		if (token.kind !== "op") {
			operands.push(token);
			continue;
		}
		switch (token.value) {
			case "Tf": {
				const name = operands.at(-2);
				font = name?.kind === "name" ? (fonts.get(name.value) ?? null) : null;
				size = Math.abs(number(operands.at(-1))) || 12;
				break;
			}
			case "Td":
			case "TD": {
				const shiftY = number(operands.at(-1));
				const shiftX = number(operands.at(-2));
				if (Math.abs(shiftY) > 0.01) {
					text += "\n";
					origin += shiftX;
					pen = 0;
				} else {
					text += gap(shiftX - pen);
					origin += shiftX;
					pen = 0;
				}
				break;
			}
			case "Tm": {
				const y = number(operands.at(-1));
				const x = number(operands.at(-2));
				if (lineY !== undefined && Math.abs(y - lineY) > 0.01) text += "\n";
				else text += gap(x - origin - pen);
				origin = x;
				pen = 0;
				lineY = y;
				break;
			}
			case "T*":
				text += "\n";
				pen = 0;
				break;
			case "Tj":
				show(operands.at(-1));
				break;
			case "'":
			case '"':
				text += "\n";
				pen = 0;
				show(operands.at(-1));
				break;
			case "TJ": {
				const array = operands.at(-1);
				if (array?.kind !== "array") break;
				for (const item of array.items) {
					if (item.kind === "string") show(item);
					else if (item.kind === "number") {
						if (-item.value / 1000 > 0.2) text += " ";
						pen += (item.value / 1000) * size;
					}
				}
				break;
			}
			case "BT":
				if (text && !text.endsWith("\n")) text += "\n";
				pen = 0;
				break;
			default:
				break;
		}
		operands.length = 0;
	}
	return text;
}

function pdfTitle(objects: Map<number, PdfObject>): string | undefined {
	for (const object of objects.values()) {
		const literal = /\/Title\s*\(/.exec(object.dict);
		const hex = /\/Title\s*<([0-9A-Fa-f\s]+)>/.exec(object.dict);
		let title = "";
		if (literal)
			title = decode({ kind: "string", bytes: literalBytes(object.dict, literal.index + 7).bytes }, null).text;
		else if (hex) title = utf16((hex[1] as string).replace(/\s+/g, ""));
		title = [...title]
			.map((character) => (character.charCodeAt(0) < 32 ? " " : character))
			.join("")
			.trim();
		if (title) return title.slice(0, 200);
	}
	return undefined;
}

function cleanup(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.replace(/[ \t\f\v\u00a0]+/g, " ").trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/^\n+/, "")
		.trim();
}

/** Text of a PDF as page-ordered plain text; encrypted or image-only files yield empty text. */
export function extractPdfText(bytes: Uint8Array): PdfText {
	const raw = Buffer.from(bytes).toString("latin1");
	const objects = readObjects(raw);
	const metrics = fontMetrics(objects, fontCMaps(objects));
	const pages = pagesOf(objects, metrics);
	const parts: string[] = [];
	if (pages.length) {
		for (const page of pages.slice(0, MAX_PAGES)) {
			for (const reference of page.contents) {
				const content = objects.get(reference)?.text;
				if (content === undefined) continue;
				parts.push(showText(tokenize(content), page.fonts));
			}
		}
	} else {
		const fallback = globalFonts(objects, metrics);
		for (const [, object] of [...objects].sort((left, right) => left[0] - right[0])) {
			if (object.text === undefined || !/BT[\s\S]*ET/.test(object.text)) continue;
			parts.push(showText(tokenize(object.text), fallback));
		}
	}
	const text = cleanup(parts.join("\n\n"));
	const title = pdfTitle(objects);
	return {
		text: text.slice(0, MAX_CHARS),
		pages: Math.max(pages.length, 1),
		truncated: text.length > MAX_CHARS,
		...(title ? { title } : {}),
	};
}
