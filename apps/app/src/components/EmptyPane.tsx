import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { Button } from "../ui/Button";
import { Logo } from "../ui/Logo";

const AddDeviceDialog = lazy(() => import("../pages/Connect").then((m) => ({ default: m.AddDeviceDialog })));

/** 桌面主区没选中内容时：有设备就留白；没设备给出下一步。 */
export function EmptyPane() {
	const nav = useNavigate();
	const qc = useQueryClient();
	const [adding, setAdding] = useState(false);
	const { data: devices } = useQuery({ queryKey: ["devices"], queryFn: api.devices });
	if (!devices) return null;
	if (devices.length)
		return (
			<div className="fade m-auto text-faint opacity-15 grayscale">
				<Logo size={56} radius={0.32} />
			</div>
		);
	return (
		<div className="fade m-auto flex max-w-xs flex-col items-center px-6 text-center">
			<p className="text-title font-semibold tracking-tight">还没有设备</p>
			<p className="mt-2 text-small text-muted">添加设备后，电脑上的 Bot 会出现在这里。</p>
			<Button variant="primary" className="mt-5" onClick={() => setAdding(true)}>
				添加设备
			</Button>
			<Link to="/download" className="mt-3 text-small text-muted underline underline-offset-4 hover:text-ink">
				下载客户端
			</Link>
			<Suspense fallback={<span role="status">正在加载…</span>}>
				{adding && (
					<AddDeviceDialog
						open
						onOpenChange={setAdding}
						onConnected={() => {
							qc.invalidateQueries({ queryKey: ["devices"] });
							qc.invalidateQueries({ queryKey: ["contacts"] });
							nav("/contacts");
						}}
					/>
				)}
			</Suspense>
		</div>
	);
}
