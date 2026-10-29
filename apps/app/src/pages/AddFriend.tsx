import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Page } from "../components/AppBar";
import { CardStack } from "../components/wallet/CardStack";
import { profileRoute } from "../lib/profileRoute";
import { Button } from "../ui/Button";
import { toast } from "../ui/Toast";
import { PublicIdentity } from "./CardPage";

export function AddFriend() {
	const [search, setSearch] = useSearchParams();
	const [value, setValue] = useState("");
	const [scanning, setScanning] = useState(false);
	const video = useRef<HTMLVideoElement>(null);
	const open = (input: string, scanned = false) => {
		const text = input.trim();
		if (!text) {
			toast("请输入 ID 或名片、主页链接");
			return;
		}
		const route = profileRoute(text, scanned ? "scan" : "link");
		if (route) {
			const next = new URLSearchParams(search);
			next.set("result", route);
			next.delete("scan");
			if (scanned) next.set("s", "scan");
			else next.delete("s");
			setSearch(next);
		} else toast("请输入有效的 ID 或名片、主页链接", true);
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在挂载时自动打开一次
	useEffect(() => {
		if (!scanning) return;
		let active = true;
		let stream: MediaStream | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const run = async () => {
			const Detector = (
				window as unknown as {
					BarcodeDetector?: new (options: {
						formats: string[];
					}) => { detect(video: HTMLVideoElement): Promise<{ rawValue: string }[]> };
				}
			).BarcodeDetector;
			if (!Detector || !navigator.mediaDevices?.getUserMedia) {
				toast("当前浏览器不支持扫一扫，请用系统相机或粘贴链接");
				setScanning(false);
				return;
			}
			try {
				stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
				if (!active) {
					for (const track of stream.getTracks()) track.stop();
					return;
				}
				video.current!.srcObject = stream;
				await video.current!.play();
				const detector = new Detector({ formats: ["qr_code"] });
				const scan = async () => {
					if (!active || !video.current) return;
					try {
						const codes = await detector.detect(video.current);
						if (codes[0]) {
							setScanning(false);
							open(codes[0].rawValue, true);
							return;
						}
						timer = setTimeout(() => void scan(), 250);
					} catch {
						toast("无法识别二维码，请粘贴链接", true);
						setScanning(false);
					}
				};
				await scan();
			} catch {
				if (active) {
					toast("无法使用相机，请允许相机权限或粘贴链接", true);
					setScanning(false);
				}
			}
		};
		void run();
		return () => {
			active = false;
			clearTimeout(timer);
			for (const track of stream?.getTracks() ?? []) track.stop();
		};
	}, [scanning]);
	useEffect(() => {
		if (search.get("scan") === "1") setScanning(true);
	}, [search]);
	const result = search.get("result");
	const match = result?.match(/^\/(u|p)\/([^/?]+)(?:\?.*)?$/);
	const decodeId = (id: string) => {
		try {
			return decodeURIComponent(id);
		} catch {
			return id;
		}
	};
	const clearResult = () => {
		const next = new URLSearchParams(search);
		next.delete("result");
		next.delete("s");
		setSearch(next, { replace: true });
	};
	return (
		<Page title="添加朋友" wide>
			<section aria-label="查找朋友" className="flex flex-col gap-4">
				<form
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						open(value);
					}}
				>
					<label className="flex flex-col gap-2 text-small">
						ID 或名片、主页链接
						<input
							value={value}
							onChange={(e) => setValue(e.target.value)}
							className="field min-h-11 rounded-control bg-tone px-3 text-body"
						/>
					</label>
					<div className="flex gap-2">
						<Button variant="primary" className="min-h-11" type="submit">
							查找朋友
						</Button>
						<Button className="min-h-11" type="button" onClick={() => setScanning(true)}>
							扫一扫
						</Button>
					</div>
				</form>
				{scanning && (
					<div className="flex flex-col gap-3">
						<video ref={video} muted playsInline aria-label="扫码相机" className="w-full max-w-md rounded-card" />
						<Button
							onClick={() => {
								setScanning(false);
								const next = new URLSearchParams(search);
								next.delete("scan");
								setSearch(next, { replace: true });
							}}
						>
							停止扫码
						</Button>
					</div>
				)}
				{match && (
					<section aria-label="查找结果" className="rounded-card bg-tone/40">
						<div className="flex items-center justify-between px-4 pt-3">
							<h2 className="text-small font-medium">查找结果</h2>
							<Button variant="ghost" onClick={clearResult}>
								关闭结果
							</Button>
						</div>
						<PublicIdentity
							accountId={match[1] === "p" ? decodeId(match[2]) : undefined}
							cardId={match[1] === "u" ? decodeId(match[2]) : undefined}
							source={search.get("s") === "scan" ? "scan" : "link"}
						/>
					</section>
				)}
			</section>
			<section aria-label="我的名片与 Agent" className="mt-4 border-t border-hairline pt-6">
				<h2 className="mb-4 text-small font-medium text-muted">我的名片与 Agent</h2>
				<CardStack />
			</section>
		</Page>
	);
}
