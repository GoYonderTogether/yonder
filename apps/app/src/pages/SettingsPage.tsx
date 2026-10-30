import { useStore } from "@nanostores/react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api";
import { clearPersistedCache, selectAccount } from "../cache";
import { AccountSecurity } from "../components/AccountSecurity";
import { AppBar } from "../components/AppBar";
import { useLogout } from "../lib/useLogout";
import { $session } from "../store";
import { Button } from "../ui/Button";
import { setCloudDevice, useActiveNode } from "../work/api/nodes";
import { mux } from "../work/api/stream";
import { AboutSection } from "../work/features/settings/AboutSection";
import { ChannelsSection } from "../work/features/settings/ChannelsSection";
import { NodesSection } from "../work/features/settings/NodesSection";
import { NotifySection } from "../work/features/settings/NotifySection";
import { SocialSection } from "../work/features/settings/SocialSection";
import { setWorkDevices } from "../work/lib/workOnline";
import { ProfileDialog } from "./Me";

const sections = [
	["account", "账号与安全"],
	["notifications", "通知"],
	["devices", "设备"],
	["channels", "渠道"],
	["social", "社交设置"],
	["about", "关于"],
] as const;

export function SettingsPage({ local = false }: { local?: boolean }) {
	const { section } = useParams();
	const session = useStore($session);
	const node = useActiveNode();
	const qc = useQueryClient();
	const navigate = useNavigate();
	const logout = useLogout();
	const [profile, setProfile] = useState(false);
	const devices = useQuery({
		queryKey: ["account-devices", session?.actor.id],
		queryFn: api.devices,
		enabled: !local && !!session,
		refetchInterval: 5000,
	});
	useEffect(() => {
		if (!local && devices.data) setWorkDevices(devices.data);
	}, [local, devices.data]);
	const selected = devices.data?.find(
		(item) => item.id === node.deviceId && node.id.startsWith(`account:${session?.actor.id}:device:`),
	);
	const available = local || !!(selected?.online && selected.workProtocol === 1);
	const signedOut = () => {
		clearPersistedCache(qc);
		selectAccount(null, qc);
		$session.set(null);
		navigate("/login");
	};
	const title = sections.find(([key]) => key === section)?.[1] ?? "设置";
	const choose = (device: { id: string; name: string }) => {
		if (!session || node.id === `account:${session.actor.id}:device:${device.id}`) return;
		mux.reset();
		setCloudDevice(session.actor.id, device);
	};
	return (
		<div className="scroll-y h-full bg-ground lg:m-2 lg:ml-0 lg:h-[calc(100%-1rem)] lg:rounded-card lg:shadow-soft">
			<AppBar
				title={title}
				left={
					<Link
						to={section ? "/me/settings" : local ? "/work" : "/me"}
						aria-label="返回"
						className="press -ml-2 flex size-10 items-center justify-center rounded-full text-muted hover:bg-tone"
					>
						<ArrowLeft size={20} aria-hidden />
					</Link>
				}
			/>
			<div className="mx-auto max-w-2xl pb-24">
				{!section && (
					<nav aria-label="设置菜单" className="mx-4 rounded-card bg-raised">
						{sections
							.filter(([key]) => !local || key !== "account")
							.map(([key, label]) => (
								<Link
									key={key}
									to={`/me/settings/${key}`}
									className="press flex min-h-14 items-center gap-3 px-4 hover:bg-tone"
								>
									<span className="flex-1">{label}</span>
									<ChevronRight size={16} className="text-faint" />
								</Link>
							))}
					</nav>
				)}
				{section === "account" && !local && session && (
					<section className="mx-4 rounded-card bg-raised p-4">
						<h2 className="mb-3 font-medium">账号与安全</h2>
						{!session.actor.anonymous && (
							<>
								<Button onClick={() => setProfile(true)}>账号昵称</Button>
								<div className="mt-4">
									<AccountSecurity actor={session.actor} onSignedOut={signedOut} />
								</div>
							</>
						)}
						<Button className="mt-4 text-danger" onClick={logout}>
							退出登录
						</Button>
						{profile && <ProfileDialog open onOpenChange={setProfile} />}
					</section>
				)}
				{["notifications", "devices", "channels", "social", "about"].includes(section ?? "") && (
					<>
						{!local && section !== "about" && (
							<section className="mx-4 mt-3 rounded-card bg-raised p-4" aria-label="设备选择">
								<h2 className="font-medium">设备设置</h2>
								<p className="mt-1 text-caption text-muted">设备设置只影响选中的设备；离线设备暂不可操作。</p>
								{devices.isLoading && <p>加载中…</p>}
								{devices.isError && <p className="text-danger">设备加载失败：{devices.error.message}</p>}
								{devices.data?.length === 0 && (
									<p className="text-small text-muted">
										尚未绑定设备。
										<Link to="/connect" className="text-accent underline">
											添加设备
										</Link>
									</p>
								)}
								<div className="mt-2 flex flex-wrap gap-2">
									{devices.data?.map((device) => (
										<Button
											key={device.id}
											size="sm"
											variant={selected?.id === device.id ? "primary" : "secondary"}
											disabled={!device.online || device.workProtocol !== 1}
											onClick={() => choose(device)}
										>
											{device.name} · {device.online ? (device.workProtocol === 1 ? "在线" : "工作台不可用") : "离线"}
										</Button>
									))}
								</div>
								{!available && !!devices.data?.length && (
									<p className="mt-2 text-small text-muted">请选择支持工作台的在线设备。</p>
								)}
							</section>
						)}
						<DeviceQueries key={`${session?.actor.id ?? "local"}:${node.id}`}>
							{section === "notifications" && <NotifySection deviceAvailable={available} />}
							{section === "channels" && available && <ChannelsSection />}
							{section === "social" && available && <SocialSection />}
							{section === "devices" && local && <NodesSection />}
							{section === "about" && local && <AboutSection />}
							{section === "about" && !local && (
								<p className="mx-4 mt-3 text-small text-muted">设备版本和更新请在设备本机查看。</p>
							)}
						</DeviceQueries>
					</>
				)}
			</div>
		</div>
	);
}

function DeviceQueries({ children }: { children: ReactNode }) {
	const [client] = useState(() => new QueryClient());
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
