import { isAvatarUrl } from "../../api/avatarUrl";
import type { CardFace } from "../../api/types";
import markUrl from "../../assets/brand/yonder-mark.svg";
import { THEMES } from "./themes";

export interface CardImageInput {
	name: string;
	avatarUrl?: string;
	onAvatarError?: () => void;
	agent?: boolean;
	online?: boolean;
	headline?: string | null;
	face?: CardFace;
	qr: HTMLCanvasElement;
}

/** 保存二维码名片，与 CardQrView 相同字段、尺寸和位置，不导出介绍封面。 */
export async function renderCardImage({
	name,
	avatarUrl,
	onAvatarError,
	agent,
	online,
	headline,
	face,
	qr,
}: CardImageInput): Promise<string> {
	await document.fonts.ready;
	const t = THEMES[face?.theme ?? "mist"];
	const W = 720,
		H = Math.round((W * 4.3) / 3),
		u = W / 100;
	const canvas = document.createElement("canvas");
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext("2d")!;
	const family = getComputedStyle(document.documentElement).getPropertyValue("--font-sans") || "sans-serif";
	ctx.beginPath();
	ctx.roundRect(0, 0, W, H, 8 * u);
	ctx.clip();
	ctx.fillStyle = t.bg;
	ctx.fillRect(0, 0, W, H);
	ctx.fillStyle = t.fg;
	ctx.textAlign = "center";
	ctx.textBaseline = "top";
	const text = (value: string, y: number, size: number, weight = 400, alpha = 1, header = false) => {
		ctx.fillStyle = t.fg;
		ctx.globalAlpha = alpha;
		ctx.font = `${weight} ${size * u}px ${family}`;
		ctx.textAlign = header ? "left" : "center";
		let line = value;
		while (ctx.measureText(line).width > (header ? 68 : 84) * u && line.length) line = line.slice(0, -1);
		ctx.fillText(line === value ? line : line.slice(0, -1) + "…", (header ? 24 : 50) * u, y * u);
	};
	const loadImage = async (url: string): Promise<HTMLImageElement> => {
		// Reload the original URL so an ordinary <img> cache entry cannot omit CORS headers.
		const response = await fetch(url, { mode: "cors", cache: "reload", referrerPolicy: "no-referrer" });
		if (!response.ok) throw new Error("Image unavailable");
		const objectUrl = URL.createObjectURL(await response.blob());
		try {
			return await new Promise<HTMLImageElement>((resolve, reject) => {
				const image = new Image();
				image.onload = () => resolve(image);
				image.onerror = reject;
				image.src = objectUrl;
			});
		} finally {
			URL.revokeObjectURL(objectUrl);
		}
	};
	let avatar: HTMLImageElement | undefined;
	if (avatarUrl && isAvatarUrl(avatarUrl)) {
		try {
			avatar = await loadImage(avatarUrl);
		} catch {
			onAvatarError?.();
		}
	}
	ctx.save();
	ctx.beginPath();
	ctx.roundRect(8 * u, 9 * u, 12 * u, 12 * u, (agent ? 3 : 6) * u);
	ctx.clip();
	ctx.fillStyle = agent ? "#111111" : t.avbg;
	ctx.fillRect(8 * u, 9 * u, 12 * u, 12 * u);
	if (avatar) {
		const side = Math.min(avatar.naturalWidth, avatar.naturalHeight);
		ctx.drawImage(
			avatar,
			(avatar.naturalWidth - side) / 2,
			(avatar.naturalHeight - side) / 2,
			side,
			side,
			8 * u,
			9 * u,
			12 * u,
			12 * u,
		);
	} else if (agent) {
		const mark = await loadImage(markUrl);
		ctx.filter = "brightness(0) invert(1)";
		ctx.drawImage(mark, 9.5 * u, 10.5 * u, 9 * u, 9 * u);
		ctx.filter = "none";
	} else {
		ctx.fillStyle = t.avfg;
		ctx.font = `700 ${5 * u}px ${family}`;
		ctx.textBaseline = "middle";
		ctx.fillText([...name][0] ?? "", 14 * u, 15 * u);
	}
	ctx.restore();
	ctx.fillStyle = t.fg;
	ctx.textBaseline = "top";
	// Header starts after the avatar; QR position and quiet zone stay unchanged.
	text(name, 9, 7, 700, 1, true);
	text(agent ? `Bot · ${online ? "在线" : "离线"}` : "个人名片", 20, 3.8, 400, 0.7, true);
	ctx.font = `400 ${4 * u}px ${family}`;
	const words = [...(headline ?? "")];
	let line = "",
		y = 28;
	for (const char of words) {
		if (ctx.measureText(line + char).width > 84 * u) {
			text(line, y, 4, 400, 0.8);
			y += 5.6;
			line = "";
			if (y > 34) break;
		}
		line += char;
	}
	if (y <= 34) text(line, y, 4, 400, 0.8);
	ctx.globalAlpha = 1;
	ctx.fillStyle = "#ffffff";
	ctx.beginPath();
	ctx.roundRect(12 * u, 43 * u, 76 * u, 76 * u, 4 * u);
	ctx.fill();
	ctx.drawImage(qr, 16 * u, 47 * u, 68 * u, 68 * u);
	text("扫码查看资料", 129, 3.8, 400, 0.7);
	return canvas.toDataURL("image/png");
}
