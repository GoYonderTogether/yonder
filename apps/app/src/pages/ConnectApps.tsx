import { useStore } from "@nanostores/react";
import { Activity, BellRing, Calendar, Check, Image, Laptop, MapPin, Plus, Users } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import type { Device } from "../api/types";
import { AppBar, BackButton } from "../components/AppBar";
import { useAccountDevices } from "../components/devices/queries";
import { cn } from "../lib/cn";
import {
	type DeviceCapabilityKind,
	hasNativeShell,
	type NativePermissionResult,
	nativePermissionStatus,
	requestNativePermission,
} from "../lib/nativePermissions";
import { internalState } from "../lib/navigation";
import { $session } from "../store";

/**
 * 连接应用（/me/connect-apps）：这台 iOS 设备的系统能力授权 + 已配对的
 * Mac / Windows / Linux 设备列表。分四段：当前 iOS / Mac / Windows / Linux。
 * iOS 段点 + 触发真实系统弹窗；其他段读设备 API 的真实在线事实。
 *
 * 弹窗 kind 的映射：日历走 calendar；健康走 health；提醒事项 / 通讯录 / 位置
 * 在 Swift 端与日历同属 EventKit / Contacts / CoreLocation 的授权流，但插件的
 * request 只声明了 health、calendar 两个 kind（与引导流一致），因此其余能力
 * 当前只读状态（status），申请入口等插件扩 kind 后再放开。
 */

const SEGMENTS = [
	{ key: "ios", label: "当前 iOS" },
	{ key: "mac", label: "Mac" },
	{ key: "windows", label: "Windows" },
	{ key: "linux", label: "Linux" },
] as const;
type SegmentKey = (typeof SEGMENTS)[number]["key"];

const IOS_CAPABILITIES: {
	kind: DeviceCapabilityKind;
	label: string;
	line: string;
	Icon: typeof Calendar;
}[] = [
	{ kind: "calendar", label: "日历", line: "读取日程，让 Bot 安排提醒与计划", Icon: Calendar },
	{ kind: "reminders", label: "提醒事项", line: "读取提醒，交给 Bot 跟进", Icon: BellRing },
	{ kind: "contacts", label: "通讯录", line: "读取姓名与联系方式，方便 Bot 转达", Icon: Users },
	{ kind: "photos", label: "照片", line: "确认相册访问权限，用于发送图片", Icon: Image },
	{ kind: "location", label: "位置", line: "使用期间获取位置，Bot 能就近提醒", Icon: MapPin },
	{ kind: "health", label: "健康", line: "读取步数、睡眠与心率，生成健康摘要", Icon: Activity },
];

type RowState = NativePermissionResult;

function CapabilityRow({
	label,
	line,
	Icon,
	state,
	onRequest,
}: {
	label: string;
	line: string;
	Icon: typeof Calendar;
	state: RowState | undefined;
	onRequest: () => void;
}) {
	const granted = state?.state === "granted";
	return (
		<div className="flex min-h-16 items-center gap-3 px-4 py-3">
			<span
				aria-hidden
				className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-tone text-ink"
			>
				<Icon size={20} strokeWidth={1.75} />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block text-body">{label}</span>
				<span className="mt-0.5 block text-caption text-muted">{line}</span>
				{state?.state === "denied" && (
					<span className="mt-0.5 block text-caption text-muted">已被拒绝，需在系统设置里打开</span>
				)}
				{state?.state === "unsupported" && (
					<span className="mt-0.5 block text-caption text-muted">此壳不支持，请更新 iPhone 上的 Yonder</span>
				)}
			</span>
			{granted ? (
				<span
					title={`${label}已授权`}
					className="flex h-8 w-8 items-center justify-center rounded-full bg-tone text-ink"
				>
					<Check size={16} strokeWidth={2} aria-label={`${label}已授权`} />
				</span>
			) : (
				<button
					type="button"
					aria-label={`授权${label}`}
					className="press flex h-8 w-8 items-center justify-center rounded-full bg-raised text-small font-medium text-ink shadow-soft"
					onClick={onRequest}
				>
					<Plus size={16} strokeWidth={2} />
				</button>
			)}
		</div>
	);
}

