import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Monitor, Plus, Trash2 } from "lucide-react";
import { LOCAL_NODE, type NodeConfig, removeNode, setActiveNode, useActiveNode, useNodes } from "../../api/nodes";
import { cn } from "../../lib/cn";
import { Link } from "react-router";
import { appBase } from "../../../lib/base";
import { workPath } from "../../shell/workRoutes";
import { Button } from "../../ui/kit/Button";
import { toast } from "../../ui/kit/Toast";

const workHref = workPath();
/** 本机控制台的首页就是当前这个客户端（消息列表）；控制台页只是它的一个入口。 */
export const CONSOLE_HOME = "/";

/** 控制台页的一行：节点本身 + 展示用的地址与可做的动作。 */
export interface ConsoleRow {
	id: string;
	name: string;
	/** 展示文本：本机是同源，远程是它的绝对地址。 */
	origin: string;
	remote: boolean;
	/** 当前选中的节点。 */
	current: boolean;
	/** 本机节点不能移除。 */
	removable: boolean;
}

/**
 * 节点列表行：本机恒在首位，其余保持添加顺序；当前节点与可移除性只由传入值决定。
 * 纯函数，不读存储、不读窗口。
 */
export function consoleRows(nodes: NodeConfig[], activeId: string): ConsoleRow[] {
	return nodes
		.map((node, index) => ({ node, index }))
		.sort((a, b) => {
			const local = Number(a.node.id !== LOCAL_NODE.id) - Number(b.node.id !== LOCAL_NODE.id);
			return local !== 0 ? local : a.index - b.index;
		})
		.map(({ node }) => ({
			id: node.id,
			name: node.name || node.id,
			origin: node.origin ?? "同源（当前页面）",
			remote: node.id !== LOCAL_NODE.id,
			current: node.id === activeId,
			removable: node.id !== LOCAL_NODE.id,
		}));
}

export interface ConsoleTarget {
	href: string;
	/** 远程节点在它自己的 origin 上新标签打开；本机在原地跳转。 */
	external: boolean;
}

/**
 * 打开某节点的控制台：本机就是当前客户端，回到它的首页；远程节点进入它自己的 origin，
 * 那台设备由它自己的网关提供页面。远程节点没有地址时没有可打开的目标。
 */
export function consoleTarget(node: NodeConfig): ConsoleTarget | undefined {
	if (node.id === LOCAL_NODE.id) return { href: CONSOLE_HOME, external: false };
	if (!node.origin) return undefined;
	return { href: node.origin, external: true };
}

/**
 * 控制台：在已接入的节点之间切换并进入对应设备的控制台。
 * 本机是当前页面本身；远程节点只保存地址，打开时进入它自己的页面。
 * 远程登录默认没有 owner scope（contracts §14），看不到 Bot 对话，这里如实说明。
 */
