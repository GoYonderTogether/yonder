import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { gatewaySettings, requestControl, setAccessTokenHash } from "@yonder/core";

export async function uiCommand(home: string, rotate: boolean, open: boolean, json: boolean): Promise<unknown> {
	const settings = await gatewaySettings(home);
	if (rotate) {
		const token = randomBytes(32).toString("base64url");
		await setAccessTokenHash(home, `sha256:${createHash("sha256").update(token).digest("hex")}`);
		const origin = settings.publicOrigins[0] ?? "";
		return {
			token,
			login: `${origin}${settings.basePath}login`,
			note: "shown once; the old token is now invalid. Paste it on the login page or POST it as JSON {token} to login; never put it in a URL (only one-time tickets work there)",
		};
	}
	const ticket = (await requestControl(home, { method: "gateway.ticket" })) as {
		token: string;
		port: number;
		basePath: string;
		expiresAt: string;
	};
	const url = `http://127.0.0.1:${ticket.port}/?token=${ticket.token}`;
	if (open) {
		const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
		spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
	}
	return json ? { url, expiresAt: ticket.expiresAt } : url;
}
