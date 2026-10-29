import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Card, httpApi, type Profile } from "../../api/social";
import { href } from "../../shell/routes";
import { Button } from "../../ui/kit/Button";
import { Field } from "../../ui/kit/Field";
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
		<div className="h-full overflow-y-auto bg-ground p-4">
			<div className="mx-auto max-w-2xl">
				<h1 className="mb-6 text-xl font-semibold">添加朋友</h1>
				<section aria-label="查找朋友" className="flex flex-col gap-4">
					<form
						className="flex flex-col gap-4"
						onSubmit={(e) => {
							e.preventDefault();
							open(value);
						}}
					>
						<Field label="ID 或名片、主页链接" value={value} onChange={(e) => setValue(e.target.value)} />
						<div className="flex gap-2">
							<Button variant="primary" type="submit">
								查找朋友
							</Button>
							<Button type="button" onClick={() => setScanning(true)}>
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
						<section aria-label="查找结果" className="rounded-card bg-tone/40 p-4">
							<div className="flex justify-between">
								<h2>查找结果</h2>
								<Button variant="ghost" onClick={() => setResult(undefined)}>
									关闭结果
								</Button>
							</div>
							{(short && resolved.isPending) || (!!id && identity.isPending) ? (
								<p role="status">正在查找…</p>
							) : resolved.isError || identity.isError ? (
								<p role="alert">查找失败，请重试</p>
							) : !identity.data ? (
								<p>未找到朋友</p>
							) : (
								<div className="flex items-center justify-between gap-3">
									<span>{"actor" in identity.data ? identity.data.actor.name : identity.data.title}</span>
									<Button variant="primary" onClick={() => void add()}>
										{result.page === "u" ? "开始聊天" : "添加朋友"}
									</Button>
								</div>
							)}
						</section>
					)}
				</section>
				<section aria-label="我的名片与 Agent" className="mt-6 border-t border-hairline pt-6">
					<h2 className="mb-4 text-small font-medium text-muted">我的名片与 Agent</h2>
					{cards.isPending ? (
						<p role="status">正在加载名片…</p>
					) : cards.isError ? (
						<p role="alert">
							加载名片失败{" "}
							<button className="underline" type="button" onClick={() => void cards.refetch()}>
								重试
							</button>
						</p>
					) : !cards.data.some((card) => card.mine) ? (
						<p>暂无名片</p>
					) : (
						<ul className="flex flex-col gap-2">
							{cards.data
								.filter((card) => card.mine)
								.map((card) => (
									<li key={card.id}>
										<a
											className="block rounded-card bg-raised p-4 hover:bg-tone"
											href={href({ tab: "contacts", page: "u", session: card.code ?? card.id })}
										>
											{card.title}
											{card.tagline && <span className="block text-small text-muted">{card.tagline}</span>}
										</a>
									</li>
								))}
						</ul>
					)}
				</section>
			</div>
		</div>
	);
}
