// Uses an existing, authorized kernel and preset. No credentials or configuration changes.
// Usage: node submit-acceptance.mjs INSTALL HOME CHAT ARTIFACT_DIR [PRESET]
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [install, home, chat, assets, preset = "p1-channel"] = process.argv.slice(2);
if (!assets) throw Error("Expected INSTALL HOME CHAT ARTIFACT_DIR [PRESET]");
const { requestControl } = await import(
	pathToFileURL(join(resolve(install), "packages/core/dist/control/index.js")).href
);
const call = (method, params) => requestControl(resolve(home), { method, params });
const session = await call("sessions.open", { preset, close: "manual" });
const files = [
	["image", "skill-creator.png", "image/png"],
	["file", "channel-feishu-readme.md", "text/markdown"],
	["audio", "channel-check.ogg", "audio/ogg"],
	["video", "channel-check.mp4", "video/mp4"],
].map(([kind, name, mime]) => ({ kind, name, mime, uri: pathToFileURL(join(resolve(assets), name)).href }));
const text = `执行获准的P1飞书已有渠道输出验收。只向 conv:feishu:${chat} 发送，instance=feishu，禁止其他目标、文件变更或额外工具。依次：
1. channel-feishu_status确认实例状态。
2. 用channel-feishu_message发一条文字“**P1 Markdown验收**\\n真实渠道已有能力检查。”。
3. 对以下4个附件逐个调用channel-feishu_message，text为空，每次只带该附件：${JSON.stringify(files)}。
4. 调channel-feishu_card发送原生卡片：${JSON.stringify({
	config: { wide_screen_mode: true },
	elements: [
		{ tag: "div", text: { tag: "lark_md", content: "**P1 普通卡片与按钮回调验收**" } },
		{
			tag: "action",
			actions: [
				{
					tag: "button",
					text: { tag: "plain_text", content: "P1 回调验收" },
					type: "primary",
					value: { acceptance: "P1" },
				},
			],
		},
	],
})}。
每项以真实工具结果为准；失败保留，不盲目重发成功或uncertain项。执行后只输出NO_REPLY，避免重复气泡。不把API成功称为客户端打开或播放成功。`;
const receipt = await call("sessions.submit", { id: session.id, text });
const report = { session, receipt, chat };
const output = join(resolve(assets), `session-${session.id}.json`);
await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ session: session.id, output, receipt }));
