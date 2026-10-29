import { useQueryClient } from "@tanstack/react-query";
import { Monitor, Plus, ScanLine, UserPlus, UsersRound } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { lazy, Suspense, useState } from "react";
import { useNavigate } from "react-router";
import { useDesktop } from "../lib/useDesktop";

const AddDeviceDialog = lazy(() => import("../pages/Connect").then((m) => ({ default: m.AddDeviceDialog })));
const GroupWindow = lazy(() => import("./PlusWindows").then((m) => ({ default: m.GroupWindow })));

type Action = "group" | "friend" | "device" | "scan";
const items: { action: Action; label: string; icon: typeof Plus }[] = [
	{ action: "group", label: "发起群聊", icon: UsersRound },
	{ action: "friend", label: "添加朋友", icon: UserPlus },
	{ action: "device", label: "添加设备", icon: Monitor },
	{ action: "scan", label: "扫一扫", icon: ScanLine },
];

/** 加号菜单。桌面：三项都开小窗口；手机：跳转页面，多一项扫一扫。 */
export function PlusMenu() {
	const nav = useNavigate();
	const qc = useQueryClient();
	const desktop = useDesktop();
	const [win, setWin] = useState<Action>();
	const run = (action: Action) => {
		if (action === "scan") nav("/friends/add?scan=1");
		else if (action === "friend") nav("/friends/add");
		else if (desktop || action === "group") setWin(action);
		else nav("/connect");
	};
	const close = (v: boolean) => {
		if (!v) setWin(undefined);
	};
	return (
		<>
			<DropdownMenu.Root modal={false}>
				<DropdownMenu.Trigger
					aria-label="更多"
					className="press flex h-10 w-10 items-center justify-center rounded-full text-ink hover:bg-tone data-[state=open]:bg-tone"
				>
					<Plus size={22} strokeWidth={1.75} />
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content
						align="end"
						sideOffset={6}
						className="rise z-50 min-w-40 rounded-card bg-raised p-1.5 shadow-float outline-none"
					>
						{items
							.filter((i) => (desktop ? i.action !== "scan" : true))
							.map(({ action, label, icon: Icon }) => (
								<DropdownMenu.Item
									key={action}
									onSelect={() => run(action)}
									className="press flex h-11 cursor-pointer items-center gap-3 rounded-control px-3 text-[15px] outline-none data-[highlighted]:bg-tone"
								>
									<Icon size={19} strokeWidth={1.75} className="text-muted" />
									{label}
								</DropdownMenu.Item>
							))}
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
			<Suspense fallback={<span role="status">正在加载…</span>}>
				{win === "group" && <GroupWindow open onOpenChange={close} />}
				{desktop && win === "device" && (
					<AddDeviceDialog
						open
						onOpenChange={close}
						onConnected={() => {
							qc.invalidateQueries({ queryKey: ["devices"] });
							qc.invalidateQueries({ queryKey: ["contacts"] });
							nav("/contacts");
						}}
					/>
				)}
			</Suspense>
		</>
	);
}
