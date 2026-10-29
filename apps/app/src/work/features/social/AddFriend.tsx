import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Card, httpApi, type Profile } from "../../api/social";
import { href } from "../../shell/routes";
import { Button } from "../../ui/kit/Button";
import { toast } from "../../ui/kit/Toast";
import { profileRoute } from "./lib/links";

export function AddFriend() {
	const [value, setValue] = useState("");
	const [result, setResult] = useState<ReturnType<typeof profileRoute>>();
	const [source, setSource] = useState<"link" | "scan">("link");
	const [scanning, setScanning] = useState(() => location.hash === "#/friends/add/scan");
	const video = useRef<HTMLVideoElement>(null);
	const qc = useQueryClient();
	const cards = useQuery({ queryKey: ["cards"], queryFn: httpApi.cards });
	const resolved = useQuery({
		queryKey: ["resolve", result?.page, result?.id],
		queryFn: () => httpApi.resolve(result?.page === "u" ? "card" : "actor", (result?.id ?? "").toUpperCase()),
		enabled: !!result && /^[a-z0-9]{6}$/i.test(result.id),
	});
	const short = !!result && /^[a-z0-9]{6}$/i.test(result.id);
	const id = short ? resolved.data?.id : result?.id;
	const identity = useQuery<Card | Profile | null>({
		queryKey: ["identity", result?.page, id],
		queryFn: async () => (result?.page === "u" ? await httpApi.card(id ?? "") : await httpApi.profile(id ?? "")),
		enabled: !!id,
	});
	const open = useCallback((text: string, from: "link" | "scan" = "link") => {
		const route = profileRoute(text);
		if (!route) {
			toast("请输入有效的 ID 或名片、主页链接", true);
			return;
		}
		setSource(from);
		setResult(route);
	}, []);
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
					stream.getTracks().forEach((track) => {
						track.stop();
					});
					return;
				}
				if (!video.current) return;
				video.current.srcObject = stream;
				await video.current.play();
				const detector = new Detector({ formats: ["qr_code"] });
				const scan = async () => {
					if (!active || !video.current) return;
					try {
						const codes = await detector.detect(video.current);
						if (codes[0]) {
							setScanning(false);
							open(codes[0].rawValue, "scan");
						} else timer = setTimeout(() => void scan(), 250);
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
			stream?.getTracks().forEach((track) => {
				track.stop();
			});
		};
	}, [scanning, open]);
	const add = async () => {
		if (!id) return;
		try {
			if (result?.page === "u") {
				const conv = await httpApi.startFromCard(id, source);
				location.hash = href({ tab: "chats", page: "c", session: conv.code ?? conv.id });
			} else {
				await httpApi.addFriend(id);
				void qc.invalidateQueries({ queryKey: ["contacts"] });
				toast("已添加朋友");
			}
		} catch {
			toast("操作失败，请重试", true);
		}
	};
	return (
		/* 与名片站 AppBar.Page 同版式：内容列最大 720、h1 用 display 档、块间距 6。 */
		<div className="scroll-y h-full bg-ground">
			<div className="mx-auto px-4 pb-24 lg:px-6 lg:pb-10 max-w-2xl">
				<h1 className="display rise pt-6 pb-6 lg:pt-10">添加朋友</h1>
				<div className="rise flex flex-col gap-6" style={{ animationDelay: "60ms" }}>
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
									className="field min-h-11 rounded-control bg-tone px-3 text-body text-ink outline-none placeholder:text-faint"
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
								<Button onClick={() => setScanning(false)}>停止扫码</Button>
							</div>
						)}
						{result && (
							<section aria-label="查找结果" className="rounded-card bg-tone/40">
								<div className="flex items-center justify-between px-4 pt-3">
									<h2 className="text-small font-medium">查找结果</h2>
									<Button variant="ghost" onClick={() => setResult(undefined)}>
										关闭结果
									</Button>
								</div>
								<div className="px-4 pb-4">
									{(short && resolved.isPending) || (!!id && identity.isPending) ? (
										<p role="status">正在查找…</p>
									) : resolved.isError || identity.isError ? (
										<p role="alert">查找失败，请重试</p>
									) : !identity.data ? (
										<p>未找到朋友</p>
									) : (
										<div className="flex items-center justify-between gap-3">
											<span className="min-w-0 truncate text-body font-medium">
												{"actor" in identity.data ? identity.data.actor.name : identity.data.title}
											</span>
											<Button variant="primary" className="h-11" onClick={() => void add()}>
												{result.page === "u" ? "开始聊天" : "添加朋友"}
											</Button>
										</div>
									)}
								</div>
							</section>
						)}
					</section>
					<section aria-label="我的名片与 Agent" className="border-t border-hairline pt-6">
						<h2 className="mb-4 text-small font-medium text-muted">我的名片与 Agent</h2>
						{cards.isPending ? (
							<p role="status" className="text-small text-muted">
								正在加载名片…
							</p>
						) : cards.isError ? (
							<p role="alert" className="text-small text-muted">
								加载名片失败{" "}
								<button className="underline" type="button" onClick={() => void cards.refetch()}>
									重试
								</button>
							</p>
						) : !cards.data.some((card) => card.mine) ? (
							<p className="text-small text-muted">暂无名片</p>
						) : (
							<ul className="flex flex-col gap-2">
								{cards.data
									.filter((card) => card.mine)
									.map((card) => (
										<li key={card.id}>
											<a
												className="press block rounded-card bg-raised p-4 hover:bg-tone/60"
												href={href({ tab: "contacts", page: "u", session: card.code ?? card.id })}
											>
												<span className="block text-small font-medium">{card.title}</span>
												{card.tagline && (
													<span className="block text-caption text-muted">{card.tagline}</span>
												)}
											</a>
										</li>
									))}
							</ul>
						)}
					</section>
				</div>
			</div>
		</div>
	);
}