export function ConsoleSwitcher() {
	const nodes = useNodes();
	const active = useActiveNode();
	const client = useQueryClient();
	const rows = consoleRows(nodes, active.id);
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const hasRemote = rows.some((row) => row.remote);

	const open = (node: NodeConfig) => {
		const target = consoleTarget(node);
		if (!target) {
			toast("这个节点没有保存地址，无法打开", true);
			return;
		}
		if (target.external) window.open(target.href, "_blank", "noopener");
		else location.assign(`${appBase()}${target.href.replace(/^\//, "")}`);
	};

	const remove = (row: ConsoleRow) => {
		removeNode(row.id, client);
		toast(`已移除 ${row.name}`);
	};

	return (
		<div className="scroll-y h-full" data-testid="console-switcher">
			<header className="flex items-center gap-3 px-4 pt-safe pb-1">
				<Link aria-label="返回工作" to={workHref} className="press rounded-full p-2 hover:bg-tone">
					<ArrowLeft size={20} aria-hidden />
				</Link>
				<h1 className="text-title font-semibold">控制台</h1>
			</header>
			<p className="px-4 pb-2 text-caption text-faint">
				控制已接入的设备：本机就是当前页面；远程设备打开它自己的控制台页面。
			</p>

			<section className="mx-4 mt-2 rounded-card bg-raised p-4" data-testid="console-current">
				<h2 className="mb-1 flex items-center gap-2 text-body font-medium">
					<Monitor size={17} aria-hidden /> 当前节点
				</h2>
				<p className="truncate text-small">{active.name || active.id}</p>
				<p className="truncate text-caption text-faint">{active.origin ?? "同源（当前页面）"}</p>
				<Button variant="primary" size="sm" className="mt-3" onClick={() => open(active)} data-testid="open-current">
					{active.id === LOCAL_NODE.id ? "打开本机控制台" : "在新标签打开该节点"}
				</Button>
			</section>

			<section className="mx-4 mt-3 rounded-card bg-raised p-4" data-testid="console-nodes">
				<h2 className="mb-2 text-body font-medium">已接入节点</h2>
				<ul className="flex flex-col gap-1">
					{rows.map((row) => (
						<li key={row.id} className="flex items-center gap-2 rounded-control py-1.5" data-testid="console-node">
							<button
								type="button"
								aria-pressed={row.current}
								onClick={() => setActiveNode(row.id)}
								className={cn(
									"press min-w-0 flex-1 rounded-control px-2 py-1.5 text-left",
									row.current ? "bg-tone" : "hover:bg-tone",
								)}
							>
								<span className="flex items-center gap-1.5">
									<span className="truncate text-small">{row.name}</span>
									{row.current && <span className="shrink-0 text-caption text-accent">当前</span>}
									{row.remote && (
										<span className="shrink-0 rounded-full bg-tone px-1.5 text-caption text-muted">远程</span>
									)}
								</span>
								<span className="block truncate text-caption text-faint">{row.origin}</span>
								<span className="block truncate text-caption text-faint">{row.id}</span>
							</button>
							<button
								type="button"
								aria-label={`打开 ${row.name} 的控制台`}
								title="打开控制台"
								onClick={() => {
									const node = byId.get(row.id);
									if (node) open(node);
								}}
								className="press flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-tone hover:text-ink"
							>
								<ExternalLink size={15} aria-hidden />
							</button>
							{row.removable && (
								<button
									type="button"
									aria-label={`移除 ${row.name}`}
									onClick={() => remove(row)}
									className="press flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-tone hover:text-danger"
								>
									<Trash2 size={15} aria-hidden />
								</button>
							)}
						</li>
					))}
				</ul>
				<p className="mt-2 text-caption text-faint">本机不可移除；远程节点只保存地址，登录状态按节点分开。</p>
			</section>

			<section className="mx-4 mt-3 rounded-card bg-raised p-4" data-testid="console-add">
				{hasRemote ? (
					<>
						<h2 className="mb-1 text-body font-medium">接入更多设备</h2>
						<p className="text-caption text-faint">在另一台设备上开启网关，把它的地址加进来就能从这切换过去。</p>
					</>
				) : (
					<>
						<h2 className="mb-1 text-body font-medium">只控制本机</h2>
						<p className="text-caption text-faint">
							还没有添加远程设备。当前能控制的只有这台设备（同源网关）；添加设备后，可以在这里进入对方的控制台。
						</p>
					</>
				)}
				<Link
					to="/connect"
					className="press mt-3 inline-flex h-8 items-center gap-1.5 rounded-full bg-tone px-3 text-[13px] font-medium text-ink hover:bg-tone-2"
					data-testid="console-add-device"
				>
					<Plus size={15} aria-hidden /> 添加设备
				</Link>
			</section>

			{hasRemote && (
				<section className="mx-4 mt-3 mb-4 rounded-card bg-raised p-4" data-testid="console-remote-scope">
					<h2 className="mb-1 text-body font-medium">远程节点的限制</h2>
					<p className="text-caption text-faint">
						远程连接只持访问令牌的 scope：默认没有 owner，看不到 Bot
						对话，只能看任务会话；管理员操作（插件、渠道登录、停止服务）只在本机可用。需要更多权限，要在那台设备的
						yonder.yaml 里显式开启，客户端不代为绕过。
					</p>
				</section>
			)}
		</div>
	);
}
