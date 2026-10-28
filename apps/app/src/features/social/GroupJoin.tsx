import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { httpApi } from "../../api/social";
import { href } from "../../shell/routes";
import { ActorAvatar } from "../../ui/kit/ActorAvatar";
import { Button } from "../../ui/kit/Button";

export function GroupJoin({ token }: { token: string }) {
	const qc = useQueryClient();
	const group = useQuery({ queryKey: ["group", token], queryFn: () => httpApi.groupPreview(token) });
	const session = useQuery({ queryKey: ["social-session"], queryFn: httpApi.session });
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const conversation = group.data?.member && group.data.convId ? (group.data.convCode ?? group.data.convId) : undefined;
	useEffect(() => {
		if (conversation) location.replace(href({ tab: "chats", page: "c", session: conversation }));
	}, [conversation]);

	if (group.isPending || session.isPending || conversation)
		return (
			<div role="status" className="skeleton m-6 h-72 rounded-card">
				加载中…
			</div>
		);
	if (group.isError || session.isError)
		return (
			<div role="alert" className="p-8 text-center">
				加载失败{" "}
				<button
					type="button"
					className="underline"
					onClick={() => {
						void group.refetch();
						void session.refetch();
					}}
				>
					重试
				</button>
			</div>
		);
	if (!group.data)
		return (
			<div className="flex flex-col items-center gap-3 p-8">
				<h1 className="text-title font-semibold">这个群二维码已失效</h1>
				<a href={href({ tab: "chats" })} className="text-small text-muted">
					回到消息 →
				</a>
			</div>
		);
	const join = async () => {
		setBusy(true);
		setError("");
		try {
			if (!session.data) {
				const anonymous = await httpApi.createAnonymous();
				qc.setQueryData(["social-session"], anonymous);
			}
			const conv = await httpApi.joinGroup(token);
			void qc.invalidateQueries({ queryKey: ["convs"] });
			location.replace(href({ tab: "chats", page: "c", session: conv.code ?? conv.id }));
		} catch (e) {
			setError(e instanceof Error ? e.message : "加入失败");
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="scroll-y h-dvh bg-ground">
			<div className="mx-auto flex max-w-sm flex-col items-center gap-6 px-4 py-16 text-center">
				<div className="rise flex flex-col gap-1">
					<h1 className="display">{group.data.title}</h1>
					<p className="text-[14px] text-muted">{group.data.memberCount} 人</p>
				</div>
				<ul className="rise flex flex-wrap justify-center gap-3" style={{ animationDelay: "60ms" }}>
					{group.data.members.slice(0, 12).map((member) => (
						<li key={member.id} title={member.name} aria-label={member.name}>
							{member.avatarUrl ? (
								<img
									src={member.avatarUrl}
									alt=""
									referrerPolicy="no-referrer"
									className="size-11 rounded-full object-cover"
								/>
							) : member.kind === "agent" ? (
								<ActorAvatar seed={member.id} group="bot" />
							) : (
								<span className="flex size-11 items-center justify-center rounded-full bg-tone-2 font-medium text-muted">
									{member.name.slice(0, 1)}
								</span>
							)}
						</li>
					))}
				</ul>
				<Button variant="primary" className="h-11 w-full" disabled={busy} onClick={() => void join()}>
					加入群聊
				</Button>
				{error && (
					<p role="alert" className="text-danger">
						{error}
					</p>
				)}
			</div>
		</div>
	);
}
