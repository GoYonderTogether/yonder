#!/usr/bin/env node
import { connectDsh, DEFAULT_ENDPOINT, removeDsh } from "./index.js";

const USAGE = `用法：yonder-connect <harness> [选项]

  dsh                       把 DeepSeek Harness 接入 Yonder 账号
  dsh --remove              卸载连接器并清除本机连接状态

选项：
  --endpoint <url>          Yonder 服务地址（默认 ${DEFAULT_ENDPOINT}；也可用 YONDER_ENDPOINT）
  --profile <name>          安装到哪个 DSH profile（默认：唯一的非 desktop profile）
  --spec <spec>             安装来源（默认 @yonder/dsh-connector@latest；可给本地 tarball 路径）
  --no-open                 不自动打开浏览器，只打印确认链接
  --interval-ms <ms>        等待确认时的轮询间隔（默认 2000）
  -h, --help                显示本帮助`;

interface Args {
	command?: string;
	remove: boolean;
	endpoint?: string;
	profile?: string;
	spec?: string;
	noOpen: boolean;
	intervalMs?: number;
	help: boolean;
}

function parse(argv: string[]): Args {
	const args: Args = { remove: false, noOpen: false, help: false };
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index] ?? "";
		const take = (name: string) => {
			const next = argv[index + 1];
			if (next === undefined || next.startsWith("--")) throw new Error(`${name} 需要一个值`);
			index += 1;
			return next;
		};
		switch (value) {
			case "-h":
			case "--help":
				args.help = true;
				break;
			case "--remove":
				args.remove = true;
				break;
			case "--no-open":
				args.noOpen = true;
				break;
			case "--endpoint":
				args.endpoint = take("--endpoint");
				break;
			case "--profile":
				args.profile = take("--profile");
				break;
			case "--spec":
				args.spec = take("--spec");
				break;
			case "--interval-ms": {
				const raw = take("--interval-ms");
				const parsed = Number(raw);
				if (!Number.isInteger(parsed) || parsed < 100) throw new Error("--interval-ms 需要大于等于 100 的整数");
				args.intervalMs = parsed;
				break;
			}
			default:
				if (value.startsWith("-")) throw new Error(`未知选项 ${value}`);
				if (args.command) throw new Error(`只接受一个 harness，收到「${args.command}」和「${value}」`);
				args.command = value;
		}
	}
	return args;
}

async function main(): Promise<number> {
	let args: Args;
	try {
		args = parse(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : "参数无效"}\n\n${USAGE}\n`);
		return 2;
	}
	if (args.help || !args.command) {
		process.stdout.write(`${USAGE}\n`);
		return args.help ? 0 : 2;
	}
	if (args.command !== "dsh") {
		process.stderr.write(`暂不支持的 harness「${args.command}」。当前可用：dsh\n`);
		return 2;
	}
	const log = (message: string) => process.stdout.write(`${message}\n`);
	try {
		if (args.remove) {
			const result = removeDsh({ ...(args.profile ? { profile: args.profile } : {}), log });
			return result.removed.length || result.profile ? 0 : 1;
		}
		await connectDsh({
			...(args.endpoint ? { endpoint: args.endpoint } : {}),
			...(args.profile ? { profile: args.profile } : {}),
			...(args.spec ? { spec: args.spec } : {}),
			...(args.intervalMs === undefined ? {} : { intervalMs: args.intervalMs }),
			noOpen: args.noOpen,
			log,
		});
		return 0;
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : "连接失败"}\n`);
		return 1;
	}
}

main().then(
	(code) => {
		process.exitCode = code;
	},
	(error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : "连接失败"}\n`);
		process.exitCode = 1;
	},
);