function IosSegment() {
	const [states, setStates] = useState<Partial<Record<DeviceCapabilityKind, RowState>>>({});
	const [loading, setLoading] = useState<Partial<Record<DeviceCapabilityKind, boolean>>>({});

	const ask = async (kind: DeviceCapabilityKind) => {
		if (loading[kind]) return;
		setLoading((old) => ({ ...old, [kind]: true }));
		try {
			const current = await nativePermissionStatus(kind);
			if (current.state === "granted") {
				setStates((old) => ({ ...old, [kind]: current }));
				return;
			}
			// 只有 health / calendar 有引导流既有的申请 kind；其余能力等插件扩 kind。
			const requested =
				kind === "health"
					? await requestNativePermission("health")
					: kind === "calendar"
						? await requestNativePermission("calendar")
						: current;
			setStates((old) => ({ ...old, [kind]: requested }));
		} finally {
			setLoading((old) => ({ ...old, [kind]: false }));
		}
	};

	return (
		<div className="overflow-hidden rounded-card bg-raised">
			<div className="divide-y divide-hairline/60">
				{IOS_CAPABILITIES.map(({ kind, label, line, Icon }) => (
					<CapabilityRow
						key={kind}
						label={label}
						line={line}
						Icon={Icon}
						state={states[kind]}
						onRequest={() => void ask(kind)}
					/>
				))}
			</div>
		</div>
	);
}

function DesktopSegment({ platform, devices }: { platform: "mac" | "windows" | "linux"; devices: Device[] }) {
	const loc = useLocation();
	const osWord = platform === "mac" ? "Mac" : platform === "windows" ? "Windows" : "Linux";
	const paired = devices.filter((device) =>
		platform === "mac" ? device.kind === "laptop" || device.kind === "desktop" : device.kind === "desktop",
	);
	if (!paired.length) {
		return (
			<div className="rounded-card bg-raised px-4 py-4">
				<p className="text-small text-muted">
					还没有配对的 {osWord} 设备。
					<Link to="/get" className="ml-1 text-accent-ink underline">
						去下载 Yonder
					</Link>
				</p>
			</div>
		);
	}
	return (
		<div className="overflow-hidden rounded-card bg-raised">
			<div className="divide-y divide-hairline/60">
				{paired.map((device) => (
					<Link
						key={device.id}
						to={`/me/devices/${encodeURIComponent(device.id)}`}
						state={internalState(loc)}
						className="press flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-tone-2"
					>
						<span
							aria-hidden
							className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-tone text-ink"
						>
							<Laptop size={20} strokeWidth={1.75} />
						</span>
						<span className="min-w-0 flex-1">
							<span className="block truncate text-body">{device.name}</span>
							<span className="mt-0.5 block text-caption text-muted">
								{device.online ? "在线" : "离线"} · {osWord}
							</span>
						</span>
						<Check size={16} className="text-faint" aria-hidden />
					</Link>
				))}
			</div>
		</div>
	);
}

export function ConnectApps() {
	const session = useStore($session);
	const [segment, setSegment] = useState<SegmentKey>("ios");
	const inShell = hasNativeShell();
	const devices = useAccountDevices(session && !session.actor.anonymous ? session.actor.id : undefined);
	const allDevices = devices.data ?? [];

	return (
		<div className="scroll-y h-full bg-ground lg:m-2 lg:ml-0 lg:h-[calc(100%-1rem)] lg:rounded-panel lg:shadow-soft">
			<div className="lg:hidden">
				<AppBar title="连接应用" left={<BackButton to="/me" />} />
			</div>
			<div className="mx-auto max-w-3xl pb-24 lg:px-8 lg:pb-10">
				<h1 className="display hidden pt-10 pb-6 lg:block">连接应用</h1>
				<div role="tablist" aria-label="平台分段" className="mb-4 flex gap-1 rounded-card bg-raised p-1">
					{SEGMENTS.map(({ key, label }) => (
						<button
							key={key}
							type="button"
							role="tab"
							aria-selected={segment === key}
							className={cn(
								"press flex-1 rounded-control px-2 py-2 text-small",
								segment === key ? "bg-tone font-medium text-ink" : "text-muted",
							)}
							onClick={() => setSegment(key)}
						>
							{label}
						</button>
					))}
				</div>
				{segment === "ios" ? (
					inShell ? (
						<IosSegment />
					) : (
						<div className="rounded-card bg-raised px-4 py-4">
							<p className="text-small text-muted">这段需要 iPhone 上的 Yonder 应用打开。</p>
						</div>
					)
				) : (
					<DesktopSegment platform={segment} devices={allDevices} />
				)}
			</div>
		</div>
	);
}
