import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Folder, Monitor, Shield } from "lucide-react";
import { Popover } from "radix-ui";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { cloudPage, localCloudNavigation } from "../../lib/base";
import { type NodeTarget, rpc } from "../api/client";
import {
	modelKey,
	type SessionOptions as Options,
	type RuntimeChoice,
	readModels,
	readWorkspaces,
	selectDevice,
	selectPath,
	useRuntimes,
	type WorkspaceDevice,
} from "../api/session-options";

const row =
	"press flex min-h-11 w-full items-center gap-2 rounded-control px-2 py-2 text-left text-small hover:bg-tone disabled:opacity-40";
const permissionName = (id?: string, name?: string) =>
	id === "bypass" ? "Bypass permissions" : id === "readonly" ? "只读" : (name ?? "权限");

function Menu({
	label,
	children,
	disabled,
	className = "",
}: {
	label: ReactNode;
	children: ReactNode;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<Popover.Root>
			<Popover.Trigger
				disabled={disabled}
				className={`press flex min-h-11 min-w-0 items-center gap-1.5 rounded-control px-2 text-caption hover:bg-tone disabled:opacity-40 ${className}`}
			>
				{label}
				<ChevronDown size={12} aria-hidden />
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					side="top"
					align="start"
					sideOffset={8}
					collisionPadding={12}
					className="z-50 flex max-h-[min(65vh,480px)] w-80 max-w-[calc(100vw-24px)] flex-col overflow-y-auto rounded-card border border-hairline bg-raised p-2 shadow-float outline-none"
				>
					<fieldset disabled={disabled} className="contents">
						{children}
					</fieldset>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}

export function RuntimePicker({
	value,
	onChange,
	existing = false,
	disabled = false,
}: {
	value: RuntimeChoice;
	onChange(runtime: RuntimeChoice): void;
	existing?: boolean;
	disabled?: boolean;
}) {
	const { runtimes, error, loading } = useRuntimes();
	const choices = runtimes.some((item) => item.id === value.id) ? runtimes : [value, ...runtimes];
	return (
		<Menu
			disabled={disabled}
			label={
				<>
					<Monitor size={14} aria-hidden />
					<span className="truncate">运行位置 · {value.name}</span>
				</>
			}
		>
			<p className="px-2 py-1 text-caption text-faint">
				{existing ? "当前会话保留在原位置；选择位置后新建会话。" : "Agent 和会话记录保存在所选位置。"}
			</p>
			{loading && <p className="p-2 text-caption text-muted">读取运行位置…</p>}
			{choices.map((item) => (
				<button
					key={item.id}
					type="button"
					className={row}
					disabled={item.online === false || (!!item.deviceId && item.workProtocol !== 1)}
					onClick={() => onChange(item)}
				>
					<span className="min-w-0 flex-1 truncate">{item.name}</span>
					<span className="shrink-0 text-caption text-faint">
						{item.online === false
							? "离线"
							: item.deviceId && item.workProtocol !== 1
								? "工作台未就绪"
								: item.kind === "cloud"
									? "云端"
									: item.deviceId
										? "设备"
										: "当前网关"}
					</span>
					{item.id === value.id && <span title="当前">✓</span>}
				</button>
			))}
			{error && (
				<p role="alert" className="px-2 text-caption text-danger">
					无法读取账号运行位置：{error.message}
				</p>
			)}
			{localCloudNavigation() && (
				<div className="mt-1 border-t border-hairline px-2 pt-2">
					<a
						href={cloudPage("/work")}
						target="_blank"
						rel="noopener noreferrer"
						className="block py-2 text-small text-accent-ink"
					>
						登录 / 打开云端工作台
					</a>
					<p className="text-caption text-faint">在新窗口选择云端或已绑定设备；本机会话和草稿保留，可随时返回。</p>
				</div>
			)}
		</Menu>
	);
}

function Directories({
	node,
	device,
	resources,
	onChange,
	session,
}: {
	node: NodeTarget;
	device: WorkspaceDevice;
	resources: NonNullable<Options["resources"]>;
	onChange(resources: NonNullable<Options["resources"]>): void;
	session?: string;
}) {
	const [path, setPath] = useState(device.paths[0] ?? "");
	const [browse, setBrowse] = useState("");
	const directories = useQuery({
		queryKey: ["workspace-directories", node.id, session, device.deviceId, browse],
		enabled: !!browse,
		retry: false,
		queryFn: ({ signal }) =>
			rpc<{ entries: { name: string; path: string }[] }>(
				"workspaces.list",
				{ deviceId: device.deviceId, path: browse, ...(session ? { id: session } : {}) },
				signal,
				node,
			),
	});
	const selected = resources.find((item) => item.deviceId === device.deviceId)?.paths ?? [];
	const paths = [
		...new Set([
			...device.paths,
			...selected,
			...(directories.data ? [browse, ...directories.data.entries.map((item) => item.path)] : []),
		]),
	];
	return (
		<div className="ml-6 border-l border-hairline pl-2">
			{paths.map((entry) => (
				<label key={entry} className={`${row} break-all`}>
					<input
						type="checkbox"
						checked={selected.includes(entry)}
						onChange={(event) => onChange(selectPath(resources, device.deviceId, entry, event.target.checked))}
					/>
					<span>{entry}</span>
				</label>
			))}
			<form
				className="my-2 flex gap-1"
				onSubmit={(event) => {
					event.preventDefault();
					if (path.trim()) setBrowse(path.trim());
				}}
			>
				<input
					className="field min-w-0 flex-1 rounded-control bg-tone px-2 py-1 text-small"
					aria-label={`${device.name} 的目录路径`}
					value={path}
					onChange={(event) => setPath(event.target.value)}
					placeholder="目录路径"
				/>
				<button
					type="submit"
					className="press shrink-0 rounded-control bg-tone px-2 text-small"
					disabled={!path.trim() || directories.isFetching}
				>
					浏览
				</button>
			</form>
			{directories.isError && (
				<p role="alert" className="text-caption text-danger">
					{directories.error.message}
				</p>
			)}
			{directories.data?.entries.length === 0 && <p className="text-caption text-muted">此目录没有子目录。</p>}
			<p className="text-caption text-faint">未勾选目录时，仅选择设备，沿用已授权范围。</p>
		</div>
	);
}

export function SessionOptions({
	node,
	value,
	onChange,
	disabled = false,
	resourcesDisabled = false,
	runtime,
	children,
	session,
}: {
	node: NodeTarget;
	value: Options;
	onChange(value: Partial<Options>): void;
	disabled?: boolean;
	resourcesDisabled?: boolean;
	runtime: ReactNode;
	children?: ReactNode;
	session?: string;
}) {
	const models = useQuery({
		queryKey: ["models", node.id],
		queryFn: ({ signal }) => readModels(node, signal),
		retry: false,
	});
	const workspaces = useQuery({
		queryKey: ["workspaces", node.id, session],
		queryFn: ({ signal }) => readWorkspaces(node, signal, session),
		retry: false,
	});
	const resources = value.resources ?? [];
	const [modelSearch, setModelSearch] = useState("");
	const allModels = models.data?.providers.flatMap((provider) => provider.models) ?? [];
	const cloudIssues = models.data?.cloud?.issues ?? [];
	const chosen = allModels.find((model) => modelKey(model) === value.model);
	const chosenProvider = models.data?.providers.find((provider) => provider.id === chosen?.provider);
	const permission = models.data?.permissions.find((item) => item.id === value.permission);
	const title = resources.length
		? resources
				.map(
					(item) => workspaces.data?.devices.find((device) => device.deviceId === item.deviceId)?.name ?? item.deviceId,
				)
				.join("、")
		: "未指定";
	return (
		<div className="flex flex-wrap items-center gap-x-1 text-muted" data-testid="session-options">
			{runtime}
			<Menu
				label={
					<>
						<Folder size={14} aria-hidden />
						<span className="max-w-44 truncate">工作区 · {title}</span>
					</>
				}
				disabled={disabled || resourcesDisabled}
			>
				<label className={row}>
					<input type="checkbox" checked={!resources.length} onChange={() => onChange({ resources: [] })} />
					不指定工作区
				</label>
				<p className="px-2 text-caption text-faint">可操控设备来自 Bot 已获授权的集合。</p>
				{workspaces.isLoading && <p className="p-2 text-small">读取已授权设备…</p>}
				{workspaces.error && (
					<p role="alert" className="p-2 text-caption text-danger">
						{workspaces.error.message}
					</p>
				)}
				{workspaces.data?.devices.map((device) => {
					const selected = resources.some((item) => item.deviceId === device.deviceId);
					return (
						<div key={device.deviceId}>
							<label className={row}>
								<input
									type="checkbox"
									checked={selected}
									onChange={(event) =>
										onChange({ resources: selectDevice(resources, device.deviceId, event.target.checked) })
									}
								/>
								<span className="min-w-0 flex-1 truncate">{device.name}</span>
								<span className="text-caption text-faint">
									{device.status === "ready"
										? "在线"
										: device.status === "offline"
											? "离线"
											: device.status === "degraded"
												? "部分可用"
												: "状态未知"}
								</span>
							</label>
							{selected && (
								<Directories
									node={node}
									device={device}
									resources={resources}
									session={session}
									onChange={(next) => onChange({ resources: next })}
								/>
							)}
						</div>
					);
				})}
			</Menu>
			<Menu
				label={
					<>
						<Shield size={14} aria-hidden />
						<span>{permissionName(value.permission, permission?.name)}</span>
					</>
				}
				disabled={disabled || resourcesDisabled}
			>
				{models.data?.permissions.map((item) => (
					<button key={item.id} type="button" className={row} onClick={() => onChange({ permission: item.id })}>
						<span className="flex-1">{permissionName(item.id, item.name)}</span>
						{value.permission === item.id && "✓"}
					</button>
				))}
				{permission && (
					<p className="break-words px-2 py-1 text-caption text-faint">
						{permission.capabilities.join(" · ") || "无工具能力"}
					</p>
				)}
				{models.error && (
					<p role="alert" className="p-2 text-caption text-danger">
						{models.error.message}
					</p>
				)}
			</Menu>
			<Menu
				className="ml-auto"
				disabled={disabled}
				label={
					<>
						<span className="max-w-48 shrink-0 truncate font-medium text-ink">
							{chosen?.name ?? value.model ?? "选择模型"}
						</span>
						{chosenProvider && (
							<span className="max-w-24 truncate text-faint" title={chosenProvider.name}>
								{chosenProvider.name}
							</span>
						)}
						{chosen?.reasoning !== false && <span className="shrink-0 text-faint">{value.effort ?? "auto"}</span>}
					</>
				}
			>
				{models.isLoading && <p className="p-2 text-small">读取模型…</p>}
				<input
					type="search"
					aria-label="搜索模型或供应商"
					placeholder="搜索模型或供应商"
					value={modelSearch}
					onChange={(event) => setModelSearch(event.target.value)}
					className="field -order-2 mb-2 shrink-0 rounded-control bg-tone px-3 py-2 text-small"
				/>
				{models.error && (
					<p role="alert" className="p-2 text-caption text-danger">
						{models.error.message}
					</p>
				)}
				{(["cloud", "runtime"] as const).map((source) => {
					const choices = allModels.filter(
						(model) =>
							model.source === source &&
							`${model.provider} ${model.name} ${model.id}`.toLowerCase().includes(modelSearch.trim().toLowerCase()),
					);
					return (
						<div key={source}>
							<p className="px-2 pt-2 text-caption text-faint">
								{source === "cloud" ? "云端模型服务" : "运行宿主模型"}
							</p>
							{source === "cloud" && cloudIssues.length > 0 && (
								<div className="px-2 py-2 text-caption">
									{cloudIssues.map((issue) => (
										<p key={`${issue.instance}:${issue.code}`} role="alert" className="mb-1 text-danger">
											{issue.message}
										</p>
									))}
									<button
										type="button"
										disabled={models.isFetching}
										className="press min-h-10 text-accent-ink underline disabled:opacity-40"
										onClick={() => void models.refetch()}
									>
										{models.isFetching ? "正在重试…" : "重试云端模型连接"}
									</button>
								</div>
							)}
							{choices.map((model) => (
								<button
									key={modelKey(model)}
									type="button"
									className={row}
									disabled={disabled || model.available === false}
									title={model.reason}
									onClick={() => onChange({ model: modelKey(model), effort: "auto" })}
								>
									<span className="min-w-0 flex-1">
										<span className="block truncate">{model.name}</span>
										<span className="block truncate text-caption text-faint">
											{models.data?.providers.find((provider) => provider.id === model.provider)?.name ??
												model.provider}
											{model.available === false ? " · 未配置凭据" : ""}
										</span>
									</span>
									{value.model === modelKey(model) && "✓"}
								</button>
							))}
							{!choices.length && !(source === "cloud" && cloudIssues.length > 0) && (
								<p className="px-2 py-2 text-caption text-muted">暂无可用模型</p>
							)}
						</div>
					);
				})}
				{!!chosen?.reasoning && (
					<fieldset className="-order-1 mb-2 shrink-0 border-b border-hairline pb-2" disabled={disabled}>
						<legend className="px-2 text-caption text-muted">思考强度</legend>
						<div className="flex flex-wrap gap-1">
							{["auto", ...chosen.effortLevels.filter((level) => level !== "auto")].map((level) => (
								<button
									key={level}
									type="button"
									className={`press min-h-10 rounded-control px-3 text-small ${value.effort === level ? "bg-tone text-ink" : "text-muted"}`}
									onClick={() => onChange({ effort: level })}
								>
									{level}
								</button>
							))}
						</div>
					</fieldset>
				)}
				{localCloudNavigation() ? (
					<a
						href={cloudPage("/me/settings/models")}
						target="_blank"
						rel="noopener noreferrer"
						className="block px-2 py-3 text-small text-accent-ink"
					>
						在云端管理模型连接 ↗
					</a>
				) : (
					<Link to="/me/settings/models" className="block px-2 py-3 text-small text-accent-ink">
						管理云端模型连接
					</Link>
				)}
			</Menu>
			{children}
		</div>
	);
}
