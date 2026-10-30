import { socialOrigin } from "../api/http";

export async function uploadMarketImage(file: File, progress: (value: number) => void): Promise<string> {
	if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size < 1 || file.size > 5 * 1024 * 1024) {
		throw new Error("请选择不超过 5 MB 的 JPEG、PNG 或 WebP 图片");
	}
	const response = await fetch(new URL("/api/market/uploads", socialOrigin()), {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ contentType: file.type, size: file.size }),
	});
	if (!response.ok) throw new Error("获取上传授权失败，请重试");
	const { uploadUrl, imageUrl, fields } = (await response.json()) as {
		uploadUrl: string;
		imageUrl: string;
		fields: Record<string, string>;
	};
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.append(key, value);
	data.append("file", file);
	await new Promise<void>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("POST", uploadUrl);
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) progress(Math.round((event.loaded / event.total) * 100));
		};
		xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("图片上传失败，请重试")));
		xhr.onerror = () => reject(new Error("图片上传失败，请检查网络"));
		xhr.send(data);
	});
	return imageUrl;
}
